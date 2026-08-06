import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { MEDIA_UNITS, parseArcRoute } from "@/domain";

import { INVALID_JSON, arcGuard, fail, readJson } from "@/app/api/v1/arc/_lib/http";
import { checkUsageAllowed, usageBlockMessage } from "@/lib/billing/entitlements";
import { resolveWorkspaceTarget } from "@/lib/media-config/target";
import { resolveEngineProvider } from "@/lib/media/engine-provider";
import { meterConnectorCall } from "@/lib/connectors/metering";
import { hardenImagePrompt } from "@/lib/media/prompt";
import { deriveImageRiskFlags } from "@/lib/media/risk";
import { recordGeneratedMedia } from "@/lib/media/library-record";
import { storeGeneratedImage } from "@/lib/media/storage";
import { getAppSettings } from "@/lib/settings/store";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { recordUsageEvent } from "@/lib/ai-usage/persistence";

/**
 * Generate an image (AI) and store it in the public campaign-media Supabase
 * bucket. Flag-gated; Supabase is already required by guard(). Returns
 * not_configured when media gen isn't enabled. The result is provenance-tagged
 * (source: ai_generated) with heuristic risk flags. No outbound.
 *
 *   POST /api/v1/arc/media/generate-image
 *   { prompt: string, aspect_ratio?: string, style?: string }
 *   -> 201 { ok, status:"created", media: ArcMedia }
 */

/**
 * Store a finished image, meter it, put it in the Library, and describe it.
 *
 * ONE tail for both the inline path and the poll path. They differ only in
 * where the bytes came from, and a second copy of "store, meter, record" is how
 * one of them ends up quietly not writing a Library row.
 *
 * Every write here is best-effort by design: the generation is already paid for
 * by the time we hold bytes, so a bookkeeping failure must not turn a delivered
 * asset into an error the caller retries (and pays for again).
 */
async function landImage(input: {
  scope: { orgId: string; workspaceId: string };
  bytes: Buffer;
  contentType: string;
  model: string;
  jobId: string;
  prompt: string;
  aspectRatio: string;
}) {
  const ext = input.contentType.includes("png") ? "png" : input.contentType.includes("webp") ? "webp" : "jpg";
  const objectPath = `arc-generated/${input.scope.orgId}/${input.scope.workspaceId}/${randomUUID()}.${ext}`;
  // Permanent public URL from the campaign-media bucket — no expiry to re-sign.
  const url = await storeGeneratedImage(objectPath, input.bytes, input.contentType);
  await recordUsageEvent({
    orgId: input.scope.orgId,
    workspaceId: input.scope.workspaceId,
    service: "gemini_image",
    model: input.model,
    units: 1,
    metadata: { route: "generate-image", aspect_ratio: input.aspectRatio, job_id: input.jobId },
  });
  const riskFlags = deriveImageRiskFlags(input.prompt);
  const assetId = await recordGeneratedMedia({
    orgId: input.scope.orgId,
    objectPath,
    publicUrl: url,
    contentType: input.contentType,
    kind: "image",
    byteSize: input.bytes.byteLength,
    prompt: input.prompt,
    // The model that ACTUALLY ran — engines substitute (observed live:
    // nano_banana_pro answered as nano_banana_2).
    model: input.model,
    jobId: input.jobId,
    format: input.aspectRatio,
    riskFlags,
  });
  const media = {
    kind: "image" as const,
    url,
    source: "ai_generated" as const,
    format: input.aspectRatio,
    model: input.model,
    jobId: input.jobId,
    riskFlags,
  };
  return { media, objectPath, ...(assetId ? { libraryAssetId: assetId } : {}) };
}

export async function POST(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;

  // NOTE: no gemini-media gate here. Whether generation can run is now answered
  // by resolveEngineProvider below, which asks the engine the target actually
  // names — gating on the Gemini connector first would refuse a workspace whose
  // only connected engine is Higgsfield. A Gemini/Auto target still reaches the
  // same check, with the same operator-actionable reason.

  // Pre-flight plan/quota gate (non-blocking until ARC_BILLING_ENFORCEMENT is armed).
  const gate = await checkUsageAllowed(allowed.scope.orgId);
  if (!gate.allowed) {
    return fail("plan_limit", usageBlockMessage(gate), 402);
  }

  const payload = await readJson(request);
  if (payload === INVALID_JSON || typeof payload !== "object" || payload === null) {
    return fail("rejected", "Request body must be valid JSON.", 400);
  }
  const body = payload as Record<string, unknown>;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  // A poll carries `operation_name` and re-sends the prompt only for provenance,
  // so the required-prompt check belongs on the START branch below.
  const operationName = typeof body.operation_name === "string" ? body.operation_name.trim() : "";
  if (!prompt && !operationName) return fail("rejected", "prompt is required.", 400);
  const aspectRatio =
    typeof body.aspect_ratio === "string" && body.aspect_ratio.trim() ? body.aspect_ratio.trim() : "1:1";
  const style = typeof body.style === "string" && body.style.trim() ? body.style.trim() : undefined;
  // A reference picture turns this into an edit on engines that support one.
  const sourceUrl = typeof body.source_url === "string" && body.source_url.trim() ? body.source_url.trim() : undefined;

  const settings = await getAppSettings(allowed.scope.orgId);
  // Precedence: explicit Advanced override (settings.image/videoModel) beats the
  // turn's level mapping, which beats the workspace default level, which beats
  // env/built-in default. The turn's level rides on body.level.
  const level = parseArcRoute(body.level ?? settings.markDefaultRoute);
  // One resolution shared with Studio and Settings: this request's pick, else
  // the workspace default, else the legacy per-org setting, else Auto (which
  // leaves the level -> env -> built-in chain below intact).
  const target = await resolveWorkspaceTarget({
    client: getSupabaseAdminClient(),
    workspaceId: allowed.scope.workspaceId,
    orgId: allowed.scope.orgId,
    category: "image",
    requestOverride: typeof body.model_key === "string" ? body.model_key : null,
  });
  // A poll names the engine that started the job; a start uses the target's.
  // Re-deriving on a poll would question the wrong provider if the workspace
  // default changed mid-render.
  const pollEngine = body.engine === "higgsfield" ? ("higgsfield" as const) : body.engine === "gemini" ? ("gemini" as const) : undefined;
  const engine = await resolveEngineProvider({ client: getSupabaseAdminClient(), workspaceId: allowed.scope.workspaceId, target, level, engine: pollEngine });
  if (!engine.ok) return fail("not_configured", engine.reason, 503);
  const provider = engine.provider;

  try {
    // ---- POLL an in-flight job ----------------------------------------------
    // Not metered: the render is already paid for, and charging again for
    // asking whether it finished would bill a customer per poll.
    if (operationName) {
      if (!provider.pollImage) return fail("rejected", "That engine does not run image jobs.", 400);
      const poll = await provider.pollImage(operationName);
      if (poll.status === "running") return NextResponse.json({ ok: true, status: "running" }, { status: 200 });
      const landed = await landImage({
        scope: allowed.scope,
        bytes: poll.bytes,
        contentType: poll.contentType,
        model: poll.model,
        jobId: poll.jobId,
        prompt: typeof body.prompt === "string" ? body.prompt : "",
        aspectRatio,
      });
      return NextResponse.json({ ok: true, status: "created", ...landed }, { status: 201 });
    }

    // Harden the prompt (strip embedded text/branding, add quality + caller style)
    // before sending; risk flags stay on the operator's original intent.
    const finalPrompt = hardenImagePrompt(prompt, { style });

    // ---- START a job, on engines where an image IS one -----------------------
    // A real Higgsfield image measured ~75s, which no serverless request can
    // hold. Submitting and handing back an operation name is the same shape the
    // video path has always used, and it is why video never had this problem.
    if (provider.startImage) {
      const started = await meterConnectorCall(
        undefined,
        { orgId: allowed.scope.orgId, workspaceId: allowed.scope.workspaceId, connectorKey: engine.connectorKey, estimatedUnits: MEDIA_UNITS.image, costTier: engine.costTier, context: { route: "generate-image", provider: engine.engine } },
        () => provider.startImage!({ prompt: finalPrompt, aspectRatio, ...(sourceUrl ? { source: { url: sourceUrl } } : {}) }),
      );
      if (!started.ok) return fail("plan_limit", started.refusal.message, 402);
      return NextResponse.json(
        { ok: true, status: "running", operationName: started.result.operationName, model: started.result.model, jobId: started.result.jobId, engine: engine.engine },
        { status: 201 },
      );
    }

    // Platform-credit generations are spend-capped; a workspace's own key bypasses.
    const metered = await meterConnectorCall(
      undefined,
      { orgId: allowed.scope.orgId, workspaceId: allowed.scope.workspaceId, connectorKey: engine.connectorKey, estimatedUnits: MEDIA_UNITS.image, costTier: engine.costTier, context: { route: "generate-image", provider: engine.engine } },
      () => provider.generateImage({ prompt: finalPrompt, aspectRatio, ...(sourceUrl ? { source: { url: sourceUrl } } : {}) }),
    );
    if (!metered.ok) return fail("plan_limit", metered.refusal.message, 402);
    const gen = metered.result;
    const landed = await landImage({
      scope: allowed.scope,
      bytes: gen.bytes,
      contentType: gen.contentType,
      model: gen.model,
      jobId: gen.jobId,
      prompt,
      aspectRatio,
    });
    return NextResponse.json({ ok: true, status: "created", ...landed }, { status: 201 });
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Image generation failed.", 502);
  }
}

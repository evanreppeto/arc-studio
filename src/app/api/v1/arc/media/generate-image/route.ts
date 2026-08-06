import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { MEDIA_UNITS, geminiModelForTarget, parseArcRoute } from "@/domain";

import { INVALID_JSON, arcGuard, fail, readJson } from "@/app/api/v1/arc/_lib/http";
import { checkUsageAllowed, usageBlockMessage } from "@/lib/billing/entitlements";
import { getMediaProviderWithKey } from "@/lib/media";
import { resolveWorkspaceTarget } from "@/lib/media-config/target";
import { MEDIA_CONNECTOR_KEY, resolveMediaGeneration } from "@/lib/media/enablement";
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
export async function POST(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;

  const access = await resolveMediaGeneration(allowed.scope.workspaceId);
  if (!access.enabled) return fail("not_configured", access.reason, 503);

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
  if (!prompt) return fail("rejected", "prompt is required.", 400);
  const aspectRatio =
    typeof body.aspect_ratio === "string" && body.aspect_ratio.trim() ? body.aspect_ratio.trim() : "1:1";
  const style = typeof body.style === "string" && body.style.trim() ? body.style.trim() : undefined;

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
  const provider = getMediaProviderWithKey(access.credential, { level, imageModel: geminiModelForTarget(target) });

  try {
    // Harden the prompt (strip embedded text/branding, add quality + caller style)
    // before sending; risk flags stay on the operator's original intent.
    const finalPrompt = hardenImagePrompt(prompt, { style });
    // Platform-credit generations are spend-capped; a workspace's own key bypasses.
    const metered = await meterConnectorCall(
      undefined,
      { orgId: allowed.scope.orgId, workspaceId: allowed.scope.workspaceId, connectorKey: MEDIA_CONNECTOR_KEY, estimatedUnits: MEDIA_UNITS.image, costTier: access.costTier, context: { route: "generate-image" } },
      () => provider.generateImage({ prompt: finalPrompt, aspectRatio }),
    );
    if (!metered.ok) return fail("plan_limit", metered.refusal.message, 402);
    const gen = metered.result;
    const ext = gen.contentType.includes("png") ? "png" : gen.contentType.includes("webp") ? "webp" : "jpg";
    const objectPath = `arc-generated/${allowed.scope.orgId}/${allowed.scope.workspaceId}/${randomUUID()}.${ext}`;
    // Permanent public URL from the campaign-media bucket — no expiry to re-sign.
    const url = await storeGeneratedImage(objectPath, gen.bytes, gen.contentType);
    // Best-effort usage metering — never blocks or fails the generation.
    await recordUsageEvent({
      orgId: allowed.scope.orgId,
      workspaceId: allowed.scope.workspaceId,
      service: "gemini_image",
      model: gen.model,
      units: 1,
      metadata: { route: "generate-image", aspect_ratio: aspectRatio, job_id: gen.jobId },
    });
    const riskFlags = deriveImageRiskFlags(prompt);
    // Put it in the Library (BSR-634). Best-effort: the generation already
    // happened and was already metered, so a failed row must not turn it into an
    // error — the caller still gets the media it paid for.
    const assetId = await recordGeneratedMedia({
      orgId: allowed.scope.orgId,
      objectPath,
      publicUrl: url,
      contentType: gen.contentType,
      kind: "image",
      byteSize: gen.bytes.byteLength,
      prompt,
      model: gen.model,
      jobId: gen.jobId,
      format: aspectRatio,
      riskFlags,
    });
    const media = {
      kind: "image" as const,
      url,
      source: "ai_generated" as const,
      format: aspectRatio,
      model: gen.model,
      jobId: gen.jobId,
      riskFlags,
    };
    return NextResponse.json({ ok: true, status: "created", media, objectPath, ...(assetId ? { libraryAssetId: assetId } : {}) }, { status: 201 });
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Image generation failed.", 502);
  }
}

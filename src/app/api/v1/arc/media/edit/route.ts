import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { parseArcRoute } from "@/domain";
import { INVALID_JSON, arcGuard, fail, readJson } from "@/app/api/v1/arc/_lib/http";
import { assertPublicHttpUrl } from "@/lib/brand-kit/website";
import { meterConnectorCall } from "@/lib/connectors/metering";
import { resolveWorkspaceTarget } from "@/lib/media-config/target";
import { resolveEngineProvider } from "@/lib/media/engine-provider";
import { recordGeneratedMedia } from "@/lib/media/library-record";
import { deriveImageRiskFlags } from "@/lib/media/risk";
import { storeGeneratedMedia } from "@/lib/media/storage";
import { ImageEditUnsupportedError } from "@/lib/media/types";
import { getAppSettings } from "@/lib/settings/store";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const EDITED_RISK =
  "AI-edited from an existing image — check the change did not alter anything the original was proof of.";

/**
 * Change an image that already exists, rather than generating a new one.
 *
 * Arc's only creative verbs were generate and composite, so the answer to "put
 * our logo on the van door" was to regenerate the scene (which loses the picture
 * and never adds the logo) or to composite a corner lockup (which is not what was
 * asked). `compose_creative` was even instructed to TELL the operator that a
 * branded truck was impossible. It was not impossible; there was no edit path.
 *
 * NO_TEXT_DIRECTIVE is deliberately not applied here — see gemini.ts. It exists
 * to stop the model inventing a brand mark when building a scene from nothing;
 * an edit is the operator pointing at a picture they have and saying what to
 * change, frequently "put our real logo there".
 *
 * Bearer-gated, metered, and Library-recorded like every other media route. The
 * result is a draft the caller still has to land in the approval gate — this
 * route never touches outbound.
 *
 *   POST /api/v1/arc/media/edit
 *   { image_url, instruction, format? }
 *   -> 201 { ok, status:"created", media, objectPath }
 */
/**
 * Store a finished edit, record it, describe it. ONE tail for the inline and
 * polled paths — they differ only in where the bytes came from, and a second
 * copy is how one of them ends up not writing a Library row.
 */
async function landEdit(input: {
  scope: { orgId: string; workspaceId: string };
  bytes: Buffer;
  contentType: string;
  model: string;
  jobId: string;
  instruction: string;
  format: string;
}) {
  const ext = input.contentType.includes("png") ? "png" : input.contentType.includes("webp") ? "webp" : "jpg";
  const objectPath = `arc-generated/${input.scope.orgId}/${input.scope.workspaceId}/${randomUUID()}.${ext}`;
  const url = await storeGeneratedMedia(objectPath, input.bytes, input.contentType);
  const media = {
    kind: "image" as const,
    url,
    source: "ai_generated" as const,
    format: input.format,
    model: input.model,
    jobId: input.jobId,
    // An edit inherits whatever the source was proof of AND adds the model's
    // changes on top, so review must treat it as neither a plain photo nor a
    // plain generation.
    riskFlags: [EDITED_RISK, ...deriveImageRiskFlags(input.instruction)],
  };
  await recordGeneratedMedia({
    orgId: input.scope.orgId,
    objectPath,
    publicUrl: url,
    contentType: input.contentType,
    kind: "image",
    byteSize: input.bytes.byteLength,
    prompt: input.instruction,
    model: input.model,
    jobId: input.jobId,
    format: media.format,
    riskFlags: media.riskFlags,
    source: "ai_generated",
    uploadedBy: input.scope.orgId,
  });
  return { media, objectPath };
}

export async function POST(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;

  // NOTE: no gemini-media gate here. Whether generation can run is now answered
  // by resolveEngineProvider below, which asks the engine the target actually
  // names — gating on the Gemini connector first would refuse a workspace whose
  // only connected engine is Higgsfield. A Gemini/Auto target still reaches the
  // same check, with the same operator-actionable reason.

  const body = await readJson(request);
  if (body === INVALID_JSON) return fail("rejected", "Request body must be valid JSON.", 400);

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const imageUrl = str((body as Record<string, unknown>).image_url);
  const instruction = str((body as Record<string, unknown>).instruction);
  // A poll carries the operation name and neither of the above — the edit was
  // fully specified when it started.
  const operationName = str((body as Record<string, unknown>).operation_name);
  const format = str((body as Record<string, unknown>).format) || "1:1";
  if (!operationName) {
    if (!imageUrl) return fail("rejected", "image_url is required.", 400);
    if (!instruction) return fail("rejected", "instruction is required.", 400);
  }

  try {
    const settings = await getAppSettings(allowed.scope.orgId);
    const target = await resolveWorkspaceTarget({
      client: getSupabaseAdminClient(),
      workspaceId: allowed.scope.workspaceId,
      orgId: allowed.scope.orgId,
      category: "image",
      requestOverride: str((body as Record<string, unknown>).model_key) || null,
    });
    // A poll names the engine that started the job; re-deriving it would ask
    // the wrong provider if the workspace default changed mid-render.
    const pollEngine =
      str((body as Record<string, unknown>).engine) === "higgsfield"
        ? ("higgsfield" as const)
        : str((body as Record<string, unknown>).engine) === "gemini"
          ? ("gemini" as const)
          : undefined;
    const engine = await resolveEngineProvider({
      client: getSupabaseAdminClient(),
      workspaceId: allowed.scope.workspaceId,
      target,
      level: parseArcRoute(settings.markDefaultRoute),
      engine: pollEngine,
    });
    if (!engine.ok) return fail("not_configured", engine.reason, 503);
    const provider = engine.provider;

    // ---- POLL an in-flight edit. Never metered: already paid for. ----
    if (operationName) {
      if (!provider.pollImage) return fail("rejected", "That engine does not run image jobs.", 400);
      const poll = await provider.pollImage(operationName);
      if (poll.status === "running") return NextResponse.json({ ok: true, status: "running" }, { status: 200 });
      const landed = await landEdit({
        scope: allowed.scope,
        bytes: poll.bytes,
        contentType: poll.contentType,
        model: poll.model,
        jobId: poll.jobId,
        instruction: str((body as Record<string, unknown>).instruction),
        format,
      });
      return NextResponse.json({ ok: true, status: "created", ...landed }, { status: 201 });
    }

    // The URL arrives from an agent; guard it exactly as the compositor guards
    // its own fetch before reaching out to it.
    assertPublicHttpUrl(imageUrl);

    // ---- START, on engines where an edit is a job ----
    // An edit IS a generation with a reference picture, so it rides the same
    // submit/poll the image route uses rather than a parallel lifecycle.
    if (provider.startImage) {
      const started = await meterConnectorCall(
        undefined,
        {
          orgId: allowed.scope.orgId,
          workspaceId: allowed.scope.workspaceId,
          connectorKey: engine.connectorKey,
          estimatedUnits: 1,
          costTier: engine.costTier,
          context: { surface: "arc", engine: "edit", provider: engine.engine },
        },
        () => provider.startImage!({ prompt: instruction, source: { url: imageUrl } }),
      );
      if (!started.ok) return fail("rejected", started.refusal.message, 429);
      return NextResponse.json(
        { ok: true, status: "running", operationName: started.result.operationName, model: started.result.model, jobId: started.result.jobId, engine: engine.engine },
        { status: 201 },
      );
    }

    // ---- INLINE: Gemini returns the edited bytes in the request ----
    const sourceRes = await fetch(imageUrl);
    if (!sourceRes.ok) return fail("rejected", `Could not read that image (${sourceRes.status}).`, 400);
    const sourceBytes = Buffer.from(await sourceRes.arrayBuffer());
    const sourceType = sourceRes.headers.get("content-type") ?? "image/png";

    const metered = await meterConnectorCall(
      undefined,
      {
        orgId: allowed.scope.orgId,
        workspaceId: allowed.scope.workspaceId,
        connectorKey: engine.connectorKey,
        estimatedUnits: 1,
        costTier: engine.costTier,
        context: { surface: "arc", engine: "edit", provider: engine.engine },
      },
      () => provider.editImage({ bytes: sourceBytes, contentType: sourceType, instruction, sourceUrl: imageUrl }),
    );
    if (!metered.ok) return fail("rejected", metered.refusal.message, 429);
    const gen = metered.result;
    const landed = await landEdit({
      scope: allowed.scope,
      bytes: gen.bytes,
      contentType: gen.contentType,
      model: gen.model,
      jobId: gen.jobId,
      instruction,
      format,
    });
    return NextResponse.json({ ok: true, status: "created", ...landed }, { status: 201 });
  } catch (error) {
    // A model that cannot edit is a capability answer, not a failure — say which
    // model and where to change it, with a status that reads as "not here".
    if (error instanceof ImageEditUnsupportedError) return fail("not_configured", error.message, 503);
    return fail("failed", error instanceof Error ? error.message : "Image edit failed.", 502);
  }
}

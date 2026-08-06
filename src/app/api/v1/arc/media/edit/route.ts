import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { geminiModelForTarget, parseArcRoute } from "@/domain";
import { INVALID_JSON, arcGuard, fail, readJson } from "@/app/api/v1/arc/_lib/http";
import { assertPublicHttpUrl } from "@/lib/brand-kit/website";
import { meterConnectorCall } from "@/lib/connectors/metering";
import { getMediaProviderWithKey } from "@/lib/media";
import { resolveWorkspaceTarget } from "@/lib/media-config/target";
import { MEDIA_CONNECTOR_KEY, resolveMediaGeneration } from "@/lib/media/enablement";
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
export async function POST(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;

  const access = await resolveMediaGeneration(allowed.scope.workspaceId);
  if (!access.enabled) return fail("not_configured", access.reason, 503);

  const body = await readJson(request);
  if (body === INVALID_JSON) return fail("rejected", "Request body must be valid JSON.", 400);

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const imageUrl = str((body as Record<string, unknown>).image_url);
  const instruction = str((body as Record<string, unknown>).instruction);
  if (!imageUrl) return fail("rejected", "image_url is required.", 400);
  if (!instruction) return fail("rejected", "instruction is required.", 400);

  try {
    // The URL arrives from an agent; guard it exactly as the compositor guards
    // its own fetch before reaching out to it.
    assertPublicHttpUrl(imageUrl);
    const sourceRes = await fetch(imageUrl);
    if (!sourceRes.ok) return fail("rejected", `Could not read that image (${sourceRes.status}).`, 400);
    const sourceBytes = Buffer.from(await sourceRes.arrayBuffer());
    const sourceType = sourceRes.headers.get("content-type") ?? "image/png";

    const settings = await getAppSettings(allowed.scope.orgId);
    const target = await resolveWorkspaceTarget({
      client: getSupabaseAdminClient(),
      workspaceId: allowed.scope.workspaceId,
      orgId: allowed.scope.orgId,
      category: "image",
      requestOverride: str((body as Record<string, unknown>).model_key) || null,
    });
    const provider = getMediaProviderWithKey(access.credential, {
      level: parseArcRoute(settings.markDefaultRoute),
      imageModel: geminiModelForTarget(target),
    });

    const metered = await meterConnectorCall(
      undefined,
      {
        orgId: allowed.scope.orgId,
        workspaceId: allowed.scope.workspaceId,
        connectorKey: MEDIA_CONNECTOR_KEY,
        estimatedUnits: 1,
        costTier: access.costTier,
        context: { surface: "arc", engine: "edit" },
      },
      () => provider.editImage({ bytes: sourceBytes, contentType: sourceType, instruction }),
    );
    if (!metered.ok) return fail("rejected", metered.refusal.message, 429);
    const gen = metered.result;

    const ext = gen.contentType.includes("png") ? "png" : gen.contentType.includes("webp") ? "webp" : "jpg";
    const objectPath = `arc-generated/${allowed.scope.orgId}/${allowed.scope.workspaceId}/${randomUUID()}.${ext}`;
    const url = await storeGeneratedMedia(objectPath, gen.bytes, gen.contentType);

    const media = {
      kind: "image" as const,
      url,
      source: "ai_generated" as const,
      format: str((body as Record<string, unknown>).format) || "1:1",
      model: gen.model,
      jobId: gen.jobId,
      // An edit inherits whatever the source was proof of AND adds the model's
      // changes on top, so review must treat it as neither a plain photo nor a
      // plain generation.
      riskFlags: [EDITED_RISK, ...deriveImageRiskFlags(instruction)],
    };

    await recordGeneratedMedia({
      orgId: allowed.scope.orgId,
      objectPath,
      publicUrl: url,
      contentType: gen.contentType,
      kind: "image",
      byteSize: gen.bytes.byteLength,
      prompt: instruction,
      model: gen.model,
      jobId: gen.jobId,
      format: media.format,
      riskFlags: media.riskFlags,
      source: "ai_generated",
      uploadedBy: allowed.scope.orgId,
    });

    return NextResponse.json({ ok: true, status: "created", media, objectPath }, { status: 201 });
  } catch (error) {
    // A model that cannot edit is a capability answer, not a failure — say which
    // model and where to change it, with a status that reads as "not here".
    if (error instanceof ImageEditUnsupportedError) return fail("not_configured", error.message, 503);
    return fail("failed", error instanceof Error ? error.message : "Image edit failed.", 502);
  }
}

"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  type CreativeCopy,
  type CreativeLayoutOverride,
  MEDIA_UNITS,
  geminiModelForTarget,
  normalizeCreativeFormat,
  parseArcRoute,
  selectCreativeTemplate,
  toBrandTokens,
} from "@/domain";
import { recordUsageEvent } from "@/lib/ai-usage/persistence";
import { getCurrentAgentTaskTenantFields } from "@/lib/agent-tasks/scope";
import { getOperatorActor, requireOperator } from "@/lib/auth/operator";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { listBrandLogos } from "@/lib/brand-kit/logos";
import { getBusinessProfile } from "@/lib/brand-kit/persistence";
import { promoteAssetToCampaign, resolveOrCreateCampaign } from "@/lib/campaigns/create";
import { getMediaProviderWithKey, isMediaGenEnabled } from "@/lib/media";
import { resolveWorkspaceTarget } from "@/lib/media-config/target";
import { MEDIA_CONNECTOR_KEY, resolveMediaGeneration } from "@/lib/media/enablement";
import { meterConnectorCall } from "@/lib/connectors/metering";
import { renderCreative } from "@/lib/media/compose/renderer";
import { assertPublicHttpUrl } from "@/lib/brand-kit/website";
import { recordGeneratedMedia } from "@/lib/media/library-record";
import { hardenImagePrompt } from "@/lib/media/prompt";
import { deriveImageRiskFlags } from "@/lib/media/risk";
import { storeGeneratedImage, storeGeneratedMedia } from "@/lib/media/storage";
import { signVideoTicket, verifyVideoTicket } from "@/lib/media/video-ticket";
import { getAppSettings } from "@/lib/settings/store";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { reportDegraded } from "@/lib/observability/report-degraded";

/**
 * Record the spend, at the moment it happens.
 *
 * The provider bills for an image the instant it returns one, so this belongs
 * immediately after the provider call and nowhere later. It used to sit after the
 * upload — and when the upload died on the function budget (#1034), the connector
 * meter held a row for the call while this ledger held none. One spend, two
 * books, one entry, and the usage total quietly understating reality.
 *
 * Degrades rather than throws: the money is already gone, and failing the
 * generation over a bookkeeping write would lose the asset as well as the cash.
 * It reports, because silent is how metering drifts from the invoice (BSR-502).
 */
async function recordSpend(
  orgId: string,
  workspaceId: string | null | undefined,
  gen: { model: string; jobId: string },
  route: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  await recordUsageEvent({
    orgId,
    workspaceId: workspaceId ?? null,
    service: "gemini_image",
    model: gen.model,
    units: 1,
    metadata: { route, job_id: gen.jobId, ...(extra ?? {}) },
  }).catch((error) =>
    reportDegraded(error, {
      scope: "studio.recordUsageEvent",
      surface: "primary",
      detail: { service: "gemini_image", model: gen.model, jobId: gen.jobId, route },
    }),
  );
}

const EDITED_RISK =
  "AI-edited from an existing image — check the change did not alter anything the original was proof of.";

const COMPOSITE_RISK =
  "Real logo overlaid on a background — the background is not proof of a real job.";

// Gemini image aspect ratios (SUPPORTED_ASPECT_RATIOS). Studio offers 4:5, which
// Gemini doesn't support for raw image gen — map it to the nearest portrait. The
// compose path renders 4:5 natively so it doesn't need this.
function imageAspectFor(format: string): string {
  return format === "4:5" ? "3:4" : format;
}

export type StudioMedia = {
  kind: "image" | "video";
  url: string;
  source: "ai_generated" | "composite";
  format: string;
  model?: string;
  jobId?: string;
  riskFlags: string[];
};

/** Veo accepts landscape and portrait only — Studio also offers 1:1 and 4:5. */
const VIDEO_ASPECT = new Set(["16:9", "9:16"]);
function videoAspectFor(format: string): string {
  return VIDEO_ASPECT.has(format) ? format : "16:9";
}


export type GenerateStudioAssetInput = {
  /** "image" = raw AI scene from a prompt; "compose" = finished creative
   *  (background + Brand Kit + copy); "edit" = change a picture that already
   *  exists. Compose is the primary Studio output. */
  engine: "image" | "compose" | "edit";
  /** edit engine: the picture being changed, and what to change about it. */
  sourceImageUrl?: string;
  instruction?: string;
  format: string; // "1:1" | "4:5" | "9:16" | "16:9"
  title: string;
  /** image engine: the scene prompt. */
  prompt?: string;
  style?: string;
  /** compose engine: the background to composite over (an approved/generated URL). */
  backgroundUrl?: string;
  headline?: string;
  kicker?: string;
  /** Optional supporting line under the headline (BSR-691). */
  subhead?: string;
  ctaLabel?: string;
  template?: string;
  /** Accent hex picked in Studio; overrides the brand kit's accent for this render. */
  accent?: string;
  /** The operator's canvas nudge (BSR-680). Clamped again in renderCreative —
   *  this arrives from a client and is not trusted to be in range. */
  layoutOverride?: CreativeLayoutOverride;
  /** The campaign this draft attaches to — required so it enters the approval gate. */
  campaignId: string;
  /**
   * The operator's model pick for THIS generation, engine-qualified
   * (`gemini:gemini-3-pro-image`). Omit for Auto. Re-resolved server-side against
   * the roster and this workspace's reachable engines, so a stale or invented id
   * from the client falls back to Auto rather than reaching the provider.
   */
  model?: string;
};

export type GenerateStudioAssetResult =
  | { ok: true; persisted: boolean; campaignId?: string; assetId?: string; media?: StudioMedia }
  | { ok: false; error: string; code?: "disabled" | "no_campaign" | "failed" };

/**
 * Operator-callable media generation for Studio. The bearer `/api/v1/arc/media/*`
 * routes are for the Cloud Run runner and can't be called from the browser, so this
 * server action runs the same in-process sequence (provider → storage → promote)
 * behind `requireOperator()`. The result is ALWAYS an approval-gated, provenance-
 * tagged draft (`promoteAssetToCampaign` → pending_approval + dispatch_locked); it
 * never touches outbound. Flag-gated by `isMediaGenEnabled()` — a clean off signal
 * when ARC_MEDIA_ENABLED / GEMINI_API_KEY aren't set, not a crash.
 */
export async function generateStudioAsset(input: GenerateStudioAssetInput): Promise<GenerateStudioAssetResult> {
  await requireOperator();

  // Backend-less preview: the legacy env flag is the only possible signal.
  if (!isSupabaseAdminConfigured()) {
    if (!isMediaGenEnabled()) {
      return { ok: false, code: "disabled", error: "Media generation is off in this preview (legacy env flag unset)." };
    }
    return { ok: true, persisted: false };
  }
  if (!input.campaignId.trim()) {
    return { ok: false, code: "no_campaign", error: "Pick a campaign to attach this draft to." };
  }

  try {
    const [ctx, tenant, operator] = await Promise.all([
      getCurrentWorkspaceContext(),
      getCurrentAgentTaskTenantFields(),
      getOperatorActor(),
    ]);
    // Per-workspace gate: the gemini-media connector (platform credits or the
    // workspace's own key), with the legacy env flag as deployment-wide fallback.
    const access = await resolveMediaGeneration(tenant.workspace_id);
    if (!access.enabled) return { ok: false, code: "disabled", error: access.reason };
    const settings = await getAppSettings(ctx.orgId);
    // One resolution for every image-producing engine below. Auto yields
    // undefined and leaves Gemini's own chain (level → env → default) untouched;
    // a pick is pinned as a real argument instead of a hoped-for preference.
    const target = await resolveWorkspaceTarget({
      client: getSupabaseAdminClient(),
      workspaceId: tenant.workspace_id,
      orgId: ctx.orgId,
      category: "image",
      requestOverride: input.model,
    });
    const pinnedImageModel = geminiModelForTarget(target);

    let media: StudioMedia;
    let objectPath: string;
    let assetType: string;
    /** The text that produced this asset — the generation prompt for a generated
     *  image, the rendered headline for a composite. Hoisted because both
     *  branches must supply it: it is the only screenable text creative has. */
    let screenableText: string;
    // The stored object's real size and type, captured where the bytes are, for
    // the Library row written below. Guessing either would put a wrong number on
    // a provenance record.
    let storedBytes = 0;
    let storedContentType = "image/png";

    if (input.engine === "edit") {
      // Change a picture that exists, instead of rolling the dice on a new one.
      // Studio could only ever generate, which is why "put our logo on the van
      // door" was answered with a rule rather than a result.
      const sourceUrl = (input.sourceImageUrl ?? "").trim();
      const instruction = (input.instruction ?? "").trim();
      if (!sourceUrl) return { ok: false, code: "failed", error: "Pick the image you want to change." };
      if (!instruction) return { ok: false, code: "failed", error: "Say what you want changed about it." };
      // Same SSRF guard the compositor uses before fetching an operator-supplied
      // URL — this one arrives from a client too.
      assertPublicHttpUrl(sourceUrl);
      const sourceRes = await fetch(sourceUrl);
      if (!sourceRes.ok) return { ok: false, code: "failed", error: `Couldn't read that image (${sourceRes.status}).` };
      const sourceBytes = Buffer.from(await sourceRes.arrayBuffer());
      const sourceType = sourceRes.headers.get("content-type") ?? "image/png";

      const level = parseArcRoute(settings.markDefaultRoute);
      const provider = getMediaProviderWithKey(access.credential, { level, imageModel: pinnedImageModel });
      const metered = await meterConnectorCall(
        undefined,
        { orgId: ctx.orgId, workspaceId: tenant.workspace_id, connectorKey: MEDIA_CONNECTOR_KEY, estimatedUnits: 1, costTier: access.costTier, context: { surface: "studio", engine: "edit" } },
        () => provider.editImage({ bytes: sourceBytes, contentType: sourceType, instruction }),
      );
      if (!metered.ok) return { ok: false, code: "failed", error: metered.refusal.message };
      const gen = metered.result;
      // Recorded HERE, before storage, because this is where the money was spent.
      // It used to sit after the upload — and when the upload died (the function
      // budget, #1034), the connector meter had a row for the call and this
      // ledger had none. Same spend, two books, one entry. The provider bills for
      // a returned image whether or not we manage to keep it.
      await recordSpend(ctx.orgId, tenant.workspace_id, gen, "studio_edit");
      const ext = gen.contentType.includes("png") ? "png" : gen.contentType.includes("webp") ? "webp" : "jpg";
      objectPath = `arc-generated/${ctx.orgId}/${tenant.workspace_id}/${randomUUID()}.${ext}`;
      const url = await storeGeneratedImage(objectPath, gen.bytes, gen.contentType);
      storedBytes = gen.bytes.byteLength;
      storedContentType = gen.contentType;
      media = {
        kind: "image",
        url,
        source: "ai_generated",
        format: normalizeCreativeFormat(input.format),
        model: gen.model,
        jobId: gen.jobId,
        // An edit inherits the source's claims AND adds the model's: whatever it
        // changed is now model output, on top of a picture whose provenance the
        // operator already judged. Flagged so review does not treat it as either.
        riskFlags: [EDITED_RISK, ...deriveImageRiskFlags(instruction)],
      };
      screenableText = instruction;
      assetType = "image_prompt";
    } else if (input.engine === "image") {
      const prompt = (input.prompt ?? "").trim();
      if (!prompt) return { ok: false, code: "failed", error: "Describe the image you want Arc to generate." };
      const level = parseArcRoute(settings.markDefaultRoute);
      const provider = getMediaProviderWithKey(access.credential, { level, imageModel: pinnedImageModel });
      const aspectRatio = imageAspectFor(input.format);
      // Platform-credit generations are spend-capped; a workspace's own key bypasses.
      const metered = await meterConnectorCall(
        undefined,
        { orgId: ctx.orgId, workspaceId: tenant.workspace_id, connectorKey: MEDIA_CONNECTOR_KEY, estimatedUnits: 1, costTier: access.costTier, context: { surface: "studio", engine: "image" } },
        () => provider.generateImage({ prompt: hardenImagePrompt(prompt, { style: input.style }), aspectRatio }),
      );
      if (!metered.ok) return { ok: false, code: "failed", error: metered.refusal.message };
      const gen = metered.result;
      await recordSpend(ctx.orgId, tenant.workspace_id, gen, "studio_generate", { aspect_ratio: aspectRatio });
      const ext = gen.contentType.includes("png") ? "png" : gen.contentType.includes("webp") ? "webp" : "jpg";
      objectPath = `arc-generated/${ctx.orgId}/${tenant.workspace_id}/${randomUUID()}.${ext}`;
      const url = await storeGeneratedImage(objectPath, gen.bytes, gen.contentType);
      storedBytes = gen.bytes.byteLength;
      storedContentType = gen.contentType;
      media = {
        kind: "image",
        url,
        source: "ai_generated",
        format: aspectRatio,
        model: gen.model,
        jobId: gen.jobId,
        riskFlags: deriveImageRiskFlags(prompt),
      };
      assetType = "image_prompt";
      screenableText = prompt;
    } else {
      const backgroundUrl = (input.backgroundUrl ?? "").trim();
      if (!backgroundUrl) return { ok: false, code: "failed", error: "Select a background photo to compose over." };
      const headline = (input.headline ?? "").trim();
      if (!headline) return { ok: false, code: "failed", error: "A headline is required to compose the creative." };
      const format = normalizeCreativeFormat(input.format);
      const template = selectCreativeTemplate({ hint: input.template ?? null, seed: backgroundUrl });
      const copy: CreativeCopy = {
        headline,
        kicker: (input.kicker ?? "").trim() || undefined,
        subhead: (input.subhead ?? "").trim() || undefined,
        ctaLabel: (input.ctaLabel ?? "").trim() || undefined,
      };
      // The logo SET travels with the profile: the renderer picks the variant
      // that suits the template's logo background, so a workspace whose only
      // dark-on-transparent mark used to vanish into the scrim now gets its
      // knocked-out version.
      const [profile, brandLogos] = await Promise.all([
        getBusinessProfile(ctx.orgId),
        listBrandLogos(ctx.orgId, ctx.workspaceId),
      ]);
      // The workspace's brand kit is the base; the operator's accent pick in Studio
      // overrides it so the rendered creative matches the canvas they approved by
      // eye. Ignored unless it's a well-formed hex, so a junk value can't corrupt
      // the render.
      const baseBrand = toBrandTokens(profile, brandLogos);
      const accentOverride = /^#[0-9a-f]{6}$/i.test((input.accent ?? "").trim()) ? input.accent!.trim() : null;
      const brand = accentOverride ? { ...baseBrand, accent: accentOverride } : baseBrand;
      const { bytes, contentType } = await renderCreative({ template, format, brand, copy, backgroundUrl, layoutOverride: input.layoutOverride });
      objectPath = `arc-composite/${ctx.orgId}/${tenant.workspace_id}/${randomUUID()}.png`;
      const url = await storeGeneratedMedia(objectPath, bytes, contentType);
      storedBytes = bytes.byteLength;
      storedContentType = contentType;
      media = { kind: "image", url, source: "composite", format, riskFlags: [COMPOSITE_RISK] };
      assetType = "social_ad";
      // A composite carries real, operator-authored marketing copy — headline,
      // kicker, subhead, CTA. That is exactly the text the banned-phrase screen
      // exists for, and it was going through unscreened too.
      screenableText = [copy.headline, copy.kicker, copy.subhead, copy.ctaLabel].filter(Boolean).join("\n");
    }

    // Put it in the Library first (BSR-634). Studio wrote to the bucket and
    // promoted a campaign asset without ever writing a `media_assets` row, so
    // Studio creative had no database identity — invisible to /library, to
    // Studio's own background picker, and to every surface that records
    // something ABOUT a picture, including its review state and any decision on
    // it. Best-effort by construction: the render is done and already metered.
    const libraryAssetId = await recordGeneratedMedia({
      orgId: ctx.orgId,
      objectPath,
      publicUrl: media.url,
      contentType: storedContentType,
      kind: "image",
      byteSize: storedBytes,
      // The same text the copy screen runs on — the scene prompt for a generated
      // image, the rendered copy for a composite. One definition of "the text
      // that produced this asset", so the Library's provenance and the approval
      // gate cannot describe it differently.
      prompt: screenableText,
      model: media.model,
      jobId: media.jobId,
      format: media.format,
      riskFlags: media.riskFlags,
      source: media.source === "composite" ? "composite" : "ai_generated",
      uploadedBy: operator,
    });

    // Land the approval-gated draft (pending_approval + dispatch_locked) on the
    // chosen campaign, provenance-tagged. Never unlocks outbound.
    const { campaignId } = await resolveOrCreateCampaign({ operator, campaignId: input.campaignId, tenant });
    const { assetId } = await promoteAssetToCampaign({
      operator,
      campaignId,
      assetType,
      title: input.title.trim() || "Studio creative",
      body: null,
      // The prompt is the only text this asset has. Without it the copy screen
      // has nothing to run on and the creative reaches the approval gate with
      // no automated check of any kind.
      promptInput: screenableText,
      mediaUrl: media.url,
      mediaPath: objectPath,
      media: {
        source: media.source,
        model: media.model,
        jobId: media.jobId,
        format: media.format,
        riskFlags: media.riskFlags,
        // Carries the exact row id into the campaign entry, so the campaign
        // surface joins this picture to its record by primary key instead of
        // falling back to matching storage paths.
        ...(libraryAssetId ? { libraryAssetId } : {}),
      },
      tenant,
    });

    revalidatePath("/studio");
    return { ok: true, persisted: true, campaignId, assetId, media };
  } catch (error) {
    // Report before returning. This catch used to discard the stack and hand the
    // operator `error.message` alone, which is how the compose path could be dead
    // on prod with NOTHING in the logs: "Invalid URL" reached the panel, the
    // server kept no record, and there was no way to learn which of the several
    // URLs in the render was the bad one without shipping a build to find out.
    // The primary action on the page must not fail silently server-side.
    reportDegraded(error, {
      scope: "studio.generateStudioAsset",
      surface: "primary",
      detail: {
        engine: input.engine,
        format: input.format,
        template: input.template ?? null,
        // The values, not the secrets — every URL the render touches, so a bad
        // one is identifiable from the log line alone.
        backgroundUrl: input.backgroundUrl ?? null,
        hasCampaign: Boolean(input.campaignId?.trim()),
      },
    });
    return { ok: false, code: "failed", error: error instanceof Error ? error.message : "Generation failed." };
  }
}

export type StartStudioVideoInput = {
  prompt: string;
  style?: string;
  format: string;
  campaignId: string;
  /** A still to animate. Without it Veo invents a scene from the prompt, which
   *  is what "animate this image" used to do — silently ignoring the image. */
  sourceImageUrl?: string;
  /** The operator's model pick for this clip, engine-qualified. Omit for Auto.
   *  Re-resolved server-side — see GenerateStudioAssetInput.model. */
  model?: string;
};

export type StartStudioVideoResult =
  | { ok: true; operationName: string; ticket: string; model: string; aspectRatio: string }
  | { ok: false; error: string; code?: "disabled" | "no_campaign" | "failed" };

/**
 * Start a Veo render for Studio. Split from the poll below because a video takes
 * 1–3 minutes and a server action cannot hold a request open that long — the
 * client polls `pollStudioVideo` with the returned operation name + ticket.
 *
 * Spend is metered HERE (video ≈ 10 image units) because starting is what costs;
 * a poll of an in-flight job finishes work already paid for.
 */
export async function startStudioVideo(input: StartStudioVideoInput): Promise<StartStudioVideoResult> {
  await requireOperator();

  if (!isSupabaseAdminConfigured()) {
    return { ok: false, code: "disabled", error: "Video generation needs a connected backend." };
  }
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, code: "failed", error: "Describe the video you want Arc to generate." };
  if (!input.campaignId.trim()) {
    return { ok: false, code: "no_campaign", error: "Pick a campaign to attach this draft to." };
  }

  try {
    const [ctx, tenant] = await Promise.all([getCurrentWorkspaceContext(), getCurrentAgentTaskTenantFields()]);
    const access = await resolveMediaGeneration(tenant.workspace_id);
    if (!access.enabled) return { ok: false, code: "disabled", error: access.reason };
    const settings = await getAppSettings(ctx.orgId);
    const level = parseArcRoute(settings.markDefaultRoute);
    const target = await resolveWorkspaceTarget({
      client: getSupabaseAdminClient(),
      workspaceId: tenant.workspace_id,
      orgId: ctx.orgId,
      category: "video",
      requestOverride: input.model,
    });
    const provider = getMediaProviderWithKey(access.credential, {
      level,
      videoModel: geminiModelForTarget(target),
    });
    const aspectRatio = videoAspectFor(input.format);

    // Fetched before metering: a bad URL should cost nothing.
    let startFrame: { bytes: Buffer; contentType: string } | undefined;
    const frameUrl = (input.sourceImageUrl ?? "").trim();
    if (frameUrl) {
      assertPublicHttpUrl(frameUrl);
      const frameRes = await fetch(frameUrl);
      if (!frameRes.ok) return { ok: false, code: "failed", error: `Couldn't read that image (${frameRes.status}).` };
      startFrame = { bytes: Buffer.from(await frameRes.arrayBuffer()), contentType: frameRes.headers.get("content-type") ?? "image/png" };
    }

    // Duration is deliberately NOT exposed: only the model's own default is
    // verified against live Veo, and an unverified knob is how this path shipped
    // broken the first time.
    const metered = await meterConnectorCall(
      undefined,
      {
        orgId: ctx.orgId,
        workspaceId: tenant.workspace_id,
        connectorKey: MEDIA_CONNECTOR_KEY,
        estimatedUnits: MEDIA_UNITS.video,
        costTier: access.costTier,
        context: { surface: "studio", engine: "video" },
      },
      () => provider.startVideo({ prompt: hardenImagePrompt(prompt, { style: input.style }), aspectRatio, image: startFrame }),
    );
    if (!metered.ok) return { ok: false, code: "failed", error: metered.refusal.message };
    const start = metered.result;
    return {
      ok: true,
      operationName: start.operationName,
      ticket: signVideoTicket(start.operationName, tenant.workspace_id ?? ""),
      model: start.model,
      aspectRatio,
    };
  } catch (error) {
    return { ok: false, code: "failed", error: error instanceof Error ? error.message : "Could not start the video." };
  }
}

export type PollStudioVideoInput = {
  operationName: string;
  ticket: string;
  model: string;
  prompt: string;
  format: string;
  title: string;
  campaignId: string;
};

export type PollStudioVideoResult =
  | { ok: true; status: "running" }
  | { ok: true; status: "done"; campaignId: string; assetId: string; media: StudioMedia }
  | { ok: false; error: string };

/** Poll an in-flight Veo render; on completion, store it and land it as an
 *  approval-gated draft on the campaign, exactly like the image path. */
export async function pollStudioVideo(input: PollStudioVideoInput): Promise<PollStudioVideoResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Video generation needs a connected backend." };

  try {
    const [ctx, tenant, operator] = await Promise.all([
      getCurrentWorkspaceContext(),
      getCurrentAgentTaskTenantFields(),
      getOperatorActor(),
    ]);
    if (!verifyVideoTicket(input.ticket, input.operationName, tenant.workspace_id ?? "")) {
      return { ok: false, error: "This video job does not belong to this workspace." };
    }
    const access = await resolveMediaGeneration(tenant.workspace_id);
    if (!access.enabled) return { ok: false, error: access.reason };
    const settings = await getAppSettings(ctx.orgId);
    const provider = getMediaProviderWithKey(access.credential, {
      level: parseArcRoute(settings.markDefaultRoute),
      imageModel: settings.imageModel,
      videoModel: settings.videoModel,
    });

    const result = await provider.pollVideo(input.operationName);
    if (result.status === "running") return { ok: true, status: "running" };

    const objectPath = `arc-generated/${ctx.orgId}/${tenant.workspace_id}/${randomUUID()}.mp4`;
    // Before storage, for the same reason as the image paths: the render is
    // already paid for by the time the poll returns bytes, so a storage failure
    // must not take the ledger write with it.
    await recordUsageEvent({
      orgId: ctx.orgId,
      workspaceId: tenant.workspace_id,
      service: "gemini_video",
      model: input.model,
      units: 1,
      metadata: { route: "studio_generate", engine: "video", aspect_ratio: videoAspectFor(input.format) },
    }).catch((error) =>
      // Same posture as the image path: the render is already billed, so a lost
      // metering write degrades loudly rather than failing the generation.
      reportDegraded(error, {
        scope: "studio.recordUsageEvent",
        surface: "primary",
        detail: { service: "gemini_video", model: input.model },
      }),
    );
    const url = await storeGeneratedMedia(objectPath, result.bytes, result.contentType);

    const media: StudioMedia = {
      kind: "video",
      url,
      source: "ai_generated",
      format: videoAspectFor(input.format),
      model: input.model,
      riskFlags: deriveImageRiskFlags(input.prompt),
    };
    // Same Library row the image paths write — a finished video is creative that
    // has to be reviewable and reusable, not just a URL on a campaign asset.
    const libraryAssetId = await recordGeneratedMedia({
      orgId: ctx.orgId,
      objectPath,
      publicUrl: media.url,
      contentType: result.contentType,
      kind: "video",
      byteSize: result.bytes.byteLength,
      prompt: input.prompt,
      model: input.model,
      format: media.format,
      riskFlags: media.riskFlags,
      uploadedBy: operator,
    });

    const { campaignId } = await resolveOrCreateCampaign({ operator, campaignId: input.campaignId, tenant });
    const { assetId } = await promoteAssetToCampaign({
      operator,
      campaignId,
      assetType: "video_prompt",
      title: input.title.trim() || "Studio video",
      body: null,
      mediaUrl: media.url,
      mediaPath: objectPath,
      media: {
        source: media.source,
        model: media.model,
        format: media.format,
        riskFlags: media.riskFlags,
        ...(libraryAssetId ? { libraryAssetId } : {}),
      },
      tenant,
    });

    revalidatePath("/studio");
    return { ok: true, status: "done", campaignId, assetId, media };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Video generation failed." };
  }
}

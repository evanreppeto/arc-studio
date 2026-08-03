"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  type CreativeCopy,
  type CreativeLayoutOverride,
  normalizeCreativeFormat,
  parseArcRoute,
  selectCreativeTemplate,
  toBrandTokens,
} from "@/domain";
import { recordUsageEvent } from "@/lib/ai-usage/persistence";
import { getCurrentAgentTaskTenantFields } from "@/lib/agent-tasks/scope";
import { getOperatorActor, requireOperator } from "@/lib/auth/operator";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getBusinessProfile } from "@/lib/brand-kit/persistence";
import { promoteAssetToCampaign, resolveOrCreateCampaign } from "@/lib/campaigns/create";
import { getMediaProviderWithKey, isMediaGenEnabled } from "@/lib/media";
import { MEDIA_CONNECTOR_KEY, resolveMediaGeneration } from "@/lib/media/enablement";
import { meterConnectorCall } from "@/lib/connectors/metering";
import { renderCreative } from "@/lib/media/compose/renderer";
import { hardenImagePrompt } from "@/lib/media/prompt";
import { deriveImageRiskFlags } from "@/lib/media/risk";
import { storeGeneratedImage, storeGeneratedMedia } from "@/lib/media/storage";
import { getAppSettings } from "@/lib/settings/store";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { reportDegraded } from "@/lib/observability/report-degraded";

const COMPOSITE_RISK =
  "Real logo overlaid on a background — the background is not proof of a real job.";

// Gemini image aspect ratios (SUPPORTED_ASPECT_RATIOS). Studio offers 4:5, which
// Gemini doesn't support for raw image gen — map it to the nearest portrait. The
// compose path renders 4:5 natively so it doesn't need this.
function imageAspectFor(format: string): string {
  return format === "4:5" ? "3:4" : format;
}

export type StudioMedia = {
  kind: "image";
  url: string;
  source: "ai_generated" | "composite";
  format: string;
  model?: string;
  jobId?: string;
  riskFlags: string[];
};

export type GenerateStudioAssetInput = {
  /** "image" = raw AI scene from a prompt; "compose" = finished creative
   *  (background + Brand Kit + copy). Compose is the primary Studio output. */
  engine: "image" | "compose";
  format: string; // "1:1" | "4:5" | "9:16" | "16:9"
  title: string;
  /** image engine: the scene prompt. */
  prompt?: string;
  style?: string;
  /** compose engine: the background to composite over (an approved/generated URL). */
  backgroundUrl?: string;
  headline?: string;
  kicker?: string;
  ctaLabel?: string;
  template?: string;
  /** Accent hex picked in Studio; overrides the brand kit's accent for this render. */
  accent?: string;
  /** The operator's canvas nudge (BSR-680). Clamped again in renderCreative —
   *  this arrives from a client and is not trusted to be in range. */
  layoutOverride?: CreativeLayoutOverride;
  /** The campaign this draft attaches to — required so it enters the approval gate. */
  campaignId: string;
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

    let media: StudioMedia;
    let objectPath: string;
    let assetType: string;

    if (input.engine === "image") {
      const prompt = (input.prompt ?? "").trim();
      if (!prompt) return { ok: false, code: "failed", error: "Describe the image you want Arc to generate." };
      const level = parseArcRoute(settings.markDefaultRoute);
      const provider = getMediaProviderWithKey(access.credential, { level, imageModel: settings.imageModel, videoModel: settings.videoModel });
      const aspectRatio = imageAspectFor(input.format);
      // Platform-credit generations are spend-capped; a workspace's own key bypasses.
      const metered = await meterConnectorCall(
        undefined,
        { orgId: ctx.orgId, workspaceId: tenant.workspace_id, connectorKey: MEDIA_CONNECTOR_KEY, estimatedUnits: 1, costTier: access.costTier, context: { surface: "studio", engine: "image" } },
        () => provider.generateImage({ prompt: hardenImagePrompt(prompt, { style: input.style }), aspectRatio }),
      );
      if (!metered.ok) return { ok: false, code: "failed", error: metered.refusal.message };
      const gen = metered.result;
      const ext = gen.contentType.includes("png") ? "png" : gen.contentType.includes("webp") ? "webp" : "jpg";
      objectPath = `arc-generated/${ctx.orgId}/${tenant.workspace_id}/${randomUUID()}.${ext}`;
      const url = await storeGeneratedImage(objectPath, gen.bytes, gen.contentType);
      await recordUsageEvent({
        orgId: ctx.orgId,
        workspaceId: tenant.workspace_id,
        service: "gemini_image",
        model: gen.model,
        units: 1,
        metadata: { route: "studio_generate", aspect_ratio: aspectRatio, job_id: gen.jobId },
      }).catch((error) =>
        // The image was generated and the provider WILL bill for it. Losing this
        // write means the spend happened and nothing counted it — the workspace's
        // usage under-reports, and the cap it is measured against drifts from
        // reality. Failing the generation here would be worse (the money is
        // already spent), so it degrades — but silently was how metering could
        // quietly stop matching the invoice (BSR-502).
        reportDegraded(error, {
          scope: "studio.recordUsageEvent",
          surface: "primary",
          detail: { service: "gemini_image", model: gen.model, jobId: gen.jobId },
        }),
      );
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
        ctaLabel: (input.ctaLabel ?? "").trim() || undefined,
      };
      const profile = await getBusinessProfile(ctx.orgId);
      // The workspace's brand kit is the base; the operator's accent pick in Studio
      // overrides it so the rendered creative matches the canvas they approved by
      // eye. Ignored unless it's a well-formed hex, so a junk value can't corrupt
      // the render.
      const baseBrand = toBrandTokens(profile);
      const accentOverride = /^#[0-9a-f]{6}$/i.test((input.accent ?? "").trim()) ? input.accent!.trim() : null;
      const brand = accentOverride ? { ...baseBrand, accent: accentOverride } : baseBrand;
      const { bytes, contentType } = await renderCreative({ template, format, brand, copy, backgroundUrl, layoutOverride: input.layoutOverride });
      objectPath = `arc-composite/${ctx.orgId}/${tenant.workspace_id}/${randomUUID()}.png`;
      const url = await storeGeneratedMedia(objectPath, bytes, contentType);
      media = { kind: "image", url, source: "composite", format, riskFlags: [COMPOSITE_RISK] };
      assetType = "social_ad";
    }

    // Land the approval-gated draft (pending_approval + dispatch_locked) on the
    // chosen campaign, provenance-tagged. Never unlocks outbound.
    const { campaignId } = await resolveOrCreateCampaign({ operator, campaignId: input.campaignId, tenant });
    const { assetId } = await promoteAssetToCampaign({
      operator,
      campaignId,
      assetType,
      title: input.title.trim() || "Studio creative",
      body: null,
      mediaUrl: media.url,
      mediaPath: objectPath,
      media: {
        source: media.source,
        model: media.model,
        jobId: media.jobId,
        format: media.format,
        riskFlags: media.riskFlags,
      },
      tenant,
    });

    revalidatePath("/studio");
    return { ok: true, persisted: true, campaignId, assetId, media };
  } catch (error) {
    return { ok: false, code: "failed", error: error instanceof Error ? error.message : "Generation failed." };
  }
}

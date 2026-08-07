import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  creativeQualityScore,
  normalizeViralityPrediction,
  rankVariants,
  type RawViralityScores,
  type ScoredVariant,
  type ViralityScore,
} from "@/domain";
import { INVALID_JSON, arcGuard, fail, readJson } from "@/app/api/v1/arc/_lib/http";
import { linkConversationToCampaign } from "@/lib/arc-chat/persistence";
import {
  CampaignResolutionError,
  promoteAssetToCampaign,
  resolveOrCreateCampaign,
  type AssetMediaProvenance,
} from "@/lib/campaigns/create";

/**
 * Score → rank → submit a batch of generated ad variants as approval-gated
 * drafts. Arc generates N variants and (for video) calls Higgsfield's
 * virality_predictor per clip, then hands the whole batch here. The route:
 *   - scores each variant by kind (video+analysis → predicted; image → quality
 *     proxy; video WITHOUT analysis → no score, never fabricated),
 *   - ranks the scored variants best-first and submits the top-K,
 *   - persists each pick via the same promoteAssetToCampaign path as the
 *     operator promote / draft-asset flows (campaign_assets + approval gate),
 *   - returns the ranked summary so Arc can explain its pick.
 * No outbound — every asset is pending_approval + locked.
 *
 *   POST /api/v1/arc/campaigns/submit-variants
 *   { campaign_id? | (name + persona + restoration_focus),
 *     asset_type, top_k?, conversation_id?,
 *     variants: [{ title, media_url, media_path?, media?, analysis?,
 *                  dashboard_url?, format_matches_channel?, has_brand?,
 *                  width?, height? }] }
 *   -> 201 { ok, status:"created", campaignId, submitted, ranked }
 */

type VariantInput = {
  title: string;
  media_url: string;
  media_path?: string;
  media?: AssetMediaProvenance; // source/model/jobId/format/riskFlags
  analysis?: RawViralityScores; // raw virality_predictor analysis.scores (video)
  dashboard_url?: string;
  format_matches_channel?: boolean; // image proxy signals
  has_brand?: boolean;
  width?: number;
  height?: number;
};

type Body = {
  campaign_id?: string;
  name?: string;
  persona?: string;
  campaign_theme?: string;
  restoration_focus?: string;
  asset_type?: string;
  top_k?: number;
  conversation_id?: string;
  variants?: VariantInput[];
};

/** A variant carrying its raw input + a possibly-null score. `rankVariants` reads
 *  only id/kind/score, and we only pass it the already-non-null subset, so the
 *  extra `input` key + nullable score never reach it. */
type ScoredWithInput = Omit<ScoredVariant, "score"> & { input: VariantInput; score: ViralityScore | null };

export async function POST(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;
  const tenant = { org_id: allowed.scope.orgId, workspace_id: allowed.scope.workspaceId };

  const payload = await readJson(request);
  if (payload === INVALID_JSON || typeof payload !== "object" || payload === null) {
    return fail("rejected", "Request body must be valid JSON.", 400);
  }
  const body = payload as Body;
  const variants = Array.isArray(body.variants) ? body.variants : [];

  const assetTypeIn = typeof body.asset_type === "string" ? body.asset_type.trim() : "";
  const isVideo = assetTypeIn.includes("video");
  const assetType = assetTypeIn || (isVideo ? "video_ad" : "image_prompt");
  const topK = typeof body.top_k === "number" && body.top_k > 0 ? body.top_k : 2;

  // Score each variant by kind. Three cases:
  //  - video WITH predictor analysis → predicted score
  //  - image                          → computed quality proxy
  //  - video WITHOUT analysis (predictor unavailable / connector not live)
  //                                   → no score; degrade gracefully, never fabricate
  const scored: ScoredWithInput[] = variants.map((v, i) => {
    let score: ViralityScore | null;
    if (isVideo) {
      score = v.analysis ? normalizeViralityPrediction(v.analysis, { dashboardUrl: v.dashboard_url }) : null;
    } else {
      score = creativeQualityScore({
        riskFlags: v.media?.riskFlags ?? [],
        formatMatchesChannel: v.format_matches_channel ?? true,
        hasBrand: v.has_brand ?? false,
        width: v.width ?? null,
        height: v.height ?? null,
      });
    }
    return { id: String(i), kind: isVideo ? "video" : "image", score, input: v };
  });

  // Rank the variants that have a score and submit the top-K of those. A batch is
  // expected to be uniform (all scored or none), so a partial mix isn't a designed
  // case: when some variants scored, the unscored ones are intentionally dropped
  // here. They only resurface in the full-degradation fallback below.
  const withScore = scored.filter((s): s is ScoredWithInput & { score: ViralityScore } => s.score !== null);
  const withoutScore = scored.filter((s) => s.score === null);
  const ranked = rankVariants(withScore, topK);
  const rankedTopK = ranked.topK as ScoredWithInput[];
  // If NOTHING scored at all (e.g. predictor unavailable), fall back to submitting
  // the first top_k variants unranked so the work still reaches approval.
  const toSubmit: ScoredWithInput[] = rankedTopK.length > 0 ? rankedTopK : withoutScore.slice(0, topK);

  try {
    let campaignId: string;
    try {
      ({ campaignId } = await resolveOrCreateCampaign({
        operator: "Arc",
        campaignId: body.campaign_id,
        name: body.name,
        persona: body.persona,
        campaignTheme: body.campaign_theme,
        restorationFocus: body.restoration_focus,
        agentName: "Arc",
        // Declared, because this route's whole purpose fixes the answer: it
        // submits generated variants, so a campaign it CREATES holds creative
        // and nothing else. Ignored when `campaign_id` is given — attaching
        // variants to an existing campaign does not reclassify that campaign.
        kind: "creative_batch",
        tenant,
      }));
    } catch (error) {
      if (error instanceof CampaignResolutionError) return fail("rejected", error.message, 400);
      throw error;
    }

    const submitted: Array<{ assetId: string; title: string }> = [];
    for (const variant of toSubmit) {
      const v = variant.input;
      const score = variant.score;
      const { assetId } = await promoteAssetToCampaign({
        operator: "Arc",
        campaignId,
        assetType,
        title: v.title,
        body: null,
        mediaUrl: v.media_url,
        mediaPath: v.media_path ?? null,
        media: { ...(v.media ?? {}), ...(score ? { virality: score } : {}) },
        agentName: "Arc",
        tenant,
      });
      submitted.push({ assetId, title: v.title });
    }

    const conversationId = typeof body.conversation_id === "string" ? body.conversation_id.trim() : "";
    if (conversationId) {
      await linkConversationToCampaign(conversationId, campaignId, body.name?.trim() || "Campaign workspace").catch(() => undefined);
    }

    // Bust the campaigns list + detail caches so the drafts show up immediately.
    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);

    return NextResponse.json(
      {
        ok: true,
        status: "created",
        campaignId,
        submitted,
        ranked: {
          rationale: ranked.rationale,
          topK: rankedTopK.map((v) => ({ title: v.input.title, score: v.score })),
          ordered: (ranked.ordered as ScoredWithInput[]).map((v) => ({ title: v.input.title, score: v.score })),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Failed to submit variants.", 502);
  }
}

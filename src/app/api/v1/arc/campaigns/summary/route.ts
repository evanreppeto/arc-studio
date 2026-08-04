import { revalidatePath } from "next/cache";

import { INVALID_JSON, arcGuard, fail, ok, readJson } from "@/app/api/v1/arc/_lib/http";
import { recordCampaignPackageSummary } from "@/lib/campaigns/create";

/**
 * Record a campaign's package-level summary. Metadata only — no asset, no
 * approval item, nothing outbound.
 *
 * Why this exists: `create_campaign_draft` was the ONLY path that could write
 * these fields onto an existing campaign, so documenting one meant creating a
 * deliverable to carry the metadata. Arc hit this on prod and named it exactly:
 * "there's no pure metadata path". It then minted a documentation asset that
 * nobody would ever send, which lands in the approval queue as work to review.
 *
 * A campaign now has somewhere to record what it is without pretending that is
 * a thing to approve.
 *
 *   POST /api/v1/arc/campaigns/summary
 *   { campaign_id, objective?, audience_summary?, handoff_note?,
 *     considered_audiences?: [{ label, reason, size_estimate? }] }
 *   -> 200 { ok, status:"recorded", campaignId }
 *
 * Additive: an omitted field is left alone, so several calls can build the
 * summary up without a later one blanking an earlier one.
 */
export async function POST(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;
  const tenant = { org_id: allowed.scope.orgId, workspace_id: allowed.scope.workspaceId };

  const payload = await readJson(request);
  if (payload === INVALID_JSON || typeof payload !== "object" || payload === null) {
    return fail("rejected", "Request body must be valid JSON.", 400);
  }
  const body = payload as Record<string, unknown>;

  const campaignId = typeof body.campaign_id === "string" ? body.campaign_id.trim() : "";
  if (!campaignId) return fail("rejected", "campaign_id is required.", 400);

  // Reject a short id rather than silently matching nothing. Arc reached for the
  // 8-char prefix it had in conversation on its first attempt at this; a 200 that
  // updated zero rows would have looked like success.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(campaignId)) {
    return fail("rejected", `campaign_id must be a full UUID, got "${campaignId}".`, 400);
  }

  try {
    const updated = await recordCampaignPackageSummary({
      campaignId,
      objective: body.objective,
      audienceSummary: body.audience_summary,
      handoffNote: body.handoff_note,
      // snake_case on the wire like every other field here; camelCase in storage.
      // Unmapped, `size_estimate` parses to undefined and the number is lost.
      consideredAudiences: Array.isArray(body.considered_audiences)
        ? body.considered_audiences.map((entry) => {
            const e = (entry ?? {}) as Record<string, unknown>;
            return { label: e.label, reason: e.reason, sizeEstimate: e.size_estimate ?? e.sizeEstimate };
          })
        : body.considered_audiences,
      tenant,
    });

    // "Nothing was written" is a real outcome and must not read as success —
    // it means every field was absent or failed validation.
    if (!updated) {
      return fail(
        "rejected",
        "Nothing to record. Supply at least one of objective, audience_summary, handoff_note, or considered_audiences (each entry needs a label AND a reason).",
        400,
      );
    }

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
    return ok({ status: "recorded", campaignId });
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Failed to record the campaign summary.", 502);
  }
}

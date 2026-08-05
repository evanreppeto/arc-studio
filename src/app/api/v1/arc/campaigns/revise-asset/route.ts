import { revalidatePath } from "next/cache";

import { INVALID_JSON, arcGuard, fail, ok, readJson } from "@/app/api/v1/arc/_lib/http";
import { reviseCampaignAsset } from "@/lib/campaigns/revise-asset";

/**
 * Lets Arc rewrite an EXISTING campaign asset's copy — the write path a revision
 * request needs. Everything stays approval-gated: the asset goes back into the
 * human queue and `dispatch_locked` is untouched.
 *
 *   POST /api/v1/arc/campaigns/revise-asset
 *   { asset_id, body?, title?, summary? }
 *   -> 200 { ok, status:"revised", assetId, campaignId, assetType, title, body,
 *            assetStatus, approvalItemId, blockedPhrases }
 *
 * The refusals are the point. A revision that wrote nothing used to report
 * success, so each one answers with a reason Arc can repeat to the operator
 * rather than a 200 it can mistake for a change.
 */
export async function POST(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;

  const payload = await readJson(request);
  if (payload === INVALID_JSON || typeof payload !== "object" || payload === null) {
    return fail("rejected", "Request body must be valid JSON.", 400);
  }
  const body = payload as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const assetId = str(body.asset_id);
  if (!assetId) return fail("rejected", "asset_id is required — name the asset you are revising.", 400);

  const revisedBody = str(body.body);
  const title = str(body.title);
  if (!revisedBody && !title) {
    return fail("rejected", "Pass the complete revised body (and/or a new title). Nothing was written.", 400);
  }

  try {
    const result = await reviseCampaignAsset({
      assetId,
      ...(revisedBody ? { body: revisedBody } : {}),
      ...(title ? { title } : {}),
      ...(str(body.summary) ? { summary: str(body.summary) } : {}),
      orgId: allowed.scope.orgId,
      workspaceId: allowed.scope.workspaceId,
    });

    if (!result.ok) {
      if (result.reason === "not_found") {
        return fail("not_found", "No campaign asset with that id in this workspace.", 404);
      }
      if (result.reason === "already_approved") {
        return fail(
          "rejected",
          "That asset is already approved, so its copy is frozen. Create a new draft asset instead of editing what the operator signed off.",
          409,
        );
      }
      if (result.reason === "unchanged") {
        return fail(
          "rejected",
          "The copy you sent is identical to what is already on the asset — nothing was written. Send the full revised text, not the original.",
          400,
        );
      }
      return fail("rejected", "Pass the complete revised body (and/or a new title). Nothing was written.", 400);
    }

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${result.campaignId}`);

    return ok({
      status: "revised",
      assetId: result.assetId,
      campaignId: result.campaignId,
      assetType: result.assetType,
      title: result.title,
      body: result.body,
      assetStatus: result.status,
      approvalItemId: result.approvalItemId,
      blockedPhrases: result.blockedPhrases,
    });
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Failed to revise the campaign asset.", 502);
  }
}

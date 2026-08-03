import { arcGuard, fail, ok } from "@/app/api/v1/arc/_lib/http";
import { getCampaignWorkspaceList } from "@/lib/campaigns/read-model";

/**
 * List campaign packages for Arc to read. Read-only — launching/dispatching
 * stays behind the human gate (campaigns.launch_locked).
 *
 *   GET /api/v1/arc/campaigns?status=pending_approval&needs_review=true&limit=20
 */
export async function GET(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const needsReview = url.searchParams.get("needs_review") === "true";
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? limitParam : undefined;

  try {
    const list = await getCampaignWorkspaceList(undefined, "Arc", allowed.scope.orgId, allowed.scope.workspaceId);
    if (list.status !== "live") {
      return fail("failed", list.message ?? "Campaigns are unavailable.", 502);
    }

    let campaigns = list.campaigns;
    if (statusParam) {
      campaigns = campaigns.filter((campaign) => campaign.status === statusParam);
    }
    if (needsReview) {
      campaigns = campaigns.filter((campaign) => campaign.pendingCount > 0);
    }
    if (limit) {
      campaigns = campaigns.slice(0, limit);
    }

    return ok({ campaigns });
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Failed to list campaigns.", 502);
  }
}

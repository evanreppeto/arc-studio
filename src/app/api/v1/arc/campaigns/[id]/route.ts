import { arcGuard, fail, ok } from "@/app/api/v1/arc/_lib/http";
import { getCampaignWorkspaceDetail } from "@/lib/campaigns/read-model";

/**
 * Full campaign workspace detail (assets, approvals, media, sources, launch
 * state). Read-only.
 *
 *   GET /api/v1/arc/campaigns/:id
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;

  const { id } = await params;

  try {
    const detail = await getCampaignWorkspaceDetail(id, undefined, "Arc", allowed.scope.orgId, allowed.scope.workspaceId);
    if (detail.status === "not_found") {
      return fail("not_found", "No campaign with that id.", 404);
    }
    if (detail.status === "unavailable") {
      return fail("failed", detail.message ?? "Campaign is unavailable.", 502);
    }
    return ok({ campaign: detail });
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Failed to read campaign.", 502);
  }
}

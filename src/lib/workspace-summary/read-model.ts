import { cache } from "react";

import { getRecentActivity, type ActivityEntry } from "@/lib/activity/read-model";
import { listApprovalCards, type ApprovalCard } from "@/lib/approvals/read-model";
import { getCampaignWorkspaceList, type CampaignWorkspaceListItem } from "@/lib/campaigns/read-model";
import { getCrmNavCounts, type CrmObjectKey } from "@/lib/crm/read-model";
import { listOpenOpportunities } from "@/lib/opportunities/read-model";

type OpportunityRecord = Awaited<ReturnType<typeof listOpenOpportunities>>[number];

const LIVE_CAMPAIGN_STATUS = /live|active|sending/i;
const EMPTY_CRM_COUNTS: Record<CrmObjectKey, number> = {
  companies: 0,
  contacts: 0,
  properties: 0,
  leads: 0,
  jobs: 0,
  outcomes: 0,
};

export type WorkspaceSummary = {
  approvals: ApprovalCard[];
  opportunities: OpportunityRecord[];
  campaigns: CampaignWorkspaceListItem[];
  campaignTotals: { total: number; live: number };
  crm: Record<CrmObjectKey, number>;
  activity: ActivityEntry[];
};

/**
 * One consistent snapshot of a workspace, assembled from the same per-domain
 * read-models the individual screens already use (each demo-safe on its own).
 * Anything that reads from here — the home dashboard today, nav badges and other
 * roll-ups next — stays in sync by construction: the numbers are computed once,
 * together, instead of each surface counting its own way and drifting apart.
 *
 * Every source is wrapped so one unavailable domain degrades to empty rather
 * than taking the whole summary down.
 */
export const getWorkspaceSummary = cache(async function getWorkspaceSummary(
  orgId: string,
  agentName = "Arc",
  workspaceId?: string | null,
): Promise<WorkspaceSummary> {
  const [approvals, campaignList, opportunities, crmCounts, activity] = await Promise.all([
    listApprovalCards({ orgId, agentName, limit: 5 }).catch(() => [] as ApprovalCard[]),
    getCampaignWorkspaceList(undefined, agentName, orgId, workspaceId).catch(() => ({ status: "unavailable" as const })),
    listOpenOpportunities(undefined, orgId).catch(() => [] as OpportunityRecord[]),
    getCrmNavCounts().catch(() => null),
    getRecentActivity({ limit: 6 }, undefined, orgId).catch(() => null),
  ]);

  const campaigns = campaignList.status === "live" ? campaignList.campaigns : [];
  const campaignTotals = {
    total: campaignList.status === "live" ? campaignList.totals.campaigns : 0,
    live: campaigns.filter((camp) => LIVE_CAMPAIGN_STATUS.test(camp.status)).length,
  };
  const crm = crmCounts && crmCounts.status === "live" ? crmCounts.counts : EMPTY_CRM_COUNTS;
  const activityEntries = activity && activity.status === "live" ? activity.entries : [];

  return { approvals, opportunities, campaigns, campaignTotals, crm, activity: activityEntries };
});

/**
 * Attention counts for the nav rail, keyed by route href, derived from the same
 * summary the screens render — so a badge on "Opportunities" always equals the
 * "N open" the Opportunities screen shows, and "Campaigns" equals the "waiting
 * on you" queue. Only nonzero counts are included (the rail shows no zero pills).
 */
export async function getNavBadges(orgId: string, agentName = "Arc"): Promise<Record<string, number>> {
  const summary = await getWorkspaceSummary(orgId, agentName);
  const badges: Record<string, number> = {};
  if (summary.approvals.length > 0) badges["/campaigns"] = summary.approvals.length;
  if (summary.opportunities.length > 0) badges["/opportunities"] = summary.opportunities.length;
  return badges;
}

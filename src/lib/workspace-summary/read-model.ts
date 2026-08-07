import { cache } from "react";

import { getRecentActivity, type ActivityEntry } from "@/lib/activity/read-model";
import {
  countApprovalsWaitingOnOperator,
  isWaitingOnOperator,
  listApprovalCards,
  type ApprovalCard,
} from "@/lib/approvals/read-model";
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
  /** Every approval in an active state — including ones Arc is reworking. */
  approvals: ApprovalCard[];
  /**
   * The subset actually blocked on a human, and a true COUNT of them rather
   * than `approvals.length` (BSR-753).
   *
   * `approvals` is fetched with a limit, so its length is a page size, not a
   * total — the nav badge read 5 beside 7 active items for exactly that reason.
   * Anything claiming "N things need you" reads this.
   */
  approvalsNeedingYou: ApprovalCard[];
  approvalsNeedingYouCount: number;
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
  const [approvals, waitingCount, campaignList, opportunities, crmCounts, activity] = await Promise.all([
    listApprovalCards({ orgId, agentName, limit: 5 }).catch(() => [] as ApprovalCard[]),
    // A real count, uncapped — see `approvalsNeedingYouCount`. Never allowed to
    // take the summary down: a failed count degrades to the page-length below.
    countApprovalsWaitingOnOperator(orgId, workspaceId).catch(() => null),
    getCampaignWorkspaceList(undefined, agentName, orgId, workspaceId).catch(() => ({ status: "unavailable" as const })),
    listOpenOpportunities(undefined, orgId, workspaceId).catch(() => [] as OpportunityRecord[]),
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

  const approvalsNeedingYou = approvals.filter((card) => isWaitingOnOperator(card.status));

  return {
    approvals,
    approvalsNeedingYou,
    // The count query is authoritative; the filtered page is the fallback, and
    // it can only undercount — never claim more work than there is.
    approvalsNeedingYouCount: waitingCount ?? approvalsNeedingYou.length,
    opportunities,
    campaigns,
    campaignTotals,
    crm,
    activity: activityEntries,
  };
});

/**
 * Attention counts for the nav rail, keyed by route href, derived from the same
 * summary the screens render — so a badge on "Opportunities" always equals the
 * "N open" the Opportunities screen shows, and "Campaigns" equals the "waiting
 * on you" queue. Only nonzero counts are included (the rail shows no zero pills).
 *
 * `workspaceId` is not optional in spirit — pass the one the shell resolved.
 *
 * It used to be omitted entirely, and that broke the promise in the paragraph
 * above two different ways. The rail counted the whole ORG while the Campaigns
 * page it points at counted one WORKSPACE, so the two agree only while every
 * org has exactly one workspace — which is true of both live orgs today and is
 * precisely why nobody could see it. And because `getWorkspaceSummary` is a
 * React `cache()`, calling it here with a different argument list than the Home
 * screen uses missed the cache outright: the same six queries ran twice per
 * render of every signed-in page.
 */
export async function getNavBadges(
  orgId: string,
  agentName = "Arc",
  workspaceId?: string | null,
): Promise<Record<string, number>> {
  const summary = await getWorkspaceSummary(orgId, agentName, workspaceId);
  const badges: Record<string, number> = {};
  if (summary.approvalsNeedingYouCount > 0) badges["/campaigns"] = summary.approvalsNeedingYouCount;
  if (summary.opportunities.length > 0) badges["/opportunities"] = summary.opportunities.length;
  return badges;
}

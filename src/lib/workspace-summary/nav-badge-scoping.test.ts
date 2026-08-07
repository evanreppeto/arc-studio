import { describe, expect, it, vi } from "vitest";

import { countApprovalsWaitingOnOperator } from "@/lib/approvals/read-model";
import { listOpenOpportunities } from "@/lib/opportunities/read-model";
import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

/**
 * The nav rail must count the same set as the page it points at.
 *
 * It didn't. `getNavBadges` called `getWorkspaceSummary(orgId, agentName)` with
 * no workspace, and the two reads behind the badges — the waiting-approvals
 * count and the open-opportunities list — filtered on `org_id` alone. The
 * Campaigns page it badges is workspace-scoped (`getCampaignWorkspaceList`
 * takes a workspaceId), so the rail counted the ORG beside a page showing one
 * WORKSPACE.
 *
 * That is invisible while every org has exactly one workspace, which is true of
 * both live orgs and is exactly why it survived. Verified against prod inside a
 * rolled-back transaction: with the live org's 15 waiting approvals split 11/4
 * across two workspaces, the org-scoped read returns 15 on both — so the rail
 * would badge 15 next to a Campaigns page listing 11.
 *
 * `approval_items.workspace_id` and `opportunities.workspace_id` are both NOT
 * NULL in the database, so the rows were always scoped; only the reads weren't.
 */

const OPPORTUNITY_ROWS = { opportunities: { data: [], error: null } };
const APPROVAL_ROWS = { approval_items: { data: [], error: null, count: 0 } };

function eqCalls(supabase: ReturnType<typeof createSupabaseQueryMock>): Array<[string, unknown]> {
  return supabase.calls
    .filter(([method]) => method === "eq")
    .map(([, column, value]) => [String(column), value] as [string, unknown]);
}

describe("open opportunities narrow to a workspace when given one", () => {
  it("filters on workspace_id alongside org_id", async () => {
    const supabase = createSupabaseQueryMock(OPPORTUNITY_ROWS);

    await listOpenOpportunities(supabase, "org-1", "ws-1");

    expect(eqCalls(supabase)).toContainEqual(["org_id", "org-1"]);
    expect(eqCalls(supabase)).toContainEqual(["workspace_id", "ws-1"]);
  });

  /**
   * The filter is skipped, NOT written as an impossible one. A bearer-token API
   * route (`/api/v1/arc/opportunities`) and the offline preview have no
   * workspace to resolve; scoping them to `null` would read zero rows and
   * present it as "you have no opportunities".
   */
  it.each([undefined, null])("adds no workspace filter when given %s", async (workspaceId) => {
    const supabase = createSupabaseQueryMock(OPPORTUNITY_ROWS);

    await listOpenOpportunities(supabase, "org-1", workspaceId);

    expect(eqCalls(supabase)).toContainEqual(["org_id", "org-1"]);
    expect(eqCalls(supabase).map(([column]) => column)).not.toContain("workspace_id");
  });
});

describe("the waiting-approvals count narrows to a workspace when given one", () => {
  it("filters on workspace_id alongside org_id", async () => {
    const supabase = createSupabaseQueryMock(APPROVAL_ROWS);

    await countApprovalsWaitingOnOperator("org-1", "ws-1", supabase);

    expect(eqCalls(supabase)).toContainEqual(["org_id", "org-1"]);
    expect(eqCalls(supabase)).toContainEqual(["workspace_id", "ws-1"]);
  });

  it.each([undefined, null])("adds no workspace filter when given %s", async (workspaceId) => {
    const supabase = createSupabaseQueryMock(APPROVAL_ROWS);

    await countApprovalsWaitingOnOperator("org-1", workspaceId, supabase);

    expect(eqCalls(supabase)).toContainEqual(["org_id", "org-1"]);
    expect(eqCalls(supabase).map(([column]) => column)).not.toContain("workspace_id");
  });

  it("still counts the whole queue, not a page of it", async () => {
    const supabase = createSupabaseQueryMock(APPROVAL_ROWS);

    await countApprovalsWaitingOnOperator("org-1", "ws-1", supabase);

    // A `limit` here would reintroduce the page-size bug the count exists to
    // fix — see `countApprovalsWaitingOnOperator`.
    expect(supabase.calls.map(([method]) => method)).not.toContain("limit");
  });
});

describe("getNavBadges hands its workspace down to the reads", () => {
  /**
   * Asserted at the READ MODELS, not with a spy on `getWorkspaceSummary`:
   * `getNavBadges` calls that function directly inside its own module, so a
   * spy on the export never intercepts it and the test passes on any
   * implementation. What matters anyway is that the workspace reaches the
   * queries — that is what makes the badge count the right rows.
   *
   * This is also a cache fix. `getWorkspaceSummary` is a React `cache()`, so
   * calling it from the layout with a shorter argument list than Home uses
   * missed the cache outright — the same six queries ran twice on every
   * signed-in page. Both call sites now pass the same three arguments.
   */
  it("passes the workspace to the approvals count and the opportunities list", async () => {
    vi.resetModules();

    const countApprovals = vi.fn(async () => 11);
    const listOpps = vi.fn(async () => [{ id: "o1" }, { id: "o2" }]);

    vi.doMock("@/lib/approvals/read-model", () => ({
      countApprovalsWaitingOnOperator: countApprovals,
      isWaitingOnOperator: () => true,
      listApprovalCards: vi.fn(async () => []),
    }));
    vi.doMock("@/lib/opportunities/read-model", () => ({ listOpenOpportunities: listOpps }));
    vi.doMock("@/lib/campaigns/read-model", () => ({
      getCampaignWorkspaceList: vi.fn(async () => ({ status: "unavailable" })),
    }));
    vi.doMock("@/lib/crm/read-model", () => ({ getCrmNavCounts: vi.fn(async () => null) }));
    vi.doMock("@/lib/activity/read-model", () => ({ getRecentActivity: vi.fn(async () => null) }));

    const { getNavBadges } = await import("./read-model");
    const badges = await getNavBadges("org-1", "Arc", "ws-1");

    expect(countApprovals).toHaveBeenCalledWith("org-1", "ws-1");
    expect(listOpps).toHaveBeenCalledWith(undefined, "org-1", "ws-1");
    expect(badges["/campaigns"]).toBe(11);
    expect(badges["/opportunities"]).toBe(2);

    vi.doUnmock("@/lib/approvals/read-model");
    vi.doUnmock("@/lib/opportunities/read-model");
    vi.doUnmock("@/lib/campaigns/read-model");
    vi.doUnmock("@/lib/crm/read-model");
    vi.doUnmock("@/lib/activity/read-model");
    vi.resetModules();
  });
});

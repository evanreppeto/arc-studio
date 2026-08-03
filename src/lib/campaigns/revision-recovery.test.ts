import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { listStalledRevisions, redispatchStalledRevision, STALLED_REVISION_MS } from "./revision-recovery";

const notifyArcCampaignTask = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/lib/arc-chat/notify", () => ({ notifyArcCampaignTask }));

function filters(supabase: { calls: Array<[string, ...unknown[]]> }): Array<[string, unknown]> {
  return supabase.calls
    .filter(([method]) => method === "eq" || method === "lt")
    .map(([, column, value]) => [column as string, value]);
}

const OLD = new Date(Date.now() - 30 * 60_000).toISOString();

describe("listStalledRevisions", () => {
  beforeEach(() => {
    notifyArcCampaignTask.mockClear();
    notifyArcCampaignTask.mockResolvedValue(true);
  });

  it("returns queued revision tasks with the instruction the operator typed", async () => {
    const supabase = createSupabaseQueryMock({
      agent_tasks: {
        data: [
          {
            id: "task-1",
            source_id: "asset-1",
            campaign_id: "camp-1",
            objective: "Add the truck in the driveway",
            metadata: { human_instruction: "Add the truck in the driveway" },
            created_at: OLD,
            status: "queued",
          },
        ],
        error: null,
      },
    });

    const stalled = await listStalledRevisions({ campaignId: "camp-1", orgId: "org-1" }, supabase);

    expect(stalled).toEqual([
      {
        agentTaskId: "task-1",
        assetId: "asset-1",
        instruction: "Add the truck in the driveway",
        requestedAt: OLD,
      },
    ]);
  });

  /**
   * The scoping this read depends on. It runs on the service-role client, so
   * these filters are the ONLY thing keeping one workspace's stranded work off
   * another workspace's screen — and the only thing keeping a task that is
   * actually running from being offered for a duplicate retry.
   */
  it("scopes to the org, the campaign, queued only, and older than the cutoff", async () => {
    const supabase = createSupabaseQueryMock({ agent_tasks: { data: [], error: null } });

    const before = Date.now();
    await listStalledRevisions({ campaignId: "camp-1", orgId: "org-1" }, supabase);

    const applied = filters(supabase);
    expect(applied).toContainEqual(["org_id", "org-1"]);
    expect(applied).toContainEqual(["campaign_id", "camp-1"]);
    expect(applied).toContainEqual(["task_type", "campaign_asset_revision"]);
    expect(applied).toContainEqual(["status", "queued"]);

    const cutoff = applied.find(([column]) => column === "created_at")?.[1] as string;
    expect(cutoff).toBeTruthy();
    // The cutoff really is in the past by the stale window, not "now".
    expect(Date.parse(cutoff)).toBeLessThanOrEqual(before - STALLED_REVISION_MS + 1_000);
  });

  it("drops rows with no source asset rather than guessing which asset to retry", async () => {
    const supabase = createSupabaseQueryMock({
      agent_tasks: {
        data: [
          { id: "task-1", source_id: null, campaign_id: "camp-1", objective: "x", metadata: {}, created_at: OLD, status: "queued" },
          { id: "task-2", source_id: "asset-2", campaign_id: "camp-1", objective: "y", metadata: {}, created_at: OLD, status: "queued" },
        ],
        error: null,
      },
    });

    const stalled = await listStalledRevisions({ campaignId: "camp-1", orgId: "org-1" }, supabase);
    expect(stalled.map((s) => s.agentTaskId)).toEqual(["task-2"]);
  });

  it("falls back to the objective when no human_instruction was recorded", async () => {
    const supabase = createSupabaseQueryMock({
      agent_tasks: {
        data: [{ id: "t", source_id: "a", campaign_id: "camp-1", objective: "Shorten the subject", metadata: null, created_at: OLD, status: "queued" }],
        error: null,
      },
    });

    const [stalled] = await listStalledRevisions({ campaignId: "camp-1", orgId: "org-1" }, supabase);
    expect(stalled.instruction).toBe("Shorten the subject");
  });
});

describe("redispatchStalledRevision", () => {
  beforeEach(() => {
    notifyArcCampaignTask.mockClear();
    notifyArcCampaignTask.mockResolvedValue(true);
  });

  it("re-wakes the EXISTING task rather than queueing a second one", async () => {
    const supabase = createSupabaseQueryMock({
      agent_tasks: {
        data: {
          id: "task-1",
          source_id: "asset-1",
          campaign_id: "camp-1",
          objective: "Add the truck",
          metadata: { human_instruction: "Add the truck" },
          created_at: OLD,
          status: "queued",
        },
        error: null,
      },
    });

    const result = await redispatchStalledRevision({ agentTaskId: "task-1", orgId: "org-1", operator: "Evan" }, supabase);

    expect(result).toEqual({ ok: true, dispatched: true });
    expect(notifyArcCampaignTask).toHaveBeenCalledWith({
      agentTaskId: "task-1",
      campaignId: "camp-1",
      assetId: "asset-1",
      conversationId: null,
      message: "Add the truck",
      operator: "Evan",
      taskType: "campaign_asset_revision",
    });
    // Retrying must never write another agent_tasks row — that is what would
    // turn one operator instruction into two Arc runs and two charges.
    expect(supabase.calls.filter(([method]) => method === "insert")).toHaveLength(0);
  });

  /**
   * The duplicate-run guard. A task that already moved to `running` is in
   * flight; waking it again would run the operator's instruction a second time.
   */
  it("refuses a task that has already started", async () => {
    const supabase = createSupabaseQueryMock({
      agent_tasks: {
        data: { id: "task-1", source_id: "asset-1", campaign_id: "camp-1", objective: "x", metadata: {}, created_at: OLD, status: "running" },
        error: null,
      },
    });

    const result = await redispatchStalledRevision({ agentTaskId: "task-1", orgId: "org-1", operator: "Evan" }, supabase);

    expect(result).toEqual({ ok: false, reason: "already_running" });
    expect(notifyArcCampaignTask).not.toHaveBeenCalled();
  });

  it("refuses a task belonging to another org", async () => {
    // The org filter misses, so the scoped read finds nothing.
    const supabase = createSupabaseQueryMock({ agent_tasks: { data: null, error: null } });

    const result = await redispatchStalledRevision({ agentTaskId: "task-1", orgId: "org-2", operator: "Evan" }, supabase);

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(notifyArcCampaignTask).not.toHaveBeenCalled();
    expect(filters(supabase)).toContainEqual(["org_id", "org-2"]);
  });

  /**
   * The honest-failure case: the runner is still unreachable. The task stays
   * queued and retryable, and the caller is told it did NOT start — reporting
   * success here is the original bug in miniature.
   */
  it("reports dispatched:false when the runner does not answer", async () => {
    notifyArcCampaignTask.mockResolvedValue(false);
    const supabase = createSupabaseQueryMock({
      agent_tasks: {
        data: { id: "task-1", source_id: "asset-1", campaign_id: "camp-1", objective: "x", metadata: {}, created_at: OLD, status: "queued" },
        error: null,
      },
    });

    const result = await redispatchStalledRevision({ agentTaskId: "task-1", orgId: "org-1", operator: "Evan" }, supabase);

    expect(result).toEqual({ ok: true, dispatched: false, reason: "runner_unreachable" });
  });
});

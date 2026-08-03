import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { requestAssetRevision } from "./revisions";

const notifyArcCampaignTask = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/lib/arc-chat/notify", () => ({ notifyArcCampaignTask }));

vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({
    orgId: "org-1",
    orgSlug: "org",
    orgName: "Org",
    workspaceId: "workspace-1",
    workspaceKey: "default",
    workspaceSlug: "default",
    workspaceName: "Default",
    role: null,
    userId: null,
    source: "default-org",
  })),
}));

function findCalls(supabase: { calls: Array<[string, ...unknown[]]> }, method: string) {
  return supabase.calls.filter(([m]) => m === method).map(([, arg]) => arg as Record<string, unknown>);
}

describe("requestAssetRevision", () => {
  beforeEach(() => {
    notifyArcCampaignTask.mockClear();
    notifyArcCampaignTask.mockResolvedValue(true);
  });

  it("records a revision request without ever unlocking outbound", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: { id: "appr-1", status: "pending_owner_approval" }, error: null },
      approval_decisions: { data: null, error: null },
      campaign_assets: { data: null, error: null },
      campaign_events: { data: null, error: null },
      agents: { data: { id: "agent-1" }, error: null },
      agent_tasks: { data: { id: "task-1" }, error: null },
      agent_task_inputs: { data: null, error: null },
    });

    const result = await requestAssetRevision(
      { campaignId: "camp-1", assetId: "asset-1", instruction: "make the email shorter", operator: "Operator" },
      supabase,
    );

    expect(result).toEqual({ approvalItemId: "appr-1", agentTaskId: "task-1", dispatched: true });

    const inserts = findCalls(supabase, "insert");
    const updates = findCalls(supabase, "update");

    // approval decision logged as revision_requested
    expect(inserts).toContainEqual(expect.objectContaining({ decision: "revision_requested", next_status: "revision_requested" }));
    // campaign event on the timeline
    expect(inserts).toContainEqual(expect.objectContaining({ event_type: "approval_decided" }));
    // Arc is queued with the right task type
    expect(inserts).toContainEqual(expect.objectContaining({ task_type: "campaign_asset_revision", status: "queued" }));

    // the asset is flipped to revision_requested...
    expect(updates).toContainEqual({ status: "revision_requested" });
    // ...and NOTHING in the whole sequence touches dispatch_locked / unlocks outbound
    for (const arg of [...inserts, ...updates]) {
      expect(arg).not.toHaveProperty("dispatch_locked");
      expect(arg).not.toHaveProperty("launch_locked");
    }
  });

  it("still records the transition when no Arc agent is registered", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: { id: "appr-1", status: "pending_owner_approval" }, error: null },
      agents: { data: null, error: null },
    });

    const result = await requestAssetRevision(
      { campaignId: "camp-1", assetId: "asset-1", instruction: "shift tone to urgency", operator: "Operator" },
      supabase,
    );

    expect(result.agentTaskId).toBeNull();
    expect(result.approvalItemId).toBe("appr-1");
    expect(result.dispatched).toBe(false);
    // no agent task was queued
    expect(findCalls(supabase, "insert")).not.toContainEqual(
      expect.objectContaining({ task_type: "campaign_asset_revision" }),
    );
    // ...and with no task to run, the runner is not woken for nothing
    expect(notifyArcCampaignTask).not.toHaveBeenCalled();
  });

  // BSR-695. Every write below was already correct when the bug was live: the
  // approval decision, the asset flip, the event, the agent_task row. What was
  // missing was the wake — and nothing polls `agent_tasks`, so the queued task
  // was never picked up and the asset was never regenerated. The old tests
  // asserted the insert and stopped, which is why the loop stayed green while
  // being visibly broken to the operator.
  it("wakes the runner — a queued task alone never runs", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: { id: "appr-1", status: "pending_owner_approval" }, error: null },
      approval_decisions: { data: null, error: null },
      campaign_assets: { data: null, error: null },
      campaign_events: { data: null, error: null },
      agents: { data: { id: "agent-1" }, error: null },
      agent_tasks: { data: { id: "task-1" }, error: null },
      agent_task_inputs: { data: null, error: null },
    });

    await requestAssetRevision(
      { campaignId: "camp-1", assetId: "asset-1", instruction: "our logo needs to be on the truck", operator: "Robby" },
      supabase,
    );

    expect(notifyArcCampaignTask).toHaveBeenCalledTimes(1);
    expect(notifyArcCampaignTask).toHaveBeenCalledWith(
      expect.objectContaining({
        agentTaskId: "task-1",
        campaignId: "camp-1",
        // the asset id has to ride along, or Arc knows the campaign but not
        // which of its assets the instruction was about
        assetId: "asset-1",
        taskType: "campaign_asset_revision",
        message: "our logo needs to be on the truck",
      }),
    );
  });

  it("reports dispatched:false when the runner does not answer, instead of claiming success", async () => {
    notifyArcCampaignTask.mockResolvedValue(false);
    const supabase = createSupabaseQueryMock({
      approval_items: { data: { id: "appr-1", status: "pending_owner_approval" }, error: null },
      approval_decisions: { data: null, error: null },
      campaign_assets: { data: null, error: null },
      campaign_events: { data: null, error: null },
      agents: { data: { id: "agent-1" }, error: null },
      agent_tasks: { data: { id: "task-1" }, error: null },
      agent_task_inputs: { data: null, error: null },
    });

    const result = await requestAssetRevision(
      { campaignId: "camp-1", assetId: "asset-1", instruction: "tighten the CTA", operator: "Operator" },
      supabase,
    );

    // the state transition still stands — an unreachable runner must not lose
    // the operator's request — but the caller is told it has not started
    expect(result.agentTaskId).toBe("task-1");
    expect(result.dispatched).toBe(false);
  });

  it("surfaces a clear error when a write fails", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: { id: "appr-1", status: "pending_owner_approval" }, error: null },
      approval_decisions: { data: null, error: { message: "permission denied" } },
    });

    await expect(
      requestAssetRevision(
        { campaignId: "camp-1", assetId: "asset-1", instruction: "tighten the CTA", operator: "Operator" },
        supabase,
      ),
    ).rejects.toThrow(/approval_decisions insert failed: permission denied/);
  });
});

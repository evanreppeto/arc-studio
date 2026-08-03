import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { decideApprovalItem } from "./decisions";

function findCalls(supabase: { calls: Array<[string, ...unknown[]]> }, method: string) {
  return supabase.calls.filter(([m]) => m === method).map(([, arg]) => arg as Record<string, unknown>);
}

const itemRow = { id: "appr-1", status: "pending_owner_approval", campaign_id: "camp-1", campaign_asset_id: "asset-1" };

describe("decideApprovalItem", () => {
  it("approves without unlocking outbound", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: itemRow, error: null },
      approval_decisions: { data: null, error: null },
      campaign_assets: { data: null, error: null },
      campaigns: { data: null, error: null },
      campaign_events: { data: null, error: null },
    });

    const result = await decideApprovalItem(
      { approvalItemId: "appr-1", decision: "approved", operator: "Operator", tenant: { org_id: "org-1", workspace_id: "workspace-1" } },
      supabase,
    );
    expect(result).toEqual({ approvalItemId: "appr-1", decision: "approved", status: "approved" });

    const inserts = findCalls(supabase, "insert");
    const updates = findCalls(supabase, "update");

    expect(inserts).toContainEqual(expect.objectContaining({ decision: "approved", next_status: "approved", org_id: "org-1" }));
    expect(inserts).toContainEqual(expect.objectContaining({ event_type: "approval_decided", org_id: "org-1" }));
    // approval item + asset + campaign all move to approved; asset gets an approver stamp
    expect(updates).toContainEqual(expect.objectContaining({ status: "approved", approved_by: "Operator" }));
    expect(updates).toContainEqual(expect.objectContaining({ status: "approved" }));

    // the outbound-locked invariant: nothing unlocks dispatch / launch
    for (const arg of [...inserts, ...updates]) {
      expect(arg).not.toHaveProperty("dispatch_locked");
      expect(arg).not.toHaveProperty("launch_locked");
    }
    expect(supabase.calls.filter((call) => call[0] === "eq" && call[1] === "org_id" && call[2] === "org-1").length).toBeGreaterThanOrEqual(4);
  });

  it("archives with an 'archived' campaign event", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: itemRow, error: null },
    });

    await decideApprovalItem({ approvalItemId: "appr-1", decision: "archived", operator: "Operator", tenant: { org_id: "org-1", workspace_id: "workspace-1" } }, supabase);

    expect(findCalls(supabase, "insert")).toContainEqual(expect.objectContaining({ event_type: "archived", payload: expect.objectContaining({ decision: "archived" }) }));
  });

  it("throws when the approval item does not exist", async () => {
    const supabase = createSupabaseQueryMock({ approval_items: { data: null, error: null } });
    await expect(
      decideApprovalItem({ approvalItemId: "missing", decision: "declined", operator: "Operator" }, supabase),
    ).rejects.toThrow(/not found/i);
  });
});

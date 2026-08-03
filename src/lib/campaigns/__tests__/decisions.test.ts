import { describe, expect, it } from "vitest";

import { decideApprovalItem, undoDecision } from "../decisions";

/**
 * Minimal awaitable Supabase stub. Each `.from(table)` returns a builder whose
 * chain methods return `this`; terminal `.maybeSingle()`/`.single()` resolve to
 * `{ data, error }`. Inserts/updates are recorded for assertions.
 */
function makeClient(config: {
  lastDecision: Record<string, unknown> | null;
  item: Record<string, unknown> | null;
}) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];

  function builder(table: string) {
    const state: { op: string; payload?: unknown } = { op: "select" };
    const api: Record<string, unknown> = {
      select: () => api,
      eq: () => api,
      order: () => api,
      limit: () => api,
      insert: (payload: unknown) => {
        state.op = "insert";
        state.payload = payload;
        calls.push({ table, op: "insert", payload });
        return api;
      },
      update: (payload: unknown) => {
        state.op = "update";
        state.payload = payload;
        calls.push({ table, op: "update", payload });
        return api;
      },
      maybeSingle: async () => {
        if (table === "approval_decisions") return { data: config.lastDecision, error: null };
        if (table === "approval_items") return { data: config.item, error: null };
        return { data: null, error: null };
      },
      single: async () => ({ data: { id: "x" }, error: null }),
      then: (resolve: (v: { data: null; error: null }) => unknown) => resolve({ data: null, error: null }),
    };
    return api;
  }

  return {
    client: { from: (table: string) => builder(table) } as never,
    calls,
  };
}

describe("undoDecision", () => {
  it("restores the item to previous_status and records a 'reverted' decision", async () => {
    const { client, calls } = makeClient({
      lastDecision: { id: "d1", decision: "approved", previous_status: "pending_approval", next_status: "approved" },
      item: { id: "i1", status: "approved", campaign_id: "c1", campaign_asset_id: "a1" },
    });

    const result = await undoDecision({ approvalItemId: "i1", operator: "Evan", tenant: { org_id: "org-1", workspace_id: "workspace-1" } }, client);

    expect(result.restoredStatus).toBe("pending_approval");

    const decisionInsert = calls.find((c) => c.table === "approval_decisions" && c.op === "insert");
    expect(decisionInsert?.payload).toMatchObject({ decision: "reverted", next_status: "pending_approval", previous_status: "approved" });

    const itemUpdate = calls.find((c) => c.table === "approval_items" && c.op === "update");
    expect(itemUpdate?.payload).toMatchObject({ status: "pending_approval" });
  });

  it("refuses when the last decision was already a reversal", async () => {
    const { client } = makeClient({
      lastDecision: { id: "d2", decision: "reverted", previous_status: "approved", next_status: "pending_approval" },
      item: { id: "i1", status: "pending_approval", campaign_id: "c1", campaign_asset_id: null },
    });

    await expect(undoDecision({ approvalItemId: "i1", operator: "Evan" }, client)).rejects.toThrow(/already/i);
  });
});

describe("decideApprovalItem campaign status mapping", () => {
  it("maps a declined decision to a valid campaign_status (not 'declined')", async () => {
    const calls: { table: string; op: string; payload?: unknown }[] = [];
    const item = { id: "i1", status: "pending_approval", campaign_id: "c1", campaign_asset_id: "a1" };
    function builder(table: string) {
      const api: Record<string, unknown> = {
        select: () => api,
        eq: () => api,
        order: () => api,
        limit: () => api,
        insert: (payload: unknown) => { calls.push({ table, op: "insert", payload }); return api; },
        update: (payload: unknown) => { calls.push({ table, op: "update", payload }); return api; },
        maybeSingle: async () => (table === "approval_items" ? { data: item, error: null } : { data: null, error: null }),
        single: async () => ({ data: { id: "x" }, error: null }),
        then: (resolve: (v: { data: null; error: null }) => unknown) => resolve({ data: null, error: null }),
      };
      return api;
    }
    const client = { from: (t: string) => builder(t) } as never;

    await decideApprovalItem({ approvalItemId: "i1", decision: "declined", operator: "Evan", tenant: { org_id: "org-1", workspace_id: "workspace-1" } }, client);

    const campaignUpdate = calls.find((c) => c.table === "campaigns" && c.op === "update");
    const valid = ["draft","briefing","generating","pending_approval","approved","active","paused","archived","blocked"];
    expect(campaignUpdate).toBeTruthy();
    expect(valid).toContain((campaignUpdate!.payload as { status: string }).status);
    // declined campaign work should be unavailable -> blocked
    expect((campaignUpdate!.payload as { status: string }).status).toBe("blocked");
  });

  it("maps approved -> approved and archived -> archived for the campaign", async () => {
    for (const [decision, expected] of [["approved","approved"],["archived","archived"]] as const) {
      const calls: { table: string; op: string; payload?: unknown }[] = [];
      const item = { id: "i1", status: "pending_approval", campaign_id: "c1", campaign_asset_id: null };
      function builder(table: string) {
        const api: Record<string, unknown> = {
          select: () => api, eq: () => api, order: () => api, limit: () => api,
          insert: (payload: unknown) => { calls.push({ table, op: "insert", payload }); return api; },
          update: (payload: unknown) => { calls.push({ table, op: "update", payload }); return api; },
          maybeSingle: async () => (table === "approval_items" ? { data: item, error: null } : { data: null, error: null }),
          single: async () => ({ data: { id: "x" }, error: null }),
          then: (resolve: (v: { data: null; error: null }) => unknown) => resolve({ data: null, error: null }),
        };
        return api;
      }
      const client = { from: (t: string) => builder(t) } as never;
      await decideApprovalItem({ approvalItemId: "i1", decision, operator: "Evan", tenant: { org_id: "org-1", workspace_id: "workspace-1" } }, client);
      const campaignUpdate = calls.find((c) => c.table === "campaigns" && c.op === "update");
      expect((campaignUpdate!.payload as { status: string }).status).toBe(expected);
    }
  });
});

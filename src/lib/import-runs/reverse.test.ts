import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: vi.fn(() => true),
  getSupabaseAdminClient: vi.fn(),
}));

const listImportRunsMock = vi.fn();
vi.mock("./read-model", () => ({ listImportRuns: (...args: unknown[]) => listImportRunsMock(...args) }));

import { reverseImportRun } from "./reverse";

const TENANT = { orgId: "org-1", workspaceId: "ws-1" };

/**
 * A stand-in Supabase client that records every call. The reversal path is the
 * one place in this feature that DELETES a customer's records, so the tests below
 * assert on exactly which ids each operation touched rather than on a count.
 */
function client(records: Array<{ local_id: string; action: string; previous: unknown }>) {
  const calls: Array<{ table: string; op: string; payload?: unknown; ids?: unknown }> = [];

  const builder = (table: string) => {
    const state: { op: string; payload?: unknown; ids?: unknown } = { op: "select" };
    const chain: Record<string, unknown> = {
      select: (_cols?: string, opts?: unknown) => { state.op = state.op === "delete" ? "delete" : "select"; void opts; return chain; },
      delete: () => { state.op = "delete"; return chain; },
      update: (payload: unknown) => { state.op = "update"; state.payload = payload; return chain; },
      eq: () => chain,
      in: (_col: string, ids: unknown) => { state.ids = ids; return chain; },
      then: undefined,
    };
    // Terminal: awaiting the chain resolves to the table's canned response.
    (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => {
      calls.push({ table, op: state.op, payload: state.payload, ids: state.ids });
      if (table === "import_run_records" && state.op === "select") {
        return resolve({ data: records, error: null, count: records.length });
      }
      return resolve({ data: null, error: null, count: Array.isArray(state.ids) ? state.ids.length : 0 });
    };
    return chain;
  };

  return { from: (table: string) => builder(table), calls } as never as {
    from: (t: string) => unknown;
    calls: typeof calls;
  };
}

function reversibleRun() {
  return [{ id: "run-1", reversible: true, blockedReason: null }];
}

describe("reverseImportRun", () => {
  it("deletes what the run created and restores what it updated — never both on one row", async () => {
    // The distinction the whole design turns on. A blanket delete would remove
    // lead-2, which existed long before this import and was merely touched by it.
    listImportRunsMock.mockResolvedValue(reversibleRun());
    const db = client([
      { local_id: "lead-1", action: "created", previous: {} },
      { local_id: "lead-2", action: "updated", previous: { status: "contacted", persona: "persona_x" } },
    ]);

    const out = await reverseImportRun(TENANT, "run-1", db as never);

    expect(out).toMatchObject({ ok: true, deleted: 1, restored: 1, skipped: 0 });
    const del = db.calls.find((c) => c.table === "leads" && c.op === "delete");
    expect(del?.ids).toEqual(["lead-1"]);
    const restore = db.calls.find((c) => c.table === "leads" && c.op === "update");
    expect(restore?.payload).toMatchObject({ status: "contacted", persona: "persona_x" });
  });

  it("never writes id, org_id or created_at back from a snapshot", async () => {
    // A corrupted snapshot must not be able to move a row between tenants.
    listImportRunsMock.mockResolvedValue(reversibleRun());
    const db = client([
      {
        local_id: "lead-2",
        action: "updated",
        previous: { id: "somewhere-else", org_id: "org-99", created_at: "2020-01-01", status: "new" },
      },
    ]);

    await reverseImportRun(TENANT, "run-1", db as never);

    const restore = db.calls.find((c) => c.table === "leads" && c.op === "update");
    expect(restore?.payload).toEqual({ status: "new" });
  });

  it("counts an update with no snapshot as skipped rather than claiming it restored", async () => {
    // Runs imported before BSR-643 have no snapshot. Reporting them as restored
    // would tell the operator their data is back when it is not.
    listImportRunsMock.mockResolvedValue(reversibleRun());
    const db = client([{ local_id: "lead-2", action: "updated", previous: {} }]);

    const out = await reverseImportRun(TENANT, "run-1", db as never);

    expect(out).toMatchObject({ ok: true, restored: 0, skipped: 1 });
    expect(db.calls.find((c) => c.table === "leads" && c.op === "update")).toBeUndefined();
  });

  it("refuses when the run is no longer reversible, and says why", async () => {
    // Re-checked here rather than trusted from the page that rendered the button:
    // a run can stop being reversible between render and click.
    listImportRunsMock.mockResolvedValue([
      { id: "run-1", reversible: false, blockedReason: "Some of these records are now used by a campaign." },
    ]);
    const db = client([{ local_id: "lead-1", action: "created", previous: {} }]);

    const out = await reverseImportRun(TENANT, "run-1", db as never);

    expect(out).toEqual({ ok: false, error: "Some of these records are now used by a campaign." });
    expect(db.calls.some((c) => c.table === "leads")).toBe(false);
  });

  it("refuses a run from another workspace", async () => {
    listImportRunsMock.mockResolvedValue(reversibleRun());
    const db = client([]);

    const out = await reverseImportRun(TENANT, "run-from-elsewhere", db as never);

    expect(out.ok).toBe(false);
    expect(db.calls.some((c) => c.table === "leads")).toBe(false);
  });
});

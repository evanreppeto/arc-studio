import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRecentCorrections } from "./read-model";

/**
 * BSR-685. The read that feeds Arc's correction block.
 *
 * The filters here are not incidental. Prod's archived demo org holds nine
 * identical "Nightly smoke check — no action needed" notes from the prod smoke
 * workflow, one per night, against the SAME `revision_requested` decision the
 * real corrections use. Only the org boundary separates them, so the scoping is
 * the feature, not boilerplate.
 */

/** Captures the filters applied, and replays canned rows per table. */
function makeClient(opts: {
  decisions?: Array<Record<string, unknown>>;
  items?: Array<Record<string, unknown>>;
  decisionsError?: boolean;
}) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  function chainFor(table: string) {
    const rows = table === "approval_decisions" ? (opts.decisions ?? []) : (opts.items ?? []);
    const chain: Record<string, unknown> = {};
    const record = (op: string) => (...args: unknown[]) => { calls.push({ table, op, args }); return chain; };
    chain.select = record("select");
    chain.eq = record("eq");
    chain.in = record("in");
    chain.not = record("not");
    chain.order = record("order");
    // `limit` resolves the decisions query; the items query resolves on `in`.
    chain.limit = (...args: unknown[]) => {
      calls.push({ table, op: "limit", args });
      return Promise.resolve({ data: opts.decisionsError ? null : rows, error: opts.decisionsError ? { message: "boom" } : null });
    };
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
    return chain;
  }
  return { client: { from: (table: string) => chainFor(table) } as never, calls };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
});

describe("getRecentCorrections", () => {
  const decision = (over: Record<string, unknown> = {}) => ({
    approval_item_id: "item-1",
    decision: "revision_requested",
    decided_at: "2026-08-03T10:00:00.000Z",
    decision_notes: "Our logo needs to be on the truck",
    ...over,
  });

  it("scopes to the org — the only thing separating real notes from smoke-test noise", async () => {
    const { client, calls } = makeClient({ decisions: [decision()] });
    await getRecentCorrections("org-live", client);
    const orgFilter = calls.find((c) => c.table === "approval_decisions" && c.op === "eq" && c.args[0] === "org_id");
    expect(orgFilter?.args[1]).toBe("org-live");
  });

  it("asks the database for corrective decisions only, not approvals", async () => {
    const { client, calls } = makeClient({ decisions: [decision()] });
    await getRecentCorrections("org-live", client);
    const inFilter = calls.find((c) => c.table === "approval_decisions" && c.op === "in");
    expect(inFilter?.args[1]).toEqual(["revision_requested", "declined"]);
  });

  it("carries the note, decision and timestamp through for the domain to shape", async () => {
    const { client } = makeClient({
      decisions: [decision()],
      items: [{ id: "item-1", item_type: "campaign_asset" }],
    });
    const out = await getRecentCorrections("org-live", client);
    expect(out).toEqual([
      {
        decision: "revision_requested",
        note: "Our logo needs to be on the truck",
        itemType: "campaign_asset",
        decidedAt: "2026-08-03T10:00:00.000Z",
      },
    ]);
  });

  it("still returns the note when the item type cannot be resolved", async () => {
    // A missing item must cost the label, never the correction itself.
    const { client } = makeClient({ decisions: [decision()], items: [] });
    const out = await getRecentCorrections("org-live", client);
    expect(out).toHaveLength(1);
    expect(out[0].itemType).toBeNull();
  });

  it("returns an empty list rather than throwing when the read fails", async () => {
    // This feeds a per-turn prompt; a degraded read must not take a turn down.
    const { client } = makeClient({ decisionsError: true });
    await expect(getRecentCorrections("org-live", client)).resolves.toEqual([]);
  });

  it("returns nothing when the org has no corrections", async () => {
    const { client } = makeClient({ decisions: [] });
    await expect(getRecentCorrections("org-live", client)).resolves.toEqual([]);
  });
});

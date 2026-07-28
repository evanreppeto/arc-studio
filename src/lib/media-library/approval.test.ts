import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdminClient: vi.fn() }));

import { decideAssetApproval, getAssetApprovalStates } from "./approval";

const FLAG = "Provenance unverified — origin not recorded";

/** Chainable Supabase fake covering the three tables this path touches. */
function makeClient(opts: {
  asset?: { id: string; risk_flags: string[] | null } | null;
  existingItem?: { id: string; status: string } | null;
  approvalRows?: Array<Record<string, unknown>>;
}) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; row: Record<string, unknown> }> = [];

  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "not", "order", "limit"]) chain[m] = () => chain;

      chain.maybeSingle = async () => ({
        data: table === "media_assets" ? (opts.asset ?? null) : (opts.existingItem ?? null),
        error: null,
      });
      chain.single = async () => ({ data: { id: "item-new" }, error: null });
      chain.insert = (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return {
          select: () => ({ single: async () => ({ data: { id: "item-new" }, error: null }) }),
          then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r),
        };
      };
      chain.update = (row: Record<string, unknown>) => {
        updates.push({ table, row });
        const res = { eq: () => res, then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) };
        return res;
      };
      chain.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: opts.approvalRows ?? [], error: null }).then(r);
      return chain;
    },
  } as never;

  return { client, inserts, updates };
}

describe("decideAssetApproval", () => {
  // The gate must bind to what is RECORDED, not what the caller sends —
  // otherwise a client approves a flagged asset by omitting the flags.
  it("reads risk flags from the database, not the request", async () => {
    const { client, inserts } = makeClient({ asset: { id: "a1", risk_flags: [FLAG] } });
    const res = await decideAssetApproval(
      { assetId: "a1", orgId: "org-1", decision: "approved", operator: "maya" },
      client,
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(FLAG);
    // Nothing was written — a refused approval leaves no trace of having happened.
    expect(inserts).toHaveLength(0);
  });

  it("approves a flagged asset once acknowledged, and records what was known", async () => {
    const { client, inserts } = makeClient({ asset: { id: "a1", risk_flags: [FLAG] } });
    const res = await decideAssetApproval(
      {
        assetId: "a1",
        orgId: "org-1",
        decision: "approved",
        operator: "maya",
        acknowledgement: "Confirmed it's our own site photo.",
      },
      client,
    );

    expect(res.ok).toBe(true);
    const decision = inserts.find((i) => i.table === "approval_decisions");
    expect(decision?.row.decision).toBe("approved");
    expect(String(decision?.row.decision_notes)).toContain("Acknowledged:");
    expect(decision?.row.metadata).toMatchObject({ acknowledged_flags: [FLAG], outbound_locked: true });
  });

  it("approves a clean asset without ceremony", async () => {
    const { client, inserts } = makeClient({ asset: { id: "a1", risk_flags: [] } });
    const res = await decideAssetApproval(
      { assetId: "a1", orgId: "org-1", decision: "approved", operator: "maya" },
      client,
    );
    expect(res.ok).toBe(true);
    expect(inserts.find((i) => i.table === "approval_items")?.row).toMatchObject({
      item_type: "media_asset",
      media_asset_id: "a1",
      status: "approved",
      locked_until_approved: true,
    });
  });

  it("lets a reviewer decline a flagged asset with no acknowledgement", async () => {
    const { client } = makeClient({ asset: { id: "a1", risk_flags: [FLAG] } });
    const res = await decideAssetApproval(
      { assetId: "a1", orgId: "org-1", decision: "declined", operator: "maya" },
      client,
    );
    expect(res.ok).toBe(true);
  });

  it("updates the existing approval row rather than stacking duplicates", async () => {
    const { client, inserts, updates } = makeClient({
      asset: { id: "a1", risk_flags: [] },
      existingItem: { id: "item-1", status: "pending_approval" },
    });
    await decideAssetApproval(
      { assetId: "a1", orgId: "org-1", decision: "needs_revision", operator: "maya" },
      client,
    );

    expect(updates.some((u) => u.table === "approval_items")).toBe(true);
    expect(inserts.filter((i) => i.table === "approval_items")).toHaveLength(0);
    // History is still appended.
    expect(inserts.find((i) => i.table === "approval_decisions")?.row).toMatchObject({
      previous_status: "pending_approval",
      next_status: "needs_revision",
    });
  });

  it("refuses an asset outside the caller's org", async () => {
    const { client } = makeClient({ asset: null });
    const res = await decideAssetApproval(
      { assetId: "a1", orgId: "org-1", decision: "approved", operator: "maya" },
      client,
    );
    expect(res).toMatchObject({ ok: false, error: "Asset not found." });
  });
});

describe("getAssetApprovalStates", () => {
  it("keeps only the newest decision per asset", async () => {
    const { client } = makeClient({
      approvalRows: [
        { media_asset_id: "a1", status: "approved", reviewed_by: "maya", reviewed_at: "2026-07-28T10:00:00Z" },
        { media_asset_id: "a1", status: "needs_revision", reviewed_by: "sam", reviewed_at: "2026-07-27T10:00:00Z" },
        { media_asset_id: "a2", status: "declined", reviewed_by: "sam", reviewed_at: "2026-07-26T10:00:00Z" },
      ],
    });
    const states = await getAssetApprovalStates("org-1", client);
    expect(states.a1).toMatchObject({ status: "approved", reviewedBy: "maya" });
    expect(states.a2).toMatchObject({ status: "declined" });
  });

  it("degrades to an empty map rather than throwing", async () => {
    const { client } = makeClient({ approvalRows: [] });
    await expect(getAssetApprovalStates("org-1", client)).resolves.toEqual({});
  });
});

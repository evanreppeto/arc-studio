import { describe, expect, it } from "vitest";

import { DEFAULT_PIPELINE_STAGES } from "@/domain";

import { seedDefaultPipelineStages } from "./definitions";

type Row = { object_key: string; key: string; label: string; is_won: boolean; is_lost: boolean };

/**
 * Minimal stand-in for the two calls the seeder makes: a head/count read, then
 * one insert. Captures the rows so the assertions can look at what would
 * actually reach Postgres.
 */
function mockClient(existingCount: number) {
  const inserted: Row[] = [];
  const client = {
    from: () => ({
      select: () => ({ eq: async () => ({ count: existingCount, error: null }) }),
      insert: async (rows: Row[]) => {
        inserted.push(...rows);
        return { error: null };
      },
    }),
  };
  return { client: client as never, inserted };
}

function keysFor(inserted: Row[], objectKey: string) {
  return inserted.filter((r) => r.object_key === objectKey).map((r) => r.key);
}

describe("seedDefaultPipelineStages", () => {
  it("seeds the industry's starter stages, not the general set", async () => {
    const { client, inserted } = mockClient(0);

    await seedDefaultPipelineStages({ orgId: "org-1", client, industry: "professional_services" });

    // The stage that motivated per-industry seeding: no general pipeline has a
    // name for clearing conflicts, and a firm can't open work without it.
    expect(keysFor(inserted, "leads")).toContain("conflict_check");
    expect(keysFor(inserted, "jobs")).toContain("withdrawn");
  });

  it("seeds a different set for a different industry", async () => {
    const { client, inserted } = mockClient(0);

    await seedDefaultPipelineStages({ orgId: "org-1", client, industry: "healthcare" });

    expect(keysFor(inserted, "leads")).toContain("consult_booked");
    expect(keysFor(inserted, "jobs")).toContain("no_show");
    expect(keysFor(inserted, "leads")).not.toContain("conflict_check");
  });

  it("falls back to the general set when no industry is given", async () => {
    const { client, inserted } = mockClient(0);

    await seedDefaultPipelineStages({ orgId: "org-1", client });

    expect(keysFor(inserted, "leads")).toEqual(DEFAULT_PIPELINE_STAGES.leads.map((s) => s.key));
  });

  it("seeds the same outcomes ledger regardless of industry", async () => {
    const expected = DEFAULT_PIPELINE_STAGES.outcomes.map((s) => s.key);
    for (const industry of ["professional_services", "ecommerce", "general", null]) {
      const { client, inserted } = mockClient(0);
      await seedDefaultPipelineStages({ orgId: "org-1", client, industry });
      expect(keysFor(inserted, "outcomes"), String(industry)).toEqual(expected);
    }
  });

  // The property that makes this change safe to ship: an org that already has
  // stages is never touched, so no existing tenant's reporting can move.
  it("is a no-op when the org already has stages", async () => {
    const { client, inserted } = mockClient(7);

    const written = await seedDefaultPipelineStages({ orgId: "org-1", client, industry: "saas" });

    expect(written).toBe(0);
    expect(inserted).toEqual([]);
  });

  it("carries the semantic flags, not just the labels", async () => {
    const { client, inserted } = mockClient(0);

    await seedDefaultPipelineStages({ orgId: "org-1", client, industry: "agency" });

    const leads = inserted.filter((r) => r.object_key === "leads");
    expect(leads.filter((r) => r.is_won)).toHaveLength(1);
    expect(leads.filter((r) => r.is_lost)).toHaveLength(1);
  });
});

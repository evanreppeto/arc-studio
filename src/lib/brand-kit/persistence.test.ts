import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isSupabaseAdminConfigured: vi.fn(() => true),
  getSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: mocks.isSupabaseAdminConfigured,
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));

import { listPersonaDefinitions } from "./persistence";

/** Records which table was queried — the thing that was actually wrong. */
function fakeClient(rows: Record<string, unknown>[]) {
  const seen: { table?: string; orgId?: string } = {};
  const builder = {
    select: () => builder,
    eq: (column: string, value: string) => {
      if (column === "org_id") seen.orgId = value;
      return builder;
    },
    order: async () => ({ data: rows, error: null }),
  };
  return {
    seen,
    client: {
      from: (table: string) => {
        seen.table = table;
        return builder;
      },
    },
  };
}

describe("listPersonaDefinitions", () => {
  beforeEach(() => {
    mocks.isSupabaseAdminConfigured.mockReturnValue(true);
  });

  // The regression: this read `persona_definitions`, which nothing has populated
  // since the taxonomy moved to `personas`. Both callers mock this function, so
  // no test ever covered the table name — every workspace created since reported
  // zero personas to Arc. Assert the authority explicitly.
  it("reads the authoritative `personas` table, scoped to the org", async () => {
    const { seen, client } = fakeClient([]);
    mocks.getSupabaseAdminClient.mockReturnValue(client);

    await listPersonaDefinitions("org-1");

    expect(seen.table).toBe("personas");
    expect(seen.orgId).toBe("org-1");
  });

  it("maps a persona row onto the definition shape Arc consumes", async () => {
    const { client } = fakeClient([
      {
        slug: "new-lead",
        name: "New lead",
        is_active: true,
        audience: "People who just asked for a quote.",
        profile: "ignored when audience is present",
        angle: "Answer fast, while they are still deciding.",
        cta: "Book an assessment",
        proof_points: ["4.9 star average", "same-week scheduling"],
      },
    ]);
    mocks.getSupabaseAdminClient.mockReturnValue(client);

    const [persona] = await listPersonaDefinitions("org-1");

    expect(persona).toEqual({
      key: "new-lead",
      label: "New lead",
      audienceType: "customer",
      sortOrder: 0,
      isActive: true,
      metadata: {
        description: "People who just asked for a quote.",
        recommendedCta: "Book an assessment",
        messageAngle: "Answer fast, while they are still deciding.",
        proofPoints: ["4.9 star average", "same-week scheduling"],
      },
    });
  });

  // assembleArcContext sorts by sortOrder, so a constant would let it reorder
  // personas arbitrarily. The name ordering from the query is the intended order.
  it("gives each persona a distinct sortOrder so the query order survives", async () => {
    const { client } = fakeClient([
      { slug: "a", name: "Alpha", is_active: true, audience: null, profile: null, angle: null, cta: null, proof_points: null },
      { slug: "b", name: "Beta", is_active: true, audience: null, profile: null, angle: null, cta: null, proof_points: null },
      { slug: "c", name: "Gamma", is_active: true, audience: null, profile: null, angle: null, cta: null, proof_points: null },
    ]);
    mocks.getSupabaseAdminClient.mockReturnValue(client);

    const personas = await listPersonaDefinitions("org-1");

    expect(personas.map((p) => p.sortOrder)).toEqual([0, 1, 2]);
    expect(personas.map((p) => p.key)).toEqual(["a", "b", "c"]);
  });

  it("omits metadata keys that have no value rather than emitting empty ones", async () => {
    const { client } = fakeClient([
      { slug: "bare", name: "Bare", is_active: true, audience: null, profile: null, angle: null, cta: null, proof_points: [] },
    ]);
    mocks.getSupabaseAdminClient.mockReturnValue(client);

    const [persona] = await listPersonaDefinitions("org-1");

    expect(persona.metadata).toEqual({});
  });

  it("returns nothing when Supabase is not configured", async () => {
    mocks.isSupabaseAdminConfigured.mockReturnValue(false);

    await expect(listPersonaDefinitions("org-1")).resolves.toEqual([]);
  });
});

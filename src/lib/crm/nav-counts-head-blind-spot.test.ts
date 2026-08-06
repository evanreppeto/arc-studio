import { describe, expect, it, vi } from "vitest";


// Static, not `await import(…)` inside each test: `vi.mock` is hoisted above
// imports, so the mocks apply either way. The dynamic form bought nothing and
// charged this file's module transform to whichever test ran first (BSR-739).
import { getCrmNavCounts } from "./read-model";

/**
 * Regression for BSR-575.
 *
 * `getCrmNavCounts()` could not be made to fail. Three forced failures against a
 * live database (renaming `contacts`, then `outcomes`, then instrumenting the
 * page) all reported `status: "live"`.
 *
 * The cause was not the function, the client, the role, or demo mode — all of
 * which were investigated and ruled out. A **HEAD** count against a missing
 * relation returns `{ count: null, error: null }` from PostgREST, so
 * `assertResult` saw no error and `count ?? 0` produced a confident zero.
 *
 * This pins the fix at the boundary that actually broke: a null count must
 * surface as a failed read, not as an empty CRM.
 */

vi.mock("@/lib/demo/demo-mode", () => ({ isDemoDataEnabled: () => false }));
vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: () => true,
  getSupabaseAdminClient: () => headBlindSpotClient(),
}));
vi.mock("@/lib/supabase/tenant-client", () => ({
  resolveTenantReadHandle: async () => ({ client: headBlindSpotClient(), orgId: "org-1" }),
}));

/** Exactly what PostgREST returns for a HEAD count on a missing relation. */
function headBlindSpotClient() {
  const query = {
    select: () => query,
    eq: () => query,
    limit: () => query,
    then: (resolve: (value: unknown) => unknown) => resolve({ data: null, count: null, error: null }),
  };
  return { from: () => query } as never;
}

describe("getCrmNavCounts when a counted relation is missing", () => {
  it("reports unavailable rather than a CRM full of zeros", async () => {
    const result = await getCrmNavCounts();

    // Before the fix this was `{ status: "live", counts: { contacts: 0, … } }` —
    // indistinguishable from a brand-new workspace.
    expect(result.status).toBe("unavailable");
  });
});

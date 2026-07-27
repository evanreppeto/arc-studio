import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PLANS } from "@/domain";

import { checkUsageAllowed, isBillingEnforcementEnabled, resolveOrgPlan } from "./entitlements";

/**
 * Minimal chainable Supabase stub. `org_plans` and `ai_usage_events` reads both
 * end in an awaited builder; org_plans ends in .maybeSingle(), ai_usage_events is
 * awaited directly. We route by table name.
 */
function makeClient(opts: {
  plan?: { plan_tier: string; monthly_cap_cents: number | null } | null;
  usageRows?: Array<{ cost_estimate_cents: number | null }>;
}) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const methods = ["select", "eq", "gte", "order"];
      for (const m of methods) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: opts.plan ?? null, error: null });
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(
          table === "ai_usage_events"
            ? { data: opts.usageRows ?? [], error: null }
            : { data: opts.plan ?? null, error: null },
        ).then(resolve);
      return chain;
    },
  } as never;
}

const ORIGINAL = process.env.ARC_BILLING_ENFORCEMENT;
beforeEach(() => {
  delete process.env.ARC_BILLING_ENFORCEMENT;
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ARC_BILLING_ENFORCEMENT;
  else process.env.ARC_BILLING_ENFORCEMENT = ORIGINAL;
});

describe("resolveOrgPlan", () => {
  it("defaults to the free tier when no row exists", async () => {
    const plan = await resolveOrgPlan("org-1", makeClient({ plan: null }));
    expect(plan).toEqual({ tier: "free", capCents: PLANS.free.monthlyCapCents });
  });

  it("reads the stored tier and honors a cap override", async () => {
    const plan = await resolveOrgPlan("org-1", makeClient({ plan: { plan_tier: "pro", monthly_cap_cents: 77_000 } }));
    expect(plan).toEqual({ tier: "pro", capCents: 77_000 });
  });

  it("uses the tier default cap when the override is null", async () => {
    const plan = await resolveOrgPlan("org-1", makeClient({ plan: { plan_tier: "starter", monthly_cap_cents: null } }));
    expect(plan).toEqual({ tier: "starter", capCents: PLANS.starter.monthlyCapCents });
  });
});

describe("checkUsageAllowed", () => {
  it("does not block when enforcement is disarmed, even over cap", async () => {
    // No plan row → free tier; usage is deliberately over its cap — but enforcement is off.
    const overFreeCap = PLANS.free.monthlyCapCents * 5;
    const gate = await checkUsageAllowed(
      "org-1",
      makeClient({ plan: null, usageRows: [{ cost_estimate_cents: overFreeCap }] }),
    );
    expect(isBillingEnforcementEnabled()).toBe(false);
    expect(gate).toMatchObject({
      allowed: true,
      enforced: false,
      overCap: true,
      usedCents: overFreeCap,
      capCents: PLANS.free.monthlyCapCents,
    });
  });

  it("blocks when enforcement is armed AND the org is over its cap", async () => {
    process.env.ARC_BILLING_ENFORCEMENT = "1";
    // Two rows summing to exactly 4c over the starter cap — proves the ledger is
    // summed, and that the boundary is inclusive (>= cap blocks).
    const starterCap = PLANS.starter.monthlyCapCents;
    const gate = await checkUsageAllowed(
      "org-1",
      makeClient({
        plan: { plan_tier: "starter", monthly_cap_cents: null },
        usageRows: [{ cost_estimate_cents: starterCap - 1 }, { cost_estimate_cents: 5 }],
      }),
    );
    expect(gate.enforced).toBe(true);
    expect(gate.usedCents).toBe(starterCap + 4);
    expect(gate.overCap).toBe(true);
    expect(gate.allowed).toBe(false);
  });

  it("allows when armed and under cap, reporting remaining headroom", async () => {
    process.env.ARC_BILLING_ENFORCEMENT = "1";
    const used = Math.floor(PLANS.pro.monthlyCapCents / 2); // comfortably under the pro cap
    const gate = await checkUsageAllowed(
      "org-1",
      makeClient({ plan: { plan_tier: "pro", monthly_cap_cents: null }, usageRows: [{ cost_estimate_cents: used }] }),
    );
    expect(gate.allowed).toBe(true);
    expect(gate.capCents).toBe(PLANS.pro.monthlyCapCents);
    expect(gate.remainingCents).toBe(PLANS.pro.monthlyCapCents - used);
  });
});

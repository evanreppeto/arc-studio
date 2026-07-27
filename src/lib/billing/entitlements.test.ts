import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PLANS, TRIAL_CAP_CENTS, TRIAL_TIER } from "@/domain";

import { checkUsageAllowed, isBillingEnforcementEnabled, resolveOrgPlan, usageBlockMessage } from "./entitlements";

/**
 * Minimal chainable Supabase stub. `org_plans` and `ai_usage_events` reads both
 * end in an awaited builder; org_plans ends in .maybeSingle(), ai_usage_events is
 * awaited directly. We route by table name.
 */
function makeClient(opts: {
  plan?: {
    plan_tier: string;
    monthly_cap_cents: number | null;
    trial_ends_at?: string | null;
    subscription_status?: string | null;
  } | null;
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
    expect(plan).toMatchObject({ tier: "free", billedTier: "free", capCents: PLANS.free.monthlyCapCents });
    expect(plan.trial.phase).toBe("none");
  });

  it("reads the stored tier and honors a cap override", async () => {
    const plan = await resolveOrgPlan("org-1", makeClient({ plan: { plan_tier: "pro", monthly_cap_cents: 77_000 } }));
    expect(plan).toMatchObject({ tier: "pro", billedTier: "pro", capCents: 77_000 });
    expect(plan.trial.phase).toBe("none");
  });

  it("uses the tier default cap when the override is null", async () => {
    const plan = await resolveOrgPlan("org-1", makeClient({ plan: { plan_tier: "starter", monthly_cap_cents: null } }));
    expect(plan).toMatchObject({ tier: "starter", billedTier: "starter", capCents: PLANS.starter.monthlyCapCents });
    expect(plan.trial.phase).toBe("none");
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

describe("trial entitlements", () => {
  const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();

  it("grants trial-tier capability on the bounded trial allowance", async () => {
    const plan = await resolveOrgPlan(
      "org-1",
      makeClient({ plan: { plan_tier: "free", monthly_cap_cents: null, trial_ends_at: future } }),
    );
    // Capability is the tier a buyer is evaluating; the cap is the trial's, not
    // that tier's — otherwise a free trial would authorise Pro-sized spend.
    expect(plan.tier).toBe(TRIAL_TIER);
    expect(plan.billedTier).toBe("free");
    expect(plan.capCents).toBe(TRIAL_CAP_CENTS);
    expect(plan.trial.phase).toBe("active");
  });

  it("lets a negotiated cap override win over the trial allowance", async () => {
    const plan = await resolveOrgPlan(
      "org-1",
      makeClient({ plan: { plan_tier: "free", monthly_cap_cents: 50_000, trial_ends_at: future } }),
    );
    expect(plan.capCents).toBe(50_000);
  });

  it("blocks work once a trial lapses, and says why", async () => {
    process.env.ARC_BILLING_ENFORCEMENT = "1";
    const gate = await checkUsageAllowed(
      "org-1",
      makeClient({ plan: { plan_tier: "free", monthly_cap_cents: null, trial_ends_at: past }, usageRows: [] }),
    );
    expect(gate.readOnly).toBe(true);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("trial_expired");
    // Zero usage — this is the trial gate, not the cap gate.
    expect(gate.overCap).toBe(false);
  });

  it("reports the trial reason ahead of the cap when both apply", async () => {
    process.env.ARC_BILLING_ENFORCEMENT = "1";
    const gate = await checkUsageAllowed(
      "org-1",
      makeClient({
        plan: { plan_tier: "free", monthly_cap_cents: null, trial_ends_at: past },
        usageRows: [{ cost_estimate_cents: 999_999 }],
      }),
    );
    // "Your trial ended" is the actionable message; leading with the cap would
    // send the customer to the wrong fix.
    expect(gate.reason).toBe("trial_expired");
    expect(usageBlockMessage(gate)).toContain("free trial has ended");
  });

  // The lockout that would matter most: a customer who paid after their trial
  // date passed must keep working.
  it("never blocks a converted workspace whose trial date has passed", async () => {
    process.env.ARC_BILLING_ENFORCEMENT = "1";
    const gate = await checkUsageAllowed(
      "org-1",
      makeClient({
        plan: { plan_tier: "pro", monthly_cap_cents: null, trial_ends_at: past, subscription_status: "active" },
        usageRows: [],
      }),
    );
    expect(gate.trial.phase).toBe("converted");
    expect(gate.readOnly).toBe(false);
    expect(gate.allowed).toBe(true);
  });

  // Ships dark, like every other enforcement surface here.
  it("does not block a lapsed trial while enforcement is disarmed", async () => {
    const gate = await checkUsageAllowed(
      "org-1",
      makeClient({ plan: { plan_tier: "free", monthly_cap_cents: null, trial_ends_at: past }, usageRows: [] }),
    );
    expect(gate.enforced).toBe(false);
    expect(gate.readOnly).toBe(true);
    expect(gate.allowed).toBe(true);
  });

  // Every workspace that existed before trials shipped has NULL dates.
  it("leaves a pre-trial workspace untouched", async () => {
    process.env.ARC_BILLING_ENFORCEMENT = "1";
    const gate = await checkUsageAllowed(
      "org-1",
      makeClient({ plan: { plan_tier: "starter", monthly_cap_cents: null }, usageRows: [] }),
    );
    expect(gate.trial.phase).toBe("none");
    expect(gate.allowed).toBe(true);
  });
});

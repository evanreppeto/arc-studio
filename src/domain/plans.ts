// Pure, deterministic plan catalog + cap math. No I/O. The persisted per-org
// choice lives in `public.org_plans`; enforcement reads these caps against the
// `ai_usage_events` ledger (see src/lib/billing/entitlements.ts).
//
// Model: the platform pays all provider API credits (Claude + Gemini) and bills
// each tenant. A plan sets a monthly spend cap (in cents, matching the ledger's
// estimated `cost_estimate_cents`).
//
// The cap is COGS, not price — it is the provider spend a tenant is allowed to
// incur, sized so that a tenant who maxes it still leaves ~75% gross margin at
// the list price. List prices (BSR-497): Starter $99, Pro $299, Scale $899 per
// month, flat per workspace. `free` is the default/lapsed state, not a sold
// tier, so its cap is deliberately small — every org without an `org_plans` row
// resolves to it, making this value the blast radius for misconfigured state.
//
// These caps are reasoned, not measured: the usage meter has never been
// reconciled against real provider bills (BSR-502). Re-check them against real
// cost data before arming ARC_BILLING_ENFORCEMENT.

export type PlanTier = "free" | "starter" | "pro" | "scale";

export type PlanDefinition = {
  tier: PlanTier;
  label: string;
  /** Monthly AI-spend cap in cents (estimated provider cost we bill against). */
  monthlyCapCents: number;
};

export const PLAN_TIERS: readonly PlanTier[] = ["free", "starter", "pro", "scale"];

export const PLANS: Record<PlanTier, PlanDefinition> = {
  free: { tier: "free", label: "Free", monthlyCapCents: 200 }, // $2 — default/lapsed state
  starter: { tier: "starter", label: "Starter", monthlyCapCents: 2_500 }, // $25 — sold at $99/mo
  pro: { tier: "pro", label: "Pro", monthlyCapCents: 7_500 }, // $75 — sold at $299/mo
  scale: { tier: "scale", label: "Scale", monthlyCapCents: 25_000 }, // $250 — sold at $899/mo
};

/** Tier assumed for an org with no explicit plan row. */
export const DEFAULT_PLAN_TIER: PlanTier = "free";

/**
 * Stripe subscription statuses that mean the customer is entitled to their paid
 * tier. `past_due` is deliberately included — dunning gets a grace window rather
 * than an instant downgrade.
 *
 * Single source of truth: the Stripe webhook sync uses it to decide which status
 * keeps a paid tier, and the trial logic uses it to decide whether a workspace
 * has converted. If those two ever disagreed, a paying customer could be shown
 * an expired trial.
 */
export const PAID_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
  "past_due",
]);

/** Coerce an untrusted value (DB text, input) to a known tier, else the default. */
export function normalizePlanTier(value: unknown): PlanTier {
  return typeof value === "string" && (PLAN_TIERS as readonly string[]).includes(value)
    ? (value as PlanTier)
    : DEFAULT_PLAN_TIER;
}

export function planForTier(tier: PlanTier): PlanDefinition {
  return PLANS[tier] ?? PLANS[DEFAULT_PLAN_TIER];
}

/**
 * The effective monthly cap for a tier, honoring a per-org override (e.g. a
 * negotiated limit stored in org_plans.monthly_cap_cents). A non-positive or
 * missing override falls back to the tier default.
 */
export function planCapCents(tier: PlanTier, overrideCents?: number | null): number {
  if (typeof overrideCents === "number" && overrideCents > 0) return overrideCents;
  return planForTier(tier).monthlyCapCents;
}

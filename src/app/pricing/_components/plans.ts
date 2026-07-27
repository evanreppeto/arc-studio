import { type PlanTier } from "@/domain";

// The customer-facing pricing catalog. List prices live here.
//
// Two things are deliberately NOT stated on the page, for different reasons:
//
// - The per-tier monthly spend cap, in dollars. It's the enforced cap from
//   `src/domain/plans.ts` and it is our cost of goods, so printing it beside
//   the list price disclosed the gross margin on every plan. The cap still
//   governs usage; only the figure is withheld.
// - Any "up to N campaigns / drafts / images per month" equivalent. The usage
//   meter has never been reconciled against real provider bills (BSR-502), so
//   any such number would be invented.
//
// What's left is qualitative: higher plans include more agent work, the running
// total is visible in-app, and the exact limit is settled during onboarding.

export type PricingPlan = {
  tier: Exclude<PlanTier, "free">;
  name: string;
  /** Monthly list price in whole dollars. */
  monthlyUsd: number;
  tagline: string;
  /** Who this tier is actually right for — not a feature restatement. */
  bestFor: string;
  features: string[];
  featured?: boolean;
};

/** Annual billing bills 10 months for 12 — i.e. two months free. */
export const ANNUAL_MONTHS_CHARGED = 10;

export const TRIAL_DAYS = 14;

export const PRICING_PLANS: PricingPlan[] = [
  {
    tier: "starter",
    name: "Starter",
    monthlyUsd: 99,
    tagline: "For a team running marketing themselves.",
    bestFor: "One operator who wants the agent finding the work and drafting it.",
    features: [
      "Arc finds opportunities from your records and signals",
      "Complete campaign packages, drafted with evidence attached",
      "Approval gate on everything outbound",
      "CRM, personas, and campaign history",
      "Approved email sending",
      "Unlimited seats",
    ],
  },
  {
    tier: "pro",
    name: "Pro",
    monthlyUsd: 299,
    tagline: "For a team that wants the loop closed.",
    bestFor: "Marketing teams that need creative, journeys, and attribution in one place.",
    featured: true,
    features: [
      "Everything in Starter",
      "Creative studio — generate and resize approved assets",
      "Journey tracking: delivery, opens, clicks, replies",
      "Attribution from touchpoint through to booked work",
      "Performance learning — Arc improves on your own results",
      "Brand kit constrains every draft and asset",
    ],
  },
  {
    tier: "scale",
    name: "Scale",
    monthlyUsd: 899,
    tagline: "For higher volume and more moving parts.",
    bestFor: "Teams running many segments, or an agency running several brands.",
    features: [
      "Everything in Pro",
      "Highest monthly agent allowance",
      "Priority agent scheduling",
      "Custom usage limits on request",
      "Onboarding support",
    ],
  },
];

// `allowanceUsd` used to live here and rendered the tier's enforced spend cap
// on each card. It was removed deliberately: that cap is our cost of goods, so
// publishing it beside the list price disclosed the gross margin on every plan.
// The cap still governs usage and is described qualitatively on the page — it
// just isn't quoted as a dollar figure. Read it from `PLANS[tier]` if you need
// it for internal/in-app surfaces, where disclosure isn't a concern.

export function annualUsd(plan: PricingPlan): number {
  return plan.monthlyUsd * ANNUAL_MONTHS_CHARGED;
}

/** What the customer pays per month when billed annually. */
export function annualPerMonthUsd(plan: PricingPlan): number {
  return Math.round(annualUsd(plan) / 12);
}

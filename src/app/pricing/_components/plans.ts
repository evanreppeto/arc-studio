import { PLANS, type PlanTier } from "@/domain";

// The customer-facing pricing catalog.
//
// List prices live here; the monthly AI allowance is read from the enforced
// catalog (`src/domain/plans.ts`) rather than retyped, so the page can never
// advertise an allowance the entitlements layer doesn't actually grant.
//
// Deliberately NOT stated on the page: any "up to N campaigns / drafts / images
// per month" equivalent. The usage meter has never been reconciled against real
// provider bills (BSR-502), so any such number would be invented. The allowance
// is quoted as what it actually is — a spend allowance — until we can measure.

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

/** The enforced monthly AI allowance for a tier, in whole dollars. */
export function allowanceUsd(tier: PricingPlan["tier"]): number {
  return Math.round(PLANS[tier].monthlyCapCents / 100);
}

export function annualUsd(plan: PricingPlan): number {
  return plan.monthlyUsd * ANNUAL_MONTHS_CHARGED;
}

/** What the customer pays per month when billed annually. */
export function annualPerMonthUsd(plan: PricingPlan): number {
  return Math.round(annualUsd(plan) / 12);
}

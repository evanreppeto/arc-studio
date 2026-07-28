import { PLANS, type PlanTier } from "@/domain";

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
//
// ── The bar for a feature bullet ────────────────────────────────────────────
// A bullet may only claim something a customer on that plan gets TODAY, on
// production. Not built-but-switched-off, and not roadmap. Three were removed
// on 2026-07-27 after auditing each against the code and the prod database:
//
// - "Priority agent scheduling" — did not exist in any form. Nothing anywhere
//   schedules or queues agent work by plan tier.
// - "Journey tracking: delivery, opens, clicks, replies" — the receiver is
//   built (#586) but inert: RESEND_WEBHOOK_SECRET is unset on production and
//   no Resend endpoint is configured, so no delivery/open/click/reply event
//   can arrive. The only engagement_events row on prod is an `outbound_send`
//   the app writes itself at send time — hence the narrower bullet that
//   replaced it, which is true.
// - "Attribution from touchpoint through to booked work" — depends on the same
//   dead pipeline; `journey_touchpoints` on prod is empty.
//
// Re-add the last two the moment the Resend webhook is live — they are real
// code, not vapour, and they were removed for being switched off rather than
// for being fictional.

export type PricingPlan = {
  tier: Exclude<PlanTier, "free">;
  name: string;
  /** Monthly list price in whole dollars. */
  monthlyUsd: number;
  tagline: string;
  /** Who this tier is actually right for — not a feature restatement. */
  bestFor: string;
  /**
   * Commercial terms that genuinely are tier-specific. These are human/contract
   * commitments, not software gates — which is the only kind of difference the
   * tiers can honestly claim beyond volume.
   */
  alsoIncluded?: string[];
  featured?: boolean;
};

/**
 * Every capability, available on every plan.
 *
 * The tiers are volume-based, not a feature ladder, because that is what the
 * code actually does: `entitlements.ts` enforces exactly one thing — the
 * monthly spend cap — and there are no per-tier feature gates anywhere in
 * src/lib or src/domain. A ladder here would promise a restriction that does
 * not exist and understate what a Starter customer already gets.
 *
 * Every line is verified against shipped behaviour. See the bar for a bullet
 * above before adding one.
 */
export const EVERY_PLAN_INCLUDES: string[] = [
  "Arc finds opportunities from your records and signals",
  "Complete campaign packages, drafted with evidence attached",
  "Approval gate on everything outbound — no auto-send exists",
  "CRM, personas, and full campaign history",
  "Approved email sending",
  "Creative studio — generate and resize approved assets",
  "Brand kit constrains every draft and asset",
  "Performance learning — Arc improves on your own results",
  "Every approved send recorded against the contact and campaign",
  "Database-level workspace isolation",
  "Unlimited seats — we never charge per person",
];

/**
 * How much agent work a tier includes, relative to the entry paid tier.
 *
 * Derived from the enforced caps so it cannot drift from them, and expressed as
 * a ratio precisely so the page can describe volume WITHOUT publishing the cap
 * in dollars (see the margin note above).
 */
export function capacityMultiple(tier: PricingPlan["tier"]): number {
  const base = PLANS.starter.monthlyCapCents;
  if (base <= 0) return 1;
  return Math.round((PLANS[tier].monthlyCapCents / base) * 10) / 10;
}

/** The volume line shown on each card. */
export function volumeLabel(tier: PricingPlan["tier"]): string {
  const x = capacityMultiple(tier);
  return x === 1 ? "Baseline monthly agent volume" : `${x}× the Starter volume`;
}

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
  },
  {
    tier: "pro",
    name: "Pro",
    monthlyUsd: 299,
    tagline: "For a team that wants the loop closed.",
    bestFor: "Marketing teams that need the creative work and the record of it in one place.",
    featured: true,
  },
  {
    tier: "scale",
    name: "Scale",
    monthlyUsd: 899,
    tagline: "For higher volume and more moving parts.",
    bestFor: "Teams running many segments, or an agency running several brands.",
    alsoIncluded: ["Custom usage limits on request", "Onboarding support"],
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

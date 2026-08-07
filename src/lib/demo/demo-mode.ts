/**
 * Demo fallbacks (synthetic CRM/campaign/brain/persona/activity records) are
 * OFF by default so real, authenticated workspaces show real (possibly empty)
 * data. Set ARC_DEMO_DATA=1 for sales/marketing demos or local preview.
 */
export function isDemoDataEnabled(): boolean {
  return process.env.ARC_DEMO_DATA === "1";
}

/**
 * The plan the demo workspace is on.
 *
 * Shared so the usage meter and the plan panel cannot disagree. They did: the
 * usage fixture hardcoded a $100 cap and labelled it "Starter", while the plan
 * panel resolved Starter's real cap of $25 — two different caps for one plan,
 * on one screen, a few inches apart. Both sides now derive the cap from this
 * tier via `planCapCents`, so there is nothing left to keep in sync by hand.
 */
export const DEMO_PLAN_TIER = "pro" as const;

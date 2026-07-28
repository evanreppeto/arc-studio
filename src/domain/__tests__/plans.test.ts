import { describe, expect, it } from "vitest";

import { DEFAULT_PLAN_TIER, PLANS, PLAN_TIERS, normalizePlanTier, planCapCents, planForTier } from "../plans";

describe("plans", () => {
  it("defines a cap for every tier, ascending with tier", () => {
    const caps = PLAN_TIERS.map((t) => PLANS[t].monthlyCapCents);
    expect(caps).toEqual([...caps].sort((a, b) => a - b));
    expect(caps.every((c) => c > 0)).toBe(true);
  });

  // These caps are COGS, not price — they gate how much provider spend a paying
  // tenant may incur, and were sized against the list prices in BSR-497 to hold
  // ~75% worst-case gross margin. Changing one silently moves the margin, so pin
  // them: update this test deliberately, alongside the pricing decision.
  it("pins the agreed monthly caps", () => {
    expect(PLANS.free.monthlyCapCents).toBe(200); // $2 — default/lapsed state, not sold
    expect(PLANS.starter.monthlyCapCents).toBe(2_500); // $25 — sold at $99/mo
    expect(PLANS.pro.monthlyCapCents).toBe(7_500); // $75 — sold at $299/mo
    expect(PLANS.scale.monthlyCapCents).toBe(25_000); // $250 — sold at $899/mo
  });

  it("normalizes unknown/garbage tiers to the default", () => {
    expect(normalizePlanTier("pro")).toBe("pro");
    expect(normalizePlanTier("enterprise")).toBe(DEFAULT_PLAN_TIER);
    expect(normalizePlanTier(null)).toBe(DEFAULT_PLAN_TIER);
    expect(normalizePlanTier(42)).toBe(DEFAULT_PLAN_TIER);
  });

  it("planForTier returns the definition", () => {
    expect(planForTier("starter")).toEqual(PLANS.starter);
  });

  it("planCapCents honors a positive override, else the tier default", () => {
    expect(planCapCents("free")).toBe(PLANS.free.monthlyCapCents);
    expect(planCapCents("free", 25_000)).toBe(25_000);
    expect(planCapCents("pro", 0)).toBe(PLANS.pro.monthlyCapCents); // non-positive override ignored
    expect(planCapCents("pro", null)).toBe(PLANS.pro.monthlyCapCents);
    expect(planCapCents("pro", -5)).toBe(PLANS.pro.monthlyCapCents);
  });
});

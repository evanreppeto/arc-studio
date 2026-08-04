import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyStripeSubscriptionUpdate, planUpdateForSubscription } from "./subscription-sync";

const ORIG = process.env.STRIPE_PRICE_PRO;
beforeEach(() => {
  process.env.STRIPE_PRICE_PRO = "price_pro";
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.STRIPE_PRICE_PRO;
  else process.env.STRIPE_PRICE_PRO = ORIG;
});

const base = { priceId: "price_pro", subscriptionId: "sub_1", customerId: "cus_1", currentPeriodEnd: null as number | null };

describe("planUpdateForSubscription", () => {
  it("an active subscription resolves to the price's tier", () => {
    const { update, unresolvedPaidPrice } = planUpdateForSubscription({
      ...base,
      status: "active",
      currentPeriodEnd: 1_893_456_000,
    });
    expect(update.plan_tier).toBe("pro");
    expect(update.subscription_status).toBe("active");
    expect(update.stripe_subscription_id).toBe("sub_1");
    expect(update.stripe_customer_id).toBe("cus_1");
    expect(update.current_period_end).toBe(new Date(1_893_456_000 * 1000).toISOString());
    expect(unresolvedPaidPrice).toBe(false);
  });

  it("past_due keeps the paid tier (grace window)", () => {
    expect(planUpdateForSubscription({ ...base, status: "past_due" }).update.plan_tier).toBe("pro");
  });

  it("canceled downgrades to free explicitly", () => {
    const { update, unresolvedPaidPrice } = planUpdateForSubscription({ ...base, status: "canceled" });
    expect(update.plan_tier).toBe("free");
    // Not an anomaly: a cancelled subscription SHOULD go to free.
    expect(unresolvedPaidPrice).toBe(false);
  });

  it("still never GRANTS access for an unmapped price — it just stops revoking it", () => {
    // This replaces an earlier assertion that an unmapped active price wrote
    // `free`. That rule was deliberate ("never grants unmapped access") and the
    // half worth keeping is intact: nothing here grants a tier. What changed is
    // that we no longer DEMOTE a paying customer because of our own config
    // drift — a rotated price, a dashboard edit, or a stale STRIPE_PRICE_*.
    //
    // Omitting plan_tier means an existing row keeps whatever it had, and a new
    // row still falls to the column default (`free`). So the grant path is
    // unchanged and only the revoke path is fixed.
    const { update, unresolvedPaidPrice } = planUpdateForSubscription({
      ...base,
      status: "active",
      priceId: "price_zzz",
    });
    expect(update).not.toHaveProperty("plan_tier");
    expect(unresolvedPaidPrice).toBe(true);
    // The rest of the subscription facts are still recorded.
    expect(update.subscription_status).toBe("active");
    expect(update.stripe_subscription_id).toBe("sub_1");
  });

  it("flags an unmapped price on every paid status, not just active", () => {
    for (const status of ["active", "trialing", "past_due"]) {
      const result = planUpdateForSubscription({ ...base, status, priceId: "price_zzz" });
      expect(result.unresolvedPaidPrice, status).toBe(true);
    }
  });

  it("does not flag an unmapped price when the subscription is not paying", () => {
    // Cancelled with an unknown price is not a configuration fault — it is just
    // a cancelled subscription, and free is the right answer.
    const { update, unresolvedPaidPrice } = planUpdateForSubscription({
      ...base,
      status: "canceled",
      priceId: "price_zzz",
    });
    expect(unresolvedPaidPrice).toBe(false);
    expect(update.plan_tier).toBe("free");
  });

  it("a null current_period_end stays null", () => {
    expect(planUpdateForSubscription({ ...base, status: "active" }).update.current_period_end).toBeNull();
  });
});

describe("applyStripeSubscriptionUpdate", () => {
  const update = {
    plan_tier: "pro" as const,
    subscription_status: "active",
    stripe_subscription_id: "sub_1",
    stripe_customer_id: "cus_1",
    current_period_end: null,
  };

  it("upserts by org_id when Stripe metadata carries one", async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const client = { from: () => ({ upsert }) } as never;
    const res = await applyStripeSubscriptionUpdate({ orgId: "org-9", update }, client);
    expect(res.ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ org_id: "org-9", plan_tier: "pro" }), { onConflict: "org_id" });
  });

  it("falls back to matching the stored customer id when there's no org metadata", async () => {
    const eq = vi.fn(async () => ({ error: null }));
    const update_ = vi.fn(() => ({ eq }));
    const client = { from: () => ({ update: update_ }) } as never;
    const res = await applyStripeSubscriptionUpdate({ orgId: null, update }, client);
    expect(res.ok).toBe(true);
    expect(eq).toHaveBeenCalledWith("stripe_customer_id", "cus_1");
  });

  it("reports failure on a DB error", async () => {
    const client = { from: () => ({ upsert: async () => ({ error: { message: "boom" } }) }) } as never;
    const res = await applyStripeSubscriptionUpdate({ orgId: "org-9", update }, client);
    expect(res).toEqual({ ok: false, reason: "boom" });
  });
});

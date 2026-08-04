import { type SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_PLAN_TIER, PAID_SUBSCRIPTION_STATUSES, type PlanTier } from "@/domain";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

import { tierForPriceId } from "./stripe-plans";

// Pure mapping from a Stripe subscription snapshot to the org_plans row we persist,
// plus the write. Kept separate from the webhook route so the money-critical logic
// (which status keeps a paid tier, which downgrades to free) is unit-tested without
// the Stripe SDK.

/** The subset of a Stripe subscription this sync depends on. */
export type SubscriptionState = {
  status: string;
  priceId: string | null;
  subscriptionId: string;
  customerId: string;
  /** Unix seconds (Stripe's current_period_end), or null. */
  currentPeriodEnd: number | null;
};

export type OrgPlanUpdate = {
  /**
   * Omitted when the subscription is PAID but its price id maps to no known
   * tier. Omitting leaves the stored tier untouched on update (and falls to the
   * column's `free` default on insert), so a config drift cannot silently
   * demote a paying customer. See planUpdateForSubscription.
   */
  plan_tier?: PlanTier;
  subscription_status: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  current_period_end: string | null;
};

// Statuses that KEEP the paid tier (past_due gets a grace window); anything else
// (canceled, unpaid, incomplete_expired, …) falls back to free. Shared with the
// trial logic via the domain catalog so the two can never disagree about whether
// a workspace is paying.
const PAID_STATUSES = PAID_SUBSCRIPTION_STATUSES;

export type PlanUpdatePlan = {
  update: OrgPlanUpdate;
  /**
   * True when the subscription is in a PAID status but its price id matches no
   * configured STRIPE_PRICE_* tier. That is a configuration fault on our side,
   * not a customer state — and it must never pass quietly.
   */
  unresolvedPaidPrice: boolean;
};

/**
 * Map a Stripe subscription to the org_plans update we persist. Pure.
 *
 * THE CASE THIS GUARDS. A paid subscription whose price id does not map to a
 * configured tier used to fall back to `free`. That silently converted a paying
 * customer into a free-tier workspace on a $2/month cap — Stripe got a 200, the
 * row was written, and nothing anywhere logged a word. With billing enforcement
 * armed the customer would then be blocked for exceeding an allowance they had
 * paid to exceed.
 *
 * The drift that produces it is ordinary: a price rotated in Stripe, a
 * subscription edited in the dashboard, a stale STRIPE_PRICE_* after a
 * redeploy, or a negotiated price that was never in env at all.
 *
 * So the tier is now OMITTED rather than defaulted. On an existing row that
 * preserves whatever they were on; on a new row the column default (`free`)
 * still applies, which is no worse than before. The caller reports the anomaly.
 */
export function planUpdateForSubscription(sub: SubscriptionState): PlanUpdatePlan {
  const paid = PAID_STATUSES.has(sub.status);
  const entitled = paid ? tierForPriceId(sub.priceId) : null;
  const unresolvedPaidPrice = paid && entitled === null;

  const update: OrgPlanUpdate = {
    subscription_status: sub.status,
    stripe_subscription_id: sub.subscriptionId,
    stripe_customer_id: sub.customerId,
    current_period_end: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd * 1000).toISOString() : null,
  };

  // Not paying → free is the correct, intended downgrade and stays explicit.
  // Paying but unmappable → leave the tier alone and let the caller shout.
  if (!unresolvedPaidPrice) update.plan_tier = entitled ?? DEFAULT_PLAN_TIER;

  return { update, unresolvedPaidPrice };
}

/**
 * Persist a subscription change. Prefers the org id carried in Stripe metadata
 * (set at checkout); otherwise matches the existing row by stripe_customer_id.
 * Idempotent — re-delivered webhook events converge to the same row.
 */
export async function applyStripeSubscriptionUpdate(
  input: { orgId: string | null; update: OrgPlanUpdate },
  client?: SupabaseClient,
): Promise<{ ok: boolean; reason?: string }> {
  const db = client ?? getSupabaseAdminClient();

  if (input.orgId) {
    const { error } = await db
      .from("org_plans")
      .upsert({ org_id: input.orgId, ...input.update, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
    return error ? { ok: false, reason: error.message } : { ok: true };
  }

  // No org id in metadata — match the customer we stored at checkout time.
  const { error } = await db
    .from("org_plans")
    .update({ ...input.update, updated_at: new Date().toISOString() })
    .eq("stripe_customer_id", input.update.stripe_customer_id);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

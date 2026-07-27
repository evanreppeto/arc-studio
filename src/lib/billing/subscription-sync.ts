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
  plan_tier: PlanTier;
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

/** Map a Stripe subscription to the org_plans update we persist. Pure. */
export function planUpdateForSubscription(sub: SubscriptionState): OrgPlanUpdate {
  const entitled = PAID_STATUSES.has(sub.status) ? tierForPriceId(sub.priceId) : null;
  return {
    plan_tier: entitled ?? DEFAULT_PLAN_TIER,
    subscription_status: sub.status,
    stripe_subscription_id: sub.subscriptionId,
    stripe_customer_id: sub.customerId,
    current_period_end: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd * 1000).toISOString() : null,
  };
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

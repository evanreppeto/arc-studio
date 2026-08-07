import { DEFAULT_PLAN_TIER, PLAN_TIERS, planForTier, type PlanTier } from "@/domain";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { isWorkspaceAdminRole } from "@/lib/auth/workspace-roles";
import { DEMO_PLAN_TIER, isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { resolveOrgPlan } from "./entitlements";
import { isStripeConfigured } from "./stripe";
import { purchasableTiers } from "./stripe-plans";

// Read-model for the Settings → Usage & billing plan control. Surfaces the org's
// current plan + tiers, whether the viewer may change it (owner/admin), and — when
// Stripe is configured — the subscription status + which tiers can be checked out.

const USD0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export type BillingPlanOption = { tier: PlanTier; label: string; capLabel: string };

export type SettingsBillingView = {
  configured: boolean;
  canManage: boolean;
  tier: PlanTier;
  planLabel: string;
  capLabel: string;
  options: BillingPlanOption[];
  /** True when Stripe billing is wired (Checkout/Portal available). */
  stripeConfigured: boolean;
  /** Stripe subscription status (active/trialing/past_due/canceled/…), or null. */
  subscriptionStatus: string | null;
  /** Paid tiers with a configured Stripe price (offered for checkout). */
  purchasableTiers: PlanTier[];
};

function planOptions(): BillingPlanOption[] {
  return PLAN_TIERS.map((tier) => {
    const plan = planForTier(tier);
    return { tier, label: plan.label, capLabel: `${USD0.format(plan.monthlyCapCents / 100)}/mo` };
  });
}

function viewForTier(
  tier: PlanTier,
  configured: boolean,
  canManage: boolean,
  subscriptionStatus: string | null = null,
): SettingsBillingView {
  const plan = planForTier(tier);
  return {
    configured,
    canManage,
    tier,
    planLabel: plan.label,
    capLabel: `${USD0.format(plan.monthlyCapCents / 100)}/mo`,
    options: planOptions(),
    stripeConfigured: isStripeConfigured(),
    subscriptionStatus,
    purchasableTiers: purchasableTiers(),
  };
}

async function orgSubscriptionStatus(orgId: string): Promise<string | null> {
  try {
    const { data } = await getSupabaseAdminClient()
      .from("org_plans")
      .select("subscription_status")
      .eq("org_id", orgId)
      .maybeSingle<{ subscription_status: string | null }>();
    return data?.subscription_status ?? null;
  } catch {
    return null;
  }
}

export async function getSettingsBillingView(): Promise<SettingsBillingView> {
  if (!isSupabaseAdminConfigured()) {
    // Offline preview: coherent with the demo usage card (Starter), interactive so
    // the picker can be tried; a real write no-ops (persisted:false).
    return isDemoDataEnabled()
      ? viewForTier(DEMO_PLAN_TIER, false, true)
      : viewForTier(DEFAULT_PLAN_TIER, false, false);
  }
  try {
    const ctx = await getCurrentWorkspaceContext();
    if (!ctx.orgId) return viewForTier(DEFAULT_PLAN_TIER, false, false);
    const [plan, subscriptionStatus] = await Promise.all([resolveOrgPlan(ctx.orgId), orgSubscriptionStatus(ctx.orgId)]);
    return {
      configured: true,
      canManage: isWorkspaceAdminRole(ctx.role ?? ""),
      tier: plan.tier,
      planLabel: planForTier(plan.tier).label,
      capLabel: `${USD0.format(plan.capCents / 100)}/mo`,
      options: planOptions(),
      stripeConfigured: isStripeConfigured(),
      subscriptionStatus,
      purchasableTiers: purchasableTiers(),
    };
  } catch {
    return viewForTier(DEFAULT_PLAN_TIER, false, false);
  }
}

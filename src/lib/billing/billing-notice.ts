import { resolveBillingNotice, type BillingNotice, type TrialState } from "@/domain";
import { getCurrentOrgId } from "@/lib/auth/org";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { getMonthToDateUsageCents, resolveOrgPlan } from "./entitlements";

// Read-model for the console-wide billing notice. Supersedes the trial-only
// banner: trial state and quota pressure resolve to ONE message (see
// `resolveBillingNotice`) so the operator never gets two stacked strips.

export type BillingNoticeView = {
  trial: TrialState;
  usedCents: number;
  capCents: number;
  notice: BillingNotice | null;
};

const NO_TRIAL: TrialState = { phase: "none", endsAt: null, daysRemaining: 0, readOnly: false };
const EMPTY: BillingNoticeView = { trial: NO_TRIAL, usedCents: 0, capCents: 0, notice: null };

/**
 * The current workspace's billing notice, or silence.
 *
 * Degrades to silence on any failure: this renders on every signed-in screen, so
 * a billing read must never be able to take down the console.
 */
export async function getBillingNoticeView(): Promise<BillingNoticeView> {
  if (!isSupabaseAdminConfigured()) return EMPTY;
  try {
    const orgId = await getCurrentOrgId();
    if (!orgId) return EMPTY;

    const [plan, usedCents] = await Promise.all([resolveOrgPlan(orgId), getMonthToDateUsageCents(orgId)]);
    const notice = resolveBillingNotice({
      trial: plan.trial,
      usedCents,
      capCents: plan.capCents,
      tier: plan.tier,
      now: new Date(),
    });

    return { trial: plan.trial, usedCents, capCents: plan.capCents, notice };
  } catch {
    return EMPTY;
  }
}

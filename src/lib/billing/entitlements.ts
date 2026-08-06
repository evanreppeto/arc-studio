import { type SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_PLAN_TIER,
  MICROCENTS_PER_CENT,
  centsFromMicrocents,
  TRIAL_CAP_CENTS,
  TRIAL_TIER,
  normalizePlanTier,
  planCapCents,
  resolveBillingNotice,
  resolveTrialState,
  type PlanTier,
  type TrialState,
} from "@/domain";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

// Per-org plan resolution + monthly-quota enforcement against the ai_usage_events
// ledger. The platform pays all provider API credits and bills tenants; a plan's
// monthly cap is what a tenant is allowed to spend before we block further work.
//
// Enforcement is DARK by default: `checkUsageAllowed` always computes the numbers,
// but only BLOCKS when ARC_BILLING_ENFORCEMENT=1 is set — so this ships inert and
// is armed deliberately (mirrors the ARC_SEND_ENABLED kill-switch posture), after
// real plans have been assigned.

export type OrgPlan = {
  /** The tier whose capability applies — TRIAL_TIER while a trial is running. */
  tier: PlanTier;
  capCents: number;
  /** The tier actually stored on the row, before any trial uplift. */
  billedTier: PlanTier;
  trial: TrialState;
};

/** Why work was refused, when it was. */
export type UsageBlockReason = "over_cap" | "trial_expired";

export type UsageGate = {
  /** False only when enforcement is armed AND the org is over cap or read-only. */
  allowed: boolean;
  /** Whether ARC_BILLING_ENFORCEMENT is armed (blocking) this deployment. */
  enforced: boolean;
  tier: PlanTier;
  usedCents: number;
  capCents: number;
  remainingCents: number;
  overCap: boolean;
  /** Lapsed trial with no paid plan: reads still work, work does not. */
  readOnly: boolean;
  trial: TrialState;
  reason: UsageBlockReason | null;
};

/** Master kill-switch: quota blocking is inert unless explicitly armed. */
export function isBillingEnforcementEnabled(): boolean {
  return process.env.ARC_BILLING_ENFORCEMENT === "1";
}

const NO_TRIAL: TrialState = { phase: "none", endsAt: null, daysRemaining: 0, readOnly: false };

const DEFAULT_PLAN: OrgPlan = {
  tier: DEFAULT_PLAN_TIER,
  billedTier: DEFAULT_PLAN_TIER,
  capCents: planCapCents(DEFAULT_PLAN_TIER),
  trial: NO_TRIAL,
};

type OrgPlanRow = {
  plan_tier: string;
  monthly_cap_cents: number | null;
  trial_ends_at: string | null;
  subscription_status: string | null;
};

/**
 * The org's effective plan: tier, monthly cap, and trial position.
 *
 * A running trial grants TRIAL_TIER capability on a hard TRIAL_CAP_CENTS
 * allowance — the buyer evaluates the real product, but an abusive trial is
 * bounded. A negotiated per-org cap override still wins, so a hand-set limit is
 * never silently overridden by the trial allowance.
 *
 * Fails OPEN on any error: an unreadable plan row must not lock a customer out.
 */
export async function resolveOrgPlan(orgId: string, client?: SupabaseClient): Promise<OrgPlan> {
  if (!orgId || (!client && !isSupabaseAdminConfigured())) return DEFAULT_PLAN;
  try {
    const db = client ?? getSupabaseAdminClient();
    const { data, error } = await db
      .from("org_plans")
      .select("plan_tier,monthly_cap_cents,trial_ends_at,subscription_status")
      .eq("org_id", orgId)
      .maybeSingle<OrgPlanRow>();
    if (error || !data) return DEFAULT_PLAN;

    const billedTier = normalizePlanTier(data.plan_tier);
    const trial = resolveTrialState({
      trialEndsAt: data.trial_ends_at,
      planTier: billedTier,
      subscriptionStatus: data.subscription_status,
      now: new Date(),
    });

    const onTrial = trial.phase === "active" || trial.phase === "ending_soon";
    const tier = onTrial ? TRIAL_TIER : billedTier;
    const capCents = onTrial
      ? // A negotiated override still wins; otherwise the trial allowance applies.
        (data.monthly_cap_cents && data.monthly_cap_cents > 0 ? data.monthly_cap_cents : TRIAL_CAP_CENTS)
      : planCapCents(billedTier, data.monthly_cap_cents);

    return { tier, billedTier, capCents, trial };
  } catch {
    return DEFAULT_PLAN;
  }
}

function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** Sum of estimated provider cost (cents) charged to this org in the current UTC month. */
export async function getMonthToDateUsageCents(orgId: string, client?: SupabaseClient): Promise<number> {
  if (!orgId || (!client && !isSupabaseAdminConfigured())) return 0;
  try {
    const db = client ?? getSupabaseAdminClient();
    const start = startOfUtcMonth(new Date());
    const { data, error } = await db
      .from("ai_usage_events")
      .select("cost_estimate_cents,cost_microcents")
      .eq("org_id", orgId)
      .gte("occurred_at", start.toISOString());
    if (error || !data) return 0;
    // Sum in MICROCENTS and round ONCE (BSR-502 Finding 5). Summing the rounded
    // per-event `cost_estimate_cents` floors every sub-half-cent call to zero
    // before it is ever added, and that floor only rounds down — so the more small
    // calls an org makes, the further under cap this reads. It is the cap check;
    // it has to sum the precise number.
    //
    // `cost_microcents` is null on rows written before it existed; those never had
    // the precision, so cents * 1000 is the honest reading of them.
    const microcents = (data as Array<{ cost_estimate_cents: number | null; cost_microcents: number | null }>).reduce(
      (sum, row) => sum + (row.cost_microcents ?? (row.cost_estimate_cents ?? 0) * MICROCENTS_PER_CENT),
      0,
    );
    return centsFromMicrocents(microcents);
  } catch {
    return 0;
  }
}

/**
 * Decide whether the org may incur more AI spend this month. `allowed` is true
 * whenever enforcement is disarmed, so callers can gate unconditionally on it.
 */
export async function checkUsageAllowed(orgId: string, client?: SupabaseClient): Promise<UsageGate> {
  const enforced = isBillingEnforcementEnabled();
  const [plan, usedCents] = await Promise.all([
    resolveOrgPlan(orgId, client),
    getMonthToDateUsageCents(orgId, client),
  ]);
  const overCap = usedCents >= plan.capCents;
  const readOnly = plan.trial.readOnly;

  // A lapsed trial is reported first: "your trial ended" is the actionable
  // message, and an expired workspace is usually also at/over its allowance, so
  // leading with the cap would send the customer to the wrong fix.
  const reason: UsageBlockReason | null = readOnly ? "trial_expired" : overCap ? "over_cap" : null;

  return {
    // Both blocks ride the SAME kill-switch as quota enforcement, so the whole
    // billing-enforcement surface arms with one flag and ships inert.
    allowed: !enforced || reason === null,
    enforced,
    tier: plan.tier,
    usedCents,
    capCents: plan.capCents,
    remainingCents: Math.max(0, plan.capCents - usedCents),
    overCap,
    readOnly,
    trial: plan.trial,
    reason,
  };
}

/**
 * The message to show when `checkUsageAllowed` refuses.
 *
 * Derived from the same `resolveBillingNotice` copy the console banner renders,
 * so the wall a customer hits and the banner above it can't tell them different
 * things — including the reset date, which is the question they actually have.
 */
export function usageBlockMessage(gate: UsageGate): string {
  const notice = resolveBillingNotice({
    trial: gate.trial,
    usedCents: gate.usedCents,
    capCents: gate.capCents,
    tier: gate.tier,
    now: new Date(),
  });
  if (notice && (notice.kind === "trial_expired" || notice.kind === "over_cap")) {
    return `${notice.label}. ${notice.detail}`;
  }
  // Defensive: only reached if the gate refused for a reason the notice doesn't
  // model. Say something true rather than nothing.
  return `You've reached this month's plan limit (${formatCentsUsd(gate.capCents)} on the ${gate.tier} plan).`;
}

/** Human-facing dollar string for a cents amount (e.g. plan-limit messages). */
export function formatCentsUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}

import {
  TRIAL_DAYS,
  formatTrialEndsOn,
  trialCountdownLabel,
  type TrialState,
} from "@/domain";
import { getCurrentOrgId } from "@/lib/auth/org";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { resolveOrgPlan } from "./entitlements";

// Read-model for the in-app trial indicator. Deliberately quiet: the ticket asks
// for a persistent but NON-NAGGING signal, so the banner only renders when there
// is something worth saying — inside the warning window, or once lapsed. A
// workspace with 12 comfortable days left sees a small pill, not a banner.

export type TrialBanner = {
  tone: "quiet" | "warn" | "blocked";
  label: string;
  detail: string;
  ctaLabel: string;
  ctaHref: string;
};

export type TrialBannerView = {
  state: TrialState;
  /** Null when there is nothing worth interrupting the operator for. */
  banner: TrialBanner | null;
};

const NO_TRIAL: TrialState = { phase: "none", endsAt: null, daysRemaining: 0, readOnly: false };

/** Pure: turn a trial position into what (if anything) the console should say. */
export function toTrialBanner(state: TrialState): TrialBanner | null {
  if (state.phase === "expired") {
    return {
      tone: "blocked",
      label: "Your free trial has ended",
      detail:
        "Everything you created is still here and still readable. Adding a plan restarts Arc and unpauses outbound.",
      ctaLabel: "Choose a plan",
      ctaHref: "/settings/billing",
    };
  }

  if (state.phase === "ending_soon") {
    return {
      tone: "warn",
      label: `${trialCountdownLabel(state)} in your trial`,
      detail: `Your workspace goes read-only on ${formatTrialEndsOn(state)} — nothing is deleted, and Arc picks up where it left off when you add a plan.`,
      ctaLabel: "Choose a plan",
      ctaHref: "/settings/billing",
    };
  }

  if (state.phase === "active") {
    return {
      tone: "quiet",
      label: `${trialCountdownLabel(state)} in your ${TRIAL_DAYS}-day trial`,
      detail: "",
      ctaLabel: "See plans",
      ctaHref: "/settings/billing",
    };
  }

  // "none" (pre-trial workspaces) and "converted" (paying) say nothing at all.
  return null;
}

/** The current workspace's trial position + banner. Degrades to silence. */
export async function getTrialBannerView(): Promise<TrialBannerView> {
  if (!isSupabaseAdminConfigured()) return { state: NO_TRIAL, banner: null };
  try {
    const orgId = await getCurrentOrgId();
    if (!orgId) return { state: NO_TRIAL, banner: null };
    const plan = await resolveOrgPlan(orgId);
    return { state: plan.trial, banner: toTrialBanner(plan.trial) };
  } catch {
    // A billing read must never take down the console chrome.
    return { state: NO_TRIAL, banner: null };
  }
}

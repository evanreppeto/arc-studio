import { PAID_SUBSCRIPTION_STATUSES, type PlanTier } from "./plans";

// Trial lifecycle — pure, deterministic, no I/O. The persisted dates live on
// `public.org_plans`; the effective plan + read-only gate are derived here so the
// rules are unit-testable and identical everywhere they're asked.
//
// The shape (BSR-497): 14 days, no card, Pro-level capability but a hard $10
// spend allowance so an abusive trial is bounded. At expiry the workspace goes
// READ-ONLY — data stays visible and intact, agent work and outbound stop.
// Nothing is ever deleted by a lapsed trial.

export const TRIAL_DAYS = 14;

/** Absolute AI spend allowed across the whole trial, in cents ($10). */
export const TRIAL_CAP_CENTS = 1_000;

/** Capability level granted during the trial — the shape a buyer is evaluating. */
export const TRIAL_TIER: PlanTier = "pro";

/** Days-remaining marks at which we warn. Descending; each fires at most once. */
export const TRIAL_WARNING_DAYS = [7, 3, 1] as const;

/** At or below this many days remaining the UI escalates its tone. */
export const TRIAL_ENDING_SOON_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export type TrialPhase =
  /** No trial on this workspace (pre-trial orgs, or a plan assigned directly). */
  | "none"
  /** Running, with comfortable headroom. */
  | "active"
  /** Running, but inside the warning window. */
  | "ending_soon"
  /** Lapsed with no paid plan — the workspace is read-only. */
  | "expired"
  /** A paid subscription took over; the trial no longer governs anything. */
  | "converted";

export type TrialInput = {
  trialEndsAt: Date | string | null;
  planTier: PlanTier;
  subscriptionStatus: string | null;
  now: Date;
};

export type TrialState = {
  phase: TrialPhase;
  endsAt: Date | null;
  /** Whole days left, rounded up. 0 once expired or when there is no trial. */
  daysRemaining: number;
  /** True only for `expired`: block agent work and outbound, never reads. */
  readOnly: boolean;
};

function toDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whether a Stripe status means the customer is actually paying us. */
export function hasPaidSubscription(planTier: PlanTier, subscriptionStatus: string | null): boolean {
  return planTier !== "free" && Boolean(subscriptionStatus) && PAID_SUBSCRIPTION_STATUSES.has(subscriptionStatus!);
}

/**
 * The workspace's trial position.
 *
 * Order matters: a paid subscription is checked FIRST, so a customer who
 * converted after their trial date passed is never treated as expired.
 */
export function resolveTrialState(input: TrialInput): TrialState {
  const endsAt = toDate(input.trialEndsAt);

  if (hasPaidSubscription(input.planTier, input.subscriptionStatus)) {
    return { phase: "converted", endsAt, daysRemaining: 0, readOnly: false };
  }

  // No trial recorded. This is the pre-trial world (orgs that existed before
  // trials shipped, or a plan an operator assigned by hand) — it must never
  // become read-only, or shipping this would lock out existing workspaces.
  if (!endsAt) {
    return { phase: "none", endsAt: null, daysRemaining: 0, readOnly: false };
  }

  const msLeft = endsAt.getTime() - input.now.getTime();
  if (msLeft <= 0) {
    return { phase: "expired", endsAt, daysRemaining: 0, readOnly: true };
  }

  const daysRemaining = Math.ceil(msLeft / DAY_MS);
  return {
    phase: daysRemaining <= TRIAL_ENDING_SOON_DAYS ? "ending_soon" : "active",
    endsAt,
    daysRemaining,
    readOnly: false,
  };
}

/** When a trial started now would end. */
export function trialEndsAtFrom(startedAt: Date): Date {
  return new Date(startedAt.getTime() + TRIAL_DAYS * DAY_MS);
}

/**
 * The warning threshold a trial has reached, or null if none is outstanding
 * (or it has already lapsed — an expired trial gets an expiry notice, not a
 * warning).
 *
 * Returns the most urgent threshold that hasn't been sent, and — importantly —
 * never a LESS urgent one than something already sent. Crossing 3 days means
 * every higher threshold is moot: telling someone "7 days left" the day after
 * "3 days left" is worse than saying nothing.
 *
 * So a workspace that goes quiet and comes back jumps straight to the most
 * urgent outstanding notice instead of replaying the whole ladder.
 */
export function dueTrialWarning(state: TrialState, alreadySent: readonly string[]): number | null {
  if (state.phase !== "active" && state.phase !== "ending_soon") return null;

  const sentValues = TRIAL_WARNING_DAYS.filter((d) => alreadySent.includes(noticeKey(d)));
  const mostUrgentSent = sentValues.length ? Math.min(...sentValues) : Number.POSITIVE_INFINITY;

  const due = TRIAL_WARNING_DAYS.filter(
    (d) => state.daysRemaining <= d && d < mostUrgentSent && !alreadySent.includes(noticeKey(d)),
  );
  return due.length ? Math.min(...due) : null;
}

/** Stable key recorded on the org so a warning is emailed at most once. */
export function noticeKey(days: number): string {
  return `trial_t_minus_${days}`;
}

/** Key for the one-time "your trial has ended" notice. */
export const TRIAL_EXPIRED_NOTICE = "trial_expired";

/** Whether the expiry notice is due (lapsed, and not already sent). */
export function isExpiryNoticeDue(state: TrialState, alreadySent: readonly string[]): boolean {
  return state.phase === "expired" && !alreadySent.includes(TRIAL_EXPIRED_NOTICE);
}

/**
 * The trial's end date as a short human date ("12 Aug"). Empty when there is no
 * trial, so callers can concatenate without guarding.
 *
 * Fixed en-GB/UTC formatting so the string is deterministic in tests and does
 * not shift with the server's locale or timezone.
 */
export function formatTrialEndsOn(state: TrialState): string {
  if (!state.endsAt) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(state.endsAt);
}

/** Human phrasing for the days-remaining pill. */
export function trialCountdownLabel(state: TrialState): string {
  if (state.phase === "expired") return "Trial ended";
  if (state.daysRemaining <= 0) return "Trial ended";
  return state.daysRemaining === 1 ? "1 day left" : `${state.daysRemaining} days left`;
}

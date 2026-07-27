import { type PlanTier } from "./plans";
import { TRIAL_DAYS, formatTrialEndsOn, trialCountdownLabel, type TrialState } from "./trial";

// The single billing message the console shows — pure, no I/O.
//
// Trial state and quota state can both be true at once (a lapsed trial is
// usually also over its allowance), and stacking two banners on every screen
// would be noise. So this resolves ONE notice by priority and the console renders
// exactly that.
//
// Priority is by what the operator can act on, most blocking first:
//   1. trial expired   — nothing works; adding a plan is the only fix
//   2. over cap        — agent work paused until reset or upgrade
//   3. near cap        — actionable before anything breaks
//   4. trial ending    — actionable before anything breaks
//   5. trial running   — ambient, one quiet line
//
// Every message states what STOPPED, what is still safe, and the way out.
// "Nothing is deleted" is not reassurance padding: it is the single most
// important fact for someone who just hit a wall, and it is always true here.

/** At or above this share of the cap, warn before anything breaks. */
export const NEAR_CAP_PCT = 80;

export type BillingNoticeKind =
  | "trial_expired"
  | "over_cap"
  | "near_cap"
  | "trial_ending"
  | "trial_active";

export type BillingNoticeTone = "quiet" | "warn" | "blocked";

export type BillingNotice = {
  kind: BillingNoticeKind;
  tone: BillingNoticeTone;
  label: string;
  detail: string;
  ctaLabel: string;
  ctaHref: string;
};

export type BillingNoticeInput = {
  trial: TrialState;
  usedCents: number;
  capCents: number;
  tier: PlanTier;
  /** Now, for computing the reset date. */
  now: Date;
};

const BILLING_HREF = "/settings/billing";

function usd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}

/**
 * When the monthly allowance resets: the first instant of the next UTC month.
 *
 * Must match the window `getMonthToDateUsageCents` sums over — if the message
 * promised a different date than the ledger actually uses, we'd be telling
 * customers the wrong day their work resumes.
 */
export function usageResetsAt(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/** "1 Aug" — the day the allowance comes back. */
export function formatResetDate(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    usageResetsAt(now),
  );
}

/** Percent of the cap used, rounded. 0 when there is no cap. */
export function pctOfCap(usedCents: number, capCents: number): number {
  if (capCents <= 0) return 0;
  return Math.round((usedCents / capCents) * 100);
}

/** The billing period a moment falls in, as `YYYY-MM` (UTC). */
export function usagePeriodKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Idempotency key for a usage notice.
 *
 * Period-scoped by design: unlike a trial notice (once, ever) a usage warning
 * must re-arm each billing period, and embedding the period means a new month is
 * simply a key that hasn't been seen.
 */
export function usageNoticeKey(threshold: 80 | 100, now: Date): string {
  return `usage_${threshold}_${usagePeriodKey(now)}`;
}

/**
 * Which usage notice (if any) is owed, given what's already gone out this period.
 *
 * Returns 100 over 80 when both are outstanding — the more urgent fact wins, and
 * the customer never receives "you're at 80%" after "you're out".
 */
export function dueUsageNotice(
  input: { usedCents: number; capCents: number; now: Date },
  alreadySent: readonly string[],
): 80 | 100 | null {
  if (input.capCents <= 0) return null;
  const pct = pctOfCap(input.usedCents, input.capCents);
  const sent = (t: 80 | 100) => alreadySent.includes(usageNoticeKey(t, input.now));

  if (pct >= 100) return sent(100) ? null : 100;
  // Below the wall, an 80% warning is only useful if the wall notice hasn't
  // already gone out this period.
  if (pct >= NEAR_CAP_PCT) return sent(80) || sent(100) ? null : 80;
  return null;
}

/** The one notice to render, or null when there is nothing worth saying. */
export function resolveBillingNotice(input: BillingNoticeInput): BillingNotice | null {
  const { trial, usedCents, capCents, now } = input;
  const pct = pctOfCap(usedCents, capCents);
  const overCap = capCents > 0 && usedCents >= capCents;
  const resetsOn = formatResetDate(now);

  // 1. Lapsed trial — the most blocking state, and the only one where reads are
  //    the only thing left working.
  if (trial.readOnly) {
    return {
      kind: "trial_expired",
      tone: "blocked",
      label: "Your free trial has ended",
      detail:
        "Arc has stopped and outbound is paused. Everything you created is still here and still readable — nothing was deleted. Adding a plan resumes exactly where you left off.",
      ctaLabel: "Choose a plan",
      ctaHref: BILLING_HREF,
    };
  }

  // 2. Over the monthly allowance. Deliberately specific about what is and is
  //    not affected: approved sends still go out, because delivering
  //    already-approved work costs no model spend.
  if (overCap) {
    return {
      kind: "over_cap",
      tone: "blocked",
      label: `You've used this month's ${usd(capCents)} allowance`,
      detail: `Arc won't start new work until it resets on ${resetsOn}. Your data, approved campaigns and scheduled sends are unaffected — upgrade to carry on now.`,
      ctaLabel: "Upgrade",
      ctaHref: BILLING_HREF,
    };
  }

  // 3. Approaching the wall, while there is still time to act.
  if (capCents > 0 && pct >= NEAR_CAP_PCT) {
    return {
      kind: "near_cap",
      tone: "warn",
      label: `${pct}% of this month's ${usd(capCents)} allowance used`,
      detail: `At 100% Arc pauses new work until it resets on ${resetsOn}. Upgrading now avoids the interruption.`,
      ctaLabel: "See plans",
      ctaHref: BILLING_HREF,
    };
  }

  // 4. Trial running out.
  if (trial.phase === "ending_soon") {
    return {
      kind: "trial_ending",
      tone: "warn",
      label: `${trialCountdownLabel(trial)} in your trial`,
      detail: `Your workspace goes read-only on ${formatTrialEndsOn(trial)} — nothing is deleted, and Arc picks up where it left off when you add a plan.`,
      ctaLabel: "Choose a plan",
      ctaHref: BILLING_HREF,
    };
  }

  // 5. Trial running comfortably — present but ignorable.
  if (trial.phase === "active") {
    return {
      kind: "trial_active",
      tone: "quiet",
      label: `${trialCountdownLabel(trial)} in your ${TRIAL_DAYS}-day trial`,
      detail: "",
      ctaLabel: "See plans",
      ctaHref: BILLING_HREF,
    };
  }

  // A paying workspace under its allowance, or one with no trial and no cap
  // pressure, gets no billing chrome at all.
  return null;
}

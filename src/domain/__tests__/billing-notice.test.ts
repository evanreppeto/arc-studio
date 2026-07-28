import { describe, expect, it } from "vitest";

import {
  NEAR_CAP_PCT,
  formatResetDate,
  pctOfCap,
  resolveBillingNotice,
  resolveTrialState,
  usageResetsAt,
  type TrialState,
} from "../index";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const DAY = 86_400_000;

function trial(days: number | null, paid = false): TrialState {
  return resolveTrialState({
    trialEndsAt: days === null ? null : new Date(NOW.getTime() + days * DAY).toISOString(),
    planTier: paid ? "pro" : "free",
    subscriptionStatus: paid ? "active" : null,
    now: NOW,
  });
}

function notice(opts: { trial?: TrialState; used?: number; cap?: number } = {}) {
  return resolveBillingNotice({
    trial: opts.trial ?? trial(null),
    usedCents: opts.used ?? 0,
    capCents: opts.cap ?? 2_500,
    tier: "starter",
    now: NOW,
  });
}

describe("usageResetsAt", () => {
  // Must match the window getMonthToDateUsageCents sums over, or the message
  // promises the wrong day work resumes.
  it("is the first instant of the next UTC month", () => {
    expect(usageResetsAt(NOW).toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(usageResetsAt(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("formats as a short human date", () => {
    expect(formatResetDate(NOW)).toBe("1 Aug");
  });
});

describe("pctOfCap", () => {
  it("rounds, and reports 0 when there is no cap", () => {
    expect(pctOfCap(1_250, 2_500)).toBe(50);
    expect(pctOfCap(2_499, 2_500)).toBe(100);
    expect(pctOfCap(500, 0)).toBe(0);
  });
});

describe("resolveBillingNotice", () => {
  it("says nothing for a paying workspace well under its allowance", () => {
    expect(notice({ trial: trial(-30, true), used: 100, cap: 7_500 })).toBeNull();
  });

  it("says nothing for a pre-trial workspace under its allowance", () => {
    expect(notice({ trial: trial(null), used: 100 })).toBeNull();
  });

  it("warns at the near-cap threshold, before anything breaks", () => {
    const n = notice({ used: 2_000, cap: 2_500 }); // 80%
    expect(n?.kind).toBe("near_cap");
    expect(n?.tone).toBe("warn");
    expect(n?.label).toContain(`${NEAR_CAP_PCT}%`);
    // Must name the reset date so "when does this come back" is answered.
    expect(n?.detail).toContain("1 Aug");
  });

  it("does not warn just below the threshold", () => {
    expect(notice({ used: 1_974, cap: 2_500 })).toBeNull(); // 79%
  });

  it("blocks at 100% and says what is NOT affected", () => {
    const n = notice({ used: 2_500, cap: 2_500 });
    expect(n?.kind).toBe("over_cap");
    expect(n?.tone).toBe("blocked");
    expect(n?.detail).toContain("1 Aug");
    // The degrade-order promise, stated to the customer: approved work still ships.
    expect(n?.detail).toContain("scheduled sends are unaffected");
  });

  // Both conditions are true at once for most lapsed trials. Showing the cap
  // message would send them to "wait until 1 Aug" when the real fix is a plan.
  it("puts an expired trial ahead of an exhausted allowance", () => {
    const n = notice({ trial: trial(-1), used: 99_999, cap: 2_500 });
    expect(n?.kind).toBe("trial_expired");
    expect(n?.detail).toContain("nothing was deleted");
  });

  it("puts an exhausted allowance ahead of a trial that is merely ending", () => {
    const n = notice({ trial: trial(2), used: 2_500, cap: 2_500 });
    expect(n?.kind).toBe("over_cap");
  });

  it("falls back to the trial warning when the allowance is fine", () => {
    const n = notice({ trial: trial(2), used: 0, cap: 2_500 });
    expect(n?.kind).toBe("trial_ending");
  });

  it("keeps a healthy trial to one quiet line", () => {
    const n = notice({ trial: trial(9), used: 0, cap: 2_500 });
    expect(n?.kind).toBe("trial_active");
    expect(n?.tone).toBe("quiet");
    expect(n?.detail).toBe("");
  });

  it("never reports cap pressure when there is no cap", () => {
    expect(notice({ used: 999_999, cap: 0 })).toBeNull();
  });

  it("always offers a way out", () => {
    for (const n of [
      notice({ trial: trial(-1) }),
      notice({ used: 2_500, cap: 2_500 }),
      notice({ used: 2_000, cap: 2_500 }),
      notice({ trial: trial(2) }),
      notice({ trial: trial(9) }),
    ]) {
      expect(n?.ctaHref).toBe("/settings/billing");
      expect(n?.ctaLabel).toBeTruthy();
    }
  });
});

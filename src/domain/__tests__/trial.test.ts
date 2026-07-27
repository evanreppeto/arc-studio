import { describe, expect, it } from "vitest";

import {
  TRIAL_CAP_CENTS,
  TRIAL_DAYS,
  TRIAL_EXPIRED_NOTICE,
  dueTrialWarning,
  isExpiryNoticeDue,
  noticeKey,
  resolveTrialState,
  trialCountdownLabel,
  trialEndsAtFrom,
  type TrialState,
} from "../trial";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function at(daysFromNow: number): string {
  return new Date(NOW.getTime() + daysFromNow * DAY).toISOString();
}

function state(input: Partial<Parameters<typeof resolveTrialState>[0]> = {}): TrialState {
  return resolveTrialState({
    trialEndsAt: at(10),
    planTier: "free",
    subscriptionStatus: null,
    now: NOW,
    ...input,
  });
}

describe("resolveTrialState", () => {
  it("runs an active trial with whole days remaining", () => {
    const s = state({ trialEndsAt: at(10) });
    expect(s.phase).toBe("active");
    expect(s.daysRemaining).toBe(10);
    expect(s.readOnly).toBe(false);
  });

  it("escalates to ending_soon inside the warning window", () => {
    expect(state({ trialEndsAt: at(3) }).phase).toBe("ending_soon");
    expect(state({ trialEndsAt: at(1) }).phase).toBe("ending_soon");
    expect(state({ trialEndsAt: at(4) }).phase).toBe("active");
  });

  it("expires and goes read-only once the end date passes", () => {
    const s = state({ trialEndsAt: at(-0.001) });
    expect(s.phase).toBe("expired");
    expect(s.readOnly).toBe(true);
    expect(s.daysRemaining).toBe(0);
  });

  // The money-critical ordering: someone who paid AFTER their trial date passed
  // must never be treated as expired. Getting this backwards locks out a paying
  // customer — the worst failure this module can have.
  it("treats a paid subscription as converted even when the trial date has passed", () => {
    const s = state({ trialEndsAt: at(-30), planTier: "pro", subscriptionStatus: "active" });
    expect(s.phase).toBe("converted");
    expect(s.readOnly).toBe(false);
  });

  it("keeps past_due converted — dunning gets a grace window, not a lockout", () => {
    const s = state({ trialEndsAt: at(-5), planTier: "starter", subscriptionStatus: "past_due" });
    expect(s.phase).toBe("converted");
    expect(s.readOnly).toBe(false);
  });

  it("does not treat a cancelled subscription as converted", () => {
    const s = state({ trialEndsAt: at(-5), planTier: "free", subscriptionStatus: "canceled" });
    expect(s.phase).toBe("expired");
    expect(s.readOnly).toBe(true);
  });

  // Backwards compatibility: every workspace that existed before trials shipped
  // has no trial dates. If "no trial" implied read-only, deploying this would
  // silently freeze every existing customer.
  it("leaves a workspace with no trial dates fully usable", () => {
    const s = state({ trialEndsAt: null });
    expect(s.phase).toBe("none");
    expect(s.readOnly).toBe(false);
  });

  it("ignores an unparseable date rather than locking the workspace", () => {
    const s = state({ trialEndsAt: "not-a-date" });
    expect(s.phase).toBe("none");
    expect(s.readOnly).toBe(false);
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(state({ trialEndsAt: new Date(NOW.getTime() + 5 * DAY) }).daysRemaining).toBe(5);
  });
});

describe("trialEndsAtFrom", () => {
  it("lands TRIAL_DAYS after the start", () => {
    expect(trialEndsAtFrom(NOW).toISOString()).toBe(new Date(NOW.getTime() + TRIAL_DAYS * DAY).toISOString());
  });
});

describe("dueTrialWarning", () => {
  it("fires nothing while there is plenty of runway", () => {
    expect(dueTrialWarning(state({ trialEndsAt: at(10) }), [])).toBeNull();
  });

  it("fires the 7-day notice once, then not again", () => {
    const s = state({ trialEndsAt: at(7) });
    expect(dueTrialWarning(s, [])).toBe(7);
    expect(dueTrialWarning(s, [noticeKey(7)])).toBeNull();
  });

  // A workspace that goes quiet and returns should jump straight to the most
  // urgent outstanding notice, not replay the whole ladder.
  it("returns the most urgent outstanding threshold after a gap", () => {
    expect(dueTrialWarning(state({ trialEndsAt: at(1) }), [])).toBe(1);
    // 7 already went out; with 1 day left the next one owed is 1, not 3.
    expect(dueTrialWarning(state({ trialEndsAt: at(1) }), [noticeKey(7)])).toBe(1);
  });

  // Regression: sending the 3-day notice used to leave 7 "crossed but unsent",
  // so the next daily run mailed "7 days left" the day AFTER "3 days left".
  it("never follows an urgent notice with a less urgent one", () => {
    expect(dueTrialWarning(state({ trialEndsAt: at(3) }), [noticeKey(3)])).toBeNull();
    expect(dueTrialWarning(state({ trialEndsAt: at(1) }), [noticeKey(1)])).toBeNull();
    expect(dueTrialWarning(state({ trialEndsAt: at(2) }), [noticeKey(1)])).toBeNull();
  });

  it("never fires a warning for an expired or converted trial", () => {
    expect(dueTrialWarning(state({ trialEndsAt: at(-1) }), [])).toBeNull();
    expect(
      dueTrialWarning(state({ trialEndsAt: at(1), planTier: "pro", subscriptionStatus: "active" }), []),
    ).toBeNull();
  });
});

describe("isExpiryNoticeDue", () => {
  it("is due once for an expired trial and never repeats", () => {
    const s = state({ trialEndsAt: at(-1) });
    expect(isExpiryNoticeDue(s, [])).toBe(true);
    expect(isExpiryNoticeDue(s, [TRIAL_EXPIRED_NOTICE])).toBe(false);
  });

  it("is not due for a running or converted trial", () => {
    expect(isExpiryNoticeDue(state({ trialEndsAt: at(2) }), [])).toBe(false);
    expect(
      isExpiryNoticeDue(state({ trialEndsAt: at(-2), planTier: "pro", subscriptionStatus: "active" }), []),
    ).toBe(false);
  });
});

describe("trialCountdownLabel", () => {
  it("reads naturally at the boundaries", () => {
    expect(trialCountdownLabel(state({ trialEndsAt: at(5) }))).toBe("5 days left");
    expect(trialCountdownLabel(state({ trialEndsAt: at(0.5) }))).toBe("1 day left");
    expect(trialCountdownLabel(state({ trialEndsAt: at(-1) }))).toBe("Trial ended");
  });
});

describe("trial allowance", () => {
  it("bounds an abusive trial well below any paid tier", () => {
    expect(TRIAL_CAP_CENTS).toBe(1_000);
  });
});

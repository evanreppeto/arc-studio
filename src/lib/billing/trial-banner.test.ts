import { describe, expect, it } from "vitest";

import { resolveTrialState, type TrialState } from "@/domain";

import { toTrialBanner } from "./trial-banner";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const DAY = 86_400_000;

function state(days: number | null, paid = false): TrialState {
  return resolveTrialState({
    trialEndsAt: days === null ? null : new Date(NOW.getTime() + days * DAY).toISOString(),
    planTier: paid ? "pro" : "free",
    subscriptionStatus: paid ? "active" : null,
    now: NOW,
  });
}

describe("toTrialBanner", () => {
  it("stays quiet — a pill, not a banner — with comfortable runway", () => {
    const b = toTrialBanner(state(10));
    expect(b?.tone).toBe("quiet");
    expect(b?.label).toContain("10 days left");
    expect(b?.detail).toBe("");
  });

  it("escalates inside the warning window and names the date", () => {
    const b = toTrialBanner(state(2));
    expect(b?.tone).toBe("warn");
    expect(b?.detail).toContain("29 Jul");
    // Reassurance belongs in the warning, not just the post-mortem.
    expect(b?.detail).toContain("nothing is deleted");
  });

  it("blocks after expiry and leads with what was NOT lost", () => {
    const b = toTrialBanner(state(-1));
    expect(b?.tone).toBe("blocked");
    expect(b?.detail).toContain("still here");
  });

  // Silence is the correct output for both of these — a paying customer must
  // never see trial chrome, and pre-trial workspaces have nothing to say.
  it("says nothing for a paying or pre-trial workspace", () => {
    expect(toTrialBanner(state(-30, true))).toBeNull();
    expect(toTrialBanner(state(null))).toBeNull();
  });
});

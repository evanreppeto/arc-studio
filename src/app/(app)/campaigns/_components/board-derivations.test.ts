import { describe, expect, it } from "vitest";

import { type CampaignRollup } from "@/domain";

import { constantAudience, nextActionFor, signalTiming } from "./board-derivations";

function rollup(partial: Partial<CampaignRollup> = {}): CampaignRollup {
  return { state: "empty", label: "", approved: 0, pending: 0, changes: 0, draft: 0, total: 0, ...partial };
}

describe("nextActionFor", () => {
  it("puts the human instruction ahead of everything else", () => {
    // Even a fully-approved-looking roll-up loses to undecided work.
    expect(nextActionFor("draft", 6, rollup({ approved: 4, total: 10, pending: 6 }))).toEqual({
      next: "Approve 6 assets",
      nextTone: "go",
    });
  });

  it("singularizes the instruction", () => {
    expect(nextActionFor("draft", 1, rollup({ pending: 1, total: 1 })).next).toBe("Approve 1 asset");
  });

  it.each([
    ["review", "Waiting on your decision", "go"],
    ["approved", "Waiting to send", "go"],
    ["live", "Going out now", ""],
  ] as const)("keeps the %s instruction", (tone, next, nextTone) => {
    expect(nextActionFor(tone, 0, rollup())).toEqual({ next, nextTone });
  });

  it("counts what Arc is reworking when the roll-up knows", () => {
    expect(nextActionFor("revise", 0, rollup({ changes: 2, total: 5 }))).toEqual({
      next: "Arc is reworking 2 assets",
      nextTone: "warn",
    });
    expect(nextActionFor("revise", 0, rollup()).next).toBe("Arc is reworking it");
  });

  // The redundancy this column existed to avoid, and kept committing anyway:
  // an archived row read `Archived` in one cell and "Put away" in the next.
  it("never restates the status pill on an archived row", () => {
    expect(nextActionFor("archived", 0, rollup({ approved: 6, total: 6 }))).toEqual({
      next: "6 assets kept",
      nextTone: "",
    });
    expect(nextActionFor("archived", 0, rollup()).next).toBe("Nothing in it");
  });

  it("does not let an archived package read as ready work", () => {
    // "All 6 assets approved" is true and misleading on something put away.
    expect(nextActionFor("archived", 0, rollup({ approved: 6, total: 6 })).next).not.toMatch(/approved/);
  });

  it("reports progress when a row asks nothing", () => {
    expect(nextActionFor("draft", 0, rollup({ approved: 3, total: 6 })).next).toBe("3 of 6 approved");
    expect(nextActionFor("draft", 0, rollup({ approved: 6, total: 6 })).next).toBe("All 6 assets approved");
    expect(nextActionFor("draft", 0, rollup({ changes: 2, total: 2 }))).toEqual({
      next: "2 assets sent back",
      nextTone: "warn",
    });
  });

  it("falls back to the drafting line when there is nothing to report", () => {
    expect(nextActionFor("draft", 0, rollup())).toEqual({ next: "Arc is still building it", nextTone: "" });
    expect(nextActionFor("draft", 0, rollup({ draft: 3, total: 3 })).next).toBe("Arc is still building it");
  });
});

describe("constantAudience", () => {
  it("finds the audience every row shares", () => {
    expect(constantAudience([{ audience: "Emergency homeowner" }, { audience: "Emergency homeowner" }])).toBe(
      "Emergency homeowner",
    );
  });

  it("returns null as soon as one row differs", () => {
    expect(
      constantAudience([{ audience: "Emergency homeowner" }, { audience: "Insurance adjuster" }]),
    ).toBeNull();
  });

  it("does not collapse a column that has nothing to collapse", () => {
    expect(constantAudience([])).toBeNull();
    expect(constantAudience([{ audience: "Emergency homeowner" }])).toBeNull();
  });

  it("refuses to report an empty audience as the shared one", () => {
    // Every row missing a persona is not a fact worth promoting to the subhead.
    expect(constantAudience([{ audience: "" }, { audience: "" }])).toBeNull();
    expect(constantAudience([{ audience: "  " }, { audience: "" }])).toBeNull();
  });
});

describe("signalTiming", () => {
  const now = Date.parse("2026-08-05T12:00:00Z");

  it("says nothing about a campaign with no signal", () => {
    expect(signalTiming(null, now)).toBeNull();
    expect(
      signalTiming({ urgency: null, eventType: null, startsAtIso: null, endsAtIso: null }, now),
    ).toBeNull();
  });

  it("counts down an open window", () => {
    expect(
      signalTiming(
        { urgency: "high", eventType: "Flood Advisory", startsAtIso: null, endsAtIso: "2026-08-08T12:00:00Z" },
        now,
      ),
    ).toEqual({ label: "Window closes in 3d", tone: "muted" });
  });

  it("escalates a window closing inside a day", () => {
    expect(
      signalTiming({ urgency: "low", eventType: null, startsAtIso: null, endsAtIso: "2026-08-05T20:00:00Z" }, now),
    ).toEqual({ label: "Window closes in 8h", tone: "warn" });
  });

  // The live workspace's flood campaign: an advisory that expired Aug 1, still
  // sitting on the board looking exactly as actionable as everything else.
  it("says a closed window is closed", () => {
    expect(
      signalTiming(
        { urgency: "low", eventType: "Flood Advisory", startsAtIso: null, endsAtIso: "2026-08-01T14:45:00Z" },
        now,
      ),
    ).toEqual({ label: "Window closed 4d ago", tone: "muted" });
  });

  it("promotes high urgency only when there is no window", () => {
    expect(
      signalTiming({ urgency: "high", eventType: null, startsAtIso: null, endsAtIso: null }, now),
    ).toEqual({ label: "High urgency", tone: "warn" });
    // "medium" on every row would be the Audience column's problem all over.
    expect(signalTiming({ urgency: "medium", eventType: null, startsAtIso: null, endsAtIso: null }, now)).toBeNull();
  });

  it("ignores a timestamp it cannot parse", () => {
    expect(
      signalTiming({ urgency: "high", eventType: null, startsAtIso: null, endsAtIso: "not a date" }, now),
    ).toEqual({ label: "High urgency", tone: "warn" });
  });
});

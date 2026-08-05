import { describe, expect, it } from "vitest";

import { buildLaunchState, type CampaignWorkspaceAsset } from "@/lib/campaigns/read-model";

import { constantAudience, describeContents, nextActionFor, pieceLabel, signalTiming, type DeliverableCounts } from "./board-derivations";

function counts(approved: number, required: number, held?: number): DeliverableCounts {
  return { approved, required, ...(held === undefined ? {} : { held }) };
}

describe("nextActionFor", () => {
  it("puts the human instruction ahead of everything else", () => {
    expect(nextActionFor("draft", 6, counts(4, 10))).toEqual({ next: "Review 6 assets", nextTone: "go" });
  });

  it("singularizes the instruction", () => {
    expect(nextActionFor("draft", 1, counts(0, 1)).next).toBe("Review 1 asset");
  });

  /**
   * The verb has to match what the control does.
   *
   * This button calls `openQueue(...)` — it opens the one-at-a-time review
   * queue and approves nothing on its own. While it read "Approve N assets" the
   * board's most prominent control advertised a blind bulk-approve of
   * customer-facing copy, which is the exact action the approval gate exists to
   * prevent. Nobody had to click it wrongly for that to be a problem: the label
   * is what an owner reads when deciding whether to open it at all.
   */
  it("never tells the operator the button approves anything", () => {
    for (const n of [1, 2, 6, 17]) {
      expect(nextActionFor("draft", n, counts(0, n)).next).not.toMatch(/approve/i);
    }
  });

  it.each([
    ["review", "Waiting on your decision", "go"],
    ["approved", "Waiting to send", "go"],
    ["live", "Going out now", ""],
    ["revise", "Arc is reworking it", "warn"],
  ] as const)("keeps the %s instruction", (tone, next, nextTone) => {
    expect(nextActionFor(tone, 0, counts(0, 0))).toEqual({ next, nextTone });
  });

  // The redundancy this column existed to avoid, and kept committing anyway:
  // an archived row read `Archived` in one cell and "Put away" in the next.
  it("never restates the status pill on an archived row", () => {
    expect(nextActionFor("archived", 0, counts(6, 6))).toEqual({ next: "6 assets kept", nextTone: "" });
    expect(nextActionFor("archived", 0, counts(0, 0)).next).toBe("Nothing in it");
  });

  it("does not let an archived package read as ready work", () => {
    // "All 6 assets approved" is true and misleading on something put away.
    expect(nextActionFor("archived", 0, counts(6, 6)).next).not.toMatch(/approved/);
  });

  /**
   * Archiving a campaign archives its deliverables, so `required` — which counts
   * non-archived gating work — is 0 for every archived row. Reading that number
   * printed "Nothing in it" on the live board directly above a disclosure
   * offering "Show 5 assets": the row contradicting itself in adjacent controls.
   *
   * `held` is what the row will actually disclose, so the two agree.
   */
  it("counts what an archived row holds, not what it still requires", () => {
    expect(nextActionFor("archived", 0, counts(0, 0, 5)).next).toBe("5 assets kept");
    expect(nextActionFor("archived", 0, counts(0, 0, 1)).next).toBe("1 asset kept");
  });

  it("still says nothing-in-it for an archived row that really is empty", () => {
    expect(nextActionFor("archived", 0, counts(0, 0, 0)).next).toBe("Nothing in it");
  });

  it("reports progress when a row asks nothing", () => {
    expect(nextActionFor("draft", 0, counts(3, 6)).next).toBe("3 of 6 approved");
    expect(nextActionFor("draft", 0, counts(6, 6)).next).toBe("All 6 assets approved");
  });

  it("falls back to the drafting line when there is nothing to report", () => {
    expect(nextActionFor("draft", 0, counts(0, 0))).toEqual({ next: "Arc is still building it", nextTone: "" });
    expect(nextActionFor("draft", 0, counts(0, 3)).next).toBe("Arc is still building it");
  });
});

/**
 * The board's total and the campaign page's total are one claim, so they are one
 * computation. This locks the source: `buildLaunchState`, the function the
 * detail page's `.cstate` already renders.
 *
 * The regression it guards is live data. `Chicago Flood Response (Aug 2026)`
 * carries 6 assets AND 1 standalone approval (no `campaign_asset_id`).
 * `deriveCampaignRollup` counts standalone approvals and returns 7; the detail
 * page renders "of 6". Wiring this column to the roll-up made two screens
 * disagree about one campaign.
 */
describe("the board's counts agree with the campaign page's", () => {
  // buildLaunchState reads only `approval?.status ?? status` and `dispatchLocked`.
  function asset(status: string): CampaignWorkspaceAsset {
    return { status, approval: null, dispatchLocked: true } as unknown as CampaignWorkspaceAsset;
  }

  it("reads its numbers from buildLaunchState", () => {
    const assets = [asset("approved"), asset("approved"), asset("pending_approval")];
    const launch = buildLaunchState(assets, true);

    // Exactly the call the page makes, with exactly the fields it passes.
    const action = nextActionFor("draft", 0, { approved: launch.approvedCount, required: launch.requiredCount });

    expect(launch.requiredCount).toBe(3);
    expect(action.next).toBe(`${launch.approvedCount} of ${launch.requiredCount} approved`);
    // And never the roll-up's denominator, which a standalone approval inflates.
    expect(action.next).not.toContain("of 4");
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

describe("pieceLabel", () => {
  // Verbatim from the demo package: three cards that all opened with the same
  // seven words and ellipsed away the channel that told them apart.
  it("drops the campaign name the card already sits under", () => {
    expect(pieceLabel("High-intent follow-up — Email", "High-intent follow-up", "Email")).toEqual({
      label: "Email",
      sub: "",
    });
  });

  it("keeps a title that says something the kind does not", () => {
    expect(pieceLabel("Chicago Flood — Storm hero image", "Chicago Flood", "Paid")).toEqual({
      label: "Storm hero image",
      sub: "Paid",
    });
  });

  it.each(["—", "–", "-", ":", "·", "|"])("handles the %s separator", (sep) => {
    expect(pieceLabel(`Spring push ${sep} Follow-up note`, "Spring push", "Email").label).toBe("Follow-up note");
  });

  it("leaves an unrelated title alone", () => {
    expect(pieceLabel("Storm hero image", "Chicago Flood", "Paid")).toEqual({
      label: "Storm hero image",
      sub: "Paid",
    });
  });

  it("matches the parent case-insensitively", () => {
    expect(pieceLabel("HIGH-INTENT FOLLOW-UP — SMS", "High-intent follow-up", "SMS").label).toBe("SMS");
  });

  it("never renders an empty label", () => {
    // Title identical to the campaign leaves nothing behind; the kind carries it.
    expect(pieceLabel("Spring push", "Spring push", "Email")).toEqual({ label: "Email", sub: "" });
    // And with no kind either, the original title is better than blank.
    expect(pieceLabel("Spring push", "Spring push", "").label).toBe("Spring push");
  });
});

describe("describeContents", () => {
  it("names the things in words an owner already uses", () => {
    expect(describeContents(["Email", "Social Post", "SMS"])).toBe("An email, a social post and a text message");
  });

  it("collapses repeats into a count", () => {
    expect(describeContents(["Email", "Email", "SMS"])).toBe("2 emails and a text message");
    expect(describeContents(["Email", "Email"])).toBe("2 emails");
  });

  it("handles a single thing", () => {
    expect(describeContents(["Email"])).toBe("An email");
    expect(describeContents(["SMS"])).toBe("A text message");
  });

  it("says nothing when there is nothing", () => {
    expect(describeContents([])).toBe("");
  });

  // An unmapped kind still reads as English rather than as a database value.
  it("falls back to an article plus the kind", () => {
    expect(describeContents(["Postcard"])).toBe("A postcard");
    expect(describeContents(["Advert"])).toBe("An advert");
    expect(describeContents([""])).toBe("A draft");
  });

  /**
   * "an one pager" shipped to the live campaigns board.
   *
   * `one_pager` is not in PLAIN_KIND (keyed "one-pager", with a hyphen), so it
   * fell through to a fallback that picked the article from the first LETTER.
   * English picks it from the first SOUND, and "one" starts /w/.
   */
  it("picks the article by sound, not by first letter", () => {
    expect(describeContents(["one pager"])).toBe("A one pager");
    expect(describeContents(["user guide"])).toBe("A user guide");
    expect(describeContents(["hour-long ad"])).toBe("An hour-long ad");
    expect(describeContents(["honest review"])).toBe("An honest review");
  });

  it("leaves the ordinary letter rule alone for everything else", () => {
    expect(describeContents(["umbrella insert"])).toBe("An umbrella insert");
    expect(describeContents(["update"])).toBe("An update");
    expect(describeContents(["postcard"])).toBe("A postcard");
  });

  it("never leads with a lowercase letter", () => {
    for (const kinds of [["SMS"], ["Email", "SMS"], ["Postcard"], ["Email", "Email"]]) {
      expect(describeContents(kinds)[0]).toBe(describeContents(kinds)[0].toUpperCase());
    }
  });
});

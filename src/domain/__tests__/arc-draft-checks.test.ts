import { describe, expect, it } from "vitest";

import {
  arcDraftCheckState,
  arcFindingSeverity,
  type ArcActionFlag,
  type ArcDraftFinding,
} from "@/domain";

const flag = (tone: ArcActionFlag["tone"], label: string = tone): ArcActionFlag => ({ tone, label });
const finding = (over: Partial<ArcDraftFinding> = {}): ArcDraftFinding => ({
  id: "f1",
  severity: "warning",
  message: "Could not ground this claim",
  open: true,
  ...over,
});

describe("arcFindingSeverity", () => {
  it("maps the severities prod actually stores", () => {
    expect(arcFindingSeverity("blocker")).toBe("blocker");
    expect(arcFindingSeverity("warning")).toBe("warning");
  });

  it("treats an unrecognised severity as a warning, not as nothing", () => {
    // An unknown severity is not a safe severity — silently dropping it is how a
    // real finding disappears from the approval screen.
    expect(arcFindingSeverity("weird")).toBe("warning");
    expect(arcFindingSeverity(null)).toBe("warning");
    expect(arcFindingSeverity("")).toBe("warning");
  });
});

describe("arcDraftCheckState", () => {
  /**
   * The regression this whole module exists for. On prod, 13 draft cards carry
   * zero flags AND have open guardrail findings — including blockers. Reading
   * the card alone reports "nothing flagged" about a draft that is blocked.
   */
  it("reports flagged from live findings even when the card carries no flags", () => {
    expect(arcDraftCheckState({ flags: [], findings: [finding({ severity: "blocker" })] })).toBe("flagged");
    expect(arcDraftCheckState({ flags: [], findings: [finding({ severity: "warning" })] })).toBe("flagged");
  });

  it("ignores findings that are already resolved", () => {
    expect(arcDraftCheckState({ flags: [], findings: [finding({ open: false })] })).toBe("clean");
  });

  /**
   * The false claim shipped in #994: "No checks recorded" rendered whenever
   * flags were empty, which was untrue for exactly the drafts that had findings.
   * Not-yet-loaded must say nothing at all.
   */
  it("says unknown — not unchecked — before the live findings load", () => {
    expect(arcDraftCheckState({ flags: [] })).toBe("unknown");
    expect(arcDraftCheckState({ flags: [], findings: undefined })).toBe("unknown");
  });

  it("only reports unchecked once it has actually looked and found none", () => {
    expect(arcDraftCheckState({ flags: [], findings: [] })).toBe("unchecked");
  });

  it("distinguishes an empty findings ARRAY from undefined", () => {
    // The whole contract in one line: [] is an answer, undefined is not.
    expect(arcDraftCheckState({ flags: [], findings: [] })).not.toBe(
      arcDraftCheckState({ flags: [], findings: undefined }),
    );
  });

  it("still trusts the card's own flags before findings load", () => {
    expect(arcDraftCheckState({ flags: [flag("ok", "Brand voice")] })).toBe("clean");
    expect(arcDraftCheckState({ flags: [flag("warn")] })).toBe("flagged");
  });

  it("counts a card flag as evidence a check happened", () => {
    expect(arcDraftCheckState({ flags: [flag("ok")], findings: [] })).toBe("clean");
  });

  /**
   * Verified against prod: all 4 assets with no body (`image_prompt`, channel
   * `media`) were never critiqued, and all 10 with a body were. The critic
   * grounds claims in TEXT, so an image has nothing for it to check — and
   * reporting that as "No checks recorded" reads as a gap in the review rather
   * than a medium the review does not cover.
   */
  it("reports no_copy for a deliverable with no copy at all", () => {
    expect(arcDraftCheckState({ flags: [], findings: [], hasCopy: false })).toBe("no_copy");
    expect(arcDraftCheckState({ flags: [], hasCopy: false })).toBe("no_copy");
  });

  it("still surfaces a finding raised against creative", () => {
    // A guardrail CAN flag an image asset. Silence about copy must never
    // silence an actual finding.
    expect(arcDraftCheckState({ flags: [], findings: [finding()], hasCopy: false })).toBe("flagged");
    expect(arcDraftCheckState({ flags: [flag("risk")], hasCopy: false })).toBe("flagged");
  });

  it("leaves deliverables that DO have copy unaffected", () => {
    expect(arcDraftCheckState({ flags: [], findings: [], hasCopy: true })).toBe("unchecked");
    expect(arcDraftCheckState({ flags: [], hasCopy: true })).toBe("unknown");
  });

  it("never reports unchecked as clean", () => {
    expect(arcDraftCheckState({ flags: [], findings: [] })).not.toBe("clean");
  });
});

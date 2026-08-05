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

  it("never reports unchecked as clean", () => {
    expect(arcDraftCheckState({ flags: [], findings: [] })).not.toBe("clean");
  });
});

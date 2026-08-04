import { describe, expect, it } from "vitest";

import { ARC_NARRATION_LABEL, isNarrationEntry, numberRunSteps } from "./run-phases";

/**
 * BSR-693. The runner emits Arc's own prose as a trace entry labelled "Arc",
 * with the prose in `detail`; the label is a placeholder. The chat has always
 * suppressed it, the run-detail page rendered it as a bold heading, and in prod
 * it is the most common label on the list — 79 of ~200 recorded steps.
 */

/** The shape a real run has: prose, action, prose, action. */
const TRACE = [
  { label: ARC_NARRATION_LABEL },
  { label: "Reading your workspace" },
  { label: ARC_NARRATION_LABEL },
  { label: "Searching CRM contacts" },
  { label: ARC_NARRATION_LABEL },
  { label: "Writing the reply" },
];

describe("isNarrationEntry", () => {
  it("recognises the runner's narration label, whitespace and all", () => {
    expect(isNarrationEntry("Arc")).toBe(true);
    expect(isNarrationEntry("  Arc  ")).toBe(true);
  });

  it("does not swallow a real phase that merely mentions Arc", () => {
    expect(isNarrationEntry("Arc is reading your workspace")).toBe(false);
    expect(isNarrationEntry("Reading your workspace")).toBe(false);
  });
});

describe("numberRunSteps", () => {
  it("gives narration no position", () => {
    const positions = numberRunSteps(TRACE).map((entry) => entry.position);
    expect(positions).toEqual([null, 1, null, 2, null, 3]);
  });

  /**
   * The reason this helper exists rather than using the array index. With three
   * narration entries interleaved, indexing would render 2, 4, 6 — a list that
   * counts to six while showing three steps.
   */
  it("numbers actions consecutively regardless of interleaved narration", () => {
    const shown = numberRunSteps(TRACE)
      .filter((entry) => entry.position !== null)
      .map((entry) => entry.position);
    expect(shown).toEqual([1, 2, 3]);
  });

  it("preserves order and returns every entry, narration included", () => {
    const result = numberRunSteps(TRACE);
    expect(result).toHaveLength(TRACE.length);
    expect(result.map((entry) => entry.step.label)).toEqual(TRACE.map((step) => step.label));
  });

  it("handles a trace with no narration, and one with nothing else", () => {
    expect(numberRunSteps([{ label: "Writing the reply" }]).map((e) => e.position)).toEqual([1]);
    expect(numberRunSteps([{ label: "Arc" }, { label: "Arc" }]).map((e) => e.position)).toEqual([null, null]);
    expect(numberRunSteps([])).toEqual([]);
  });
});

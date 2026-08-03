import { describe, expect, it } from "vitest";

import { stepMediaIndex } from "./campaign-detail-view";

describe("stepMediaIndex", () => {
  it("steps forward and back", () => {
    expect(stepMediaIndex(0, 1, 3)).toBe(1);
    expect(stepMediaIndex(2, -1, 3)).toBe(1);
  });

  it("wraps at both ends", () => {
    expect(stepMediaIndex(2, 1, 3)).toBe(0);
    expect(stepMediaIndex(0, -1, 3)).toBe(2);
  });

  it("stays put on a single asset", () => {
    expect(stepMediaIndex(0, 1, 1)).toBe(0);
    expect(stepMediaIndex(0, -1, 1)).toBe(0);
  });

  // A deliverable can lose its media between render and click; the arrows must
  // not produce a NaN index and blank the dialog.
  it("returns 0 for an empty list", () => {
    expect(stepMediaIndex(0, 1, 0)).toBe(0);
  });
});

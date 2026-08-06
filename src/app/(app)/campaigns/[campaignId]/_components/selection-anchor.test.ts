import { describe, expect, it } from "vitest";

import { isSubstantialSelection, placeSelectionAnchor, type Rect } from "./selection-anchor";

const bounds: Rect = { top: 100, left: 200, width: 800, height: 600 };
const bubble = { width: 220, height: 34 };

describe("placeSelectionAnchor", () => {
  it("centres on the selection and sits above it", () => {
    const selection: Rect = { top: 300, left: 500, width: 100, height: 20 };
    const placed = placeSelectionAnchor(selection, bubble, bounds);
    expect(placed.side).toBe("above");
    // selection centre 550, bubble half-width 110
    expect(placed.left).toBe(440);
    expect(placed.top).toBe(300 - 34 - 8);
  });

  /** A selection on the first line has nowhere to go above it. */
  it("flips below when there is no room above", () => {
    const selection: Rect = { top: 105, left: 500, width: 100, height: 20 };
    const placed = placeSelectionAnchor(selection, bubble, bounds);
    expect(placed.side).toBe("below");
    expect(placed.top).toBe(105 + 20 + 8);
  });

  it("never hangs off the left edge", () => {
    const selection: Rect = { top: 300, left: 205, width: 30, height: 20 };
    const placed = placeSelectionAnchor(selection, bubble, bounds);
    expect(placed.left).toBeGreaterThanOrEqual(bounds.left);
  });

  it("never hangs off the right edge", () => {
    const selection: Rect = { top: 300, left: 960, width: 30, height: 20 };
    const placed = placeSelectionAnchor(selection, bubble, bounds);
    expect(placed.left + bubble.width).toBeLessThanOrEqual(bounds.left + bounds.width);
  });

  /**
   * When the bubble cannot fit, pinning to the left keeps its start visible —
   * which is where the label is. Clamping the other way would hide it.
   */
  it("pins left when the bubble is wider than the space", () => {
    const narrow: Rect = { top: 100, left: 200, width: 120, height: 600 };
    const selection: Rect = { top: 300, left: 210, width: 40, height: 20 };
    const placed = placeSelectionAnchor(selection, bubble, narrow);
    expect(placed.left).toBe(narrow.left + 10);
  });
});

describe("isSubstantialSelection", () => {
  /** The bubble on a stray drag is noise, on a screen built for careful reading. */
  it("ignores a trivial drag", () => {
    expect(isSubstantialSelection("")).toBe(false);
    expect(isSubstantialSelection("the")).toBe(false);
    expect(isSubstantialSelection("   ")).toBe(false);
  });

  /** A double-click selects one word, and that is usually re-reading. */
  it("ignores a single word, however long", () => {
    expect(isSubstantialSelection("responsibilities")).toBe(false);
    expect(isSubstantialSelection("  internationalisation  ")).toBe(false);
  });

  it("accepts a phrase", () => {
    expect(isSubstantialSelection("We answer within the hour")).toBe(true);
    expect(isSubstantialSelection("no exceptions, ever")).toBe(true);
  });
});

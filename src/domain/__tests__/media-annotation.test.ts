import { describe, expect, it } from "vitest";

import {
  composeMediaNote,
  describeRegion,
  formatTimecode,
  isMeaningfulRegion,
  normalizeRegion,
  type MediaRegion,
} from "../media-annotation";

const box = (x: number, y: number, width: number, height: number): MediaRegion => ({ x, y, width, height });

describe("normalizeRegion", () => {
  it("clamps a drag that ran off the edge", () => {
    const region = normalizeRegion(box(-0.2, 0.9, 0.5, 0.5));
    expect(region.x).toBe(0);
    expect(region.y).toBeCloseTo(0.9);
    expect(region.y + region.height).toBeLessThanOrEqual(1);
  });
});

describe("isMeaningfulRegion", () => {
  /** Clicking an image produces a tiny drag; that is not pointing at anything. */
  it("rejects a click-sized box", () => {
    expect(isMeaningfulRegion(box(0.5, 0.5, 0.001, 0.001))).toBe(false);
    expect(isMeaningfulRegion(box(0.5, 0.5, 0.4, 0.002))).toBe(false);
  });

  it("accepts a box big enough to mean a logo", () => {
    expect(isMeaningfulRegion(box(0.7, 0.8, 0.2, 0.15))).toBe(true);
  });
});

describe("describeRegion", () => {
  /**
   * Named from the CENTRE, so a box nudged over a boundary keeps its name —
   * and the centre is what someone means when they point.
   */
  it("names the nine positions", () => {
    expect(describeRegion(box(0.02, 0.02, 0.2, 0.2))).toBe("the top-left");
    expect(describeRegion(box(0.75, 0.02, 0.2, 0.2))).toBe("the top-right");
    expect(describeRegion(box(0.02, 0.75, 0.2, 0.2))).toBe("the bottom-left");
    expect(describeRegion(box(0.75, 0.75, 0.2, 0.2))).toBe("the bottom-right");
    expect(describeRegion(box(0.4, 0.4, 0.2, 0.2))).toBe("the centre");
    expect(describeRegion(box(0.4, 0.02, 0.2, 0.2))).toBe("the top middle");
    expect(describeRegion(box(0.4, 0.75, 0.2, 0.2))).toBe("the bottom middle");
    expect(describeRegion(box(0.02, 0.4, 0.2, 0.2))).toBe("the left side");
    expect(describeRegion(box(0.75, 0.4, 0.2, 0.2))).toBe("the right side");
  });

  /** Selecting nearly the whole frame is not pointing at a part of it. */
  it("says so when the box is most of the picture", () => {
    expect(describeRegion(box(0.05, 0.05, 0.9, 0.9))).toBe("most of the image");
  });
});

describe("formatTimecode", () => {
  it("reads like a scrubber", () => {
    expect(formatTimecode(0)).toBe("0:00");
    expect(formatTimecode(7.4)).toBe("0:07");
    expect(formatTimecode(64)).toBe("1:04");
    expect(formatTimecode(723)).toBe("12:03");
  });

  it("never renders a negative time", () => {
    expect(formatTimecode(-5)).toBe("0:00");
  });
});

describe("composeMediaNote", () => {
  /** Unchanged when the reviewer pointed at nothing. */
  it("is exactly what was typed with no region and no time", () => {
    expect(composeMediaNote({ instruction: "Too dark overall" })).toBe("Too dark overall");
    expect(composeMediaNote({ region: null, atSeconds: null, instruction: "Too dark overall" })).toBe("Too dark overall");
  });

  it("names a region", () => {
    expect(composeMediaNote({ region: box(0.7, 0.75, 0.25, 0.2), instruction: "Remove the text here." })).toBe(
      "About the bottom-right (x 70%–95%, y 75%–95%): Remove the text here.",
    );
  });

  it("names a moment", () => {
    expect(composeMediaNote({ atSeconds: 7.2, instruction: "The logo flickers." })).toBe(
      "About at 0:07: The logo flickers.",
    );
  });

  it("names both for a video frame", () => {
    const out = composeMediaNote({ atSeconds: 64, region: box(0.05, 0.05, 0.2, 0.2), instruction: "Crop this." });
    expect(out).toContain("at 1:04");
    expect(out).toContain("the top-left");
    expect(out.endsWith("Crop this.")).toBe(true);
  });

  /** A click-sized box is not an annotation and must not decorate the note. */
  it("ignores a region too small to mean anything", () => {
    expect(composeMediaNote({ region: box(0.5, 0.5, 0.001, 0.001), instruction: "Fix it" })).toBe("Fix it");
  });
});

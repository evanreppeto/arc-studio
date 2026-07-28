import { describe, expect, it } from "vitest";

import {
  MAX_HANDOFF_NOTE_CHARS,
  describeConsideredAudience,
  hasTargetingRationale,
  normalizeHandoffNote,
  parseConsideredAudiences,
} from "../campaign-package";

describe("parseConsideredAudiences", () => {
  it("keeps well-formed entries", () => {
    expect(
      parseConsideredAudiences([
        { label: "Property managers", reason: "Overlaps the active nurture", sizeEstimate: 120 },
      ]),
    ).toEqual([{ label: "Property managers", reason: "Overlaps the active nurture", sizeEstimate: 120 }]);
  });

  // The reason is the load-bearing half. "We also considered Property Managers"
  // with no explanation looks like diligence while conveying nothing an operator
  // can weigh — worse than showing nothing.
  it("drops an entry with no reason", () => {
    expect(parseConsideredAudiences([{ label: "Property managers" }])).toEqual([]);
    expect(parseConsideredAudiences([{ label: "PM", reason: "   " }])).toEqual([]);
  });

  it("drops an entry with no label", () => {
    expect(parseConsideredAudiences([{ reason: "too small" }])).toEqual([]);
  });

  it("survives malformed storage rather than throwing", () => {
    for (const bad of [null, undefined, "[]", 42, {}, [null, 1, "x"]]) {
      expect(parseConsideredAudiences(bad)).toEqual([]);
    }
  });

  it("ignores a nonsense size rather than displaying it", () => {
    const [entry] = parseConsideredAudiences([
      { label: "A", reason: "b", sizeEstimate: Number.NaN },
    ]);
    expect(entry).toEqual({ label: "A", reason: "b" });
    expect(parseConsideredAudiences([{ label: "A", reason: "b", sizeEstimate: -5 }])[0]).toEqual({
      label: "A",
      reason: "b",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(parseConsideredAudiences([{ label: "  A  ", reason: "  b  " }])).toEqual([{ label: "A", reason: "b" }]);
  });
});

describe("normalizeHandoffNote", () => {
  it("collapses empty to null so 'no note' is one value", () => {
    expect(normalizeHandoffNote("")).toBeNull();
    expect(normalizeHandoffNote("   ")).toBeNull();
    expect(normalizeHandoffNote(null)).toBeNull();
    expect(normalizeHandoffNote(42)).toBeNull();
  });

  it("keeps a real note", () => {
    expect(normalizeHandoffNote("  Lead with the moisture reading.  ")).toBe("Lead with the moisture reading.");
  });

  it("truncates rather than rejecting an over-long note", () => {
    const note = normalizeHandoffNote("x".repeat(MAX_HANDOFF_NOTE_CHARS + 500));
    expect(note).toHaveLength(MAX_HANDOFF_NOTE_CHARS);
  });
});

describe("describeConsideredAudience", () => {
  it("reads as a sentence, with the size only when known", () => {
    expect(
      describeConsideredAudience({ label: "Property managers", reason: "overlaps the nurture", sizeEstimate: 1200 }),
    ).toBe("Property managers (~1,200) — overlaps the nurture");
    expect(describeConsideredAudience({ label: "Adjusters", reason: "no consent basis" })).toBe(
      "Adjusters — no consent basis",
    );
  });
});

describe("hasTargetingRationale", () => {
  // Not a completeness failure: plenty of campaigns have exactly one sensible
  // audience, and inventing a rejected alternative to fill the section would be
  // worse than leaving it empty.
  it("is simply false when nothing was recorded", () => {
    expect(hasTargetingRationale([])).toBe(false);
    expect(hasTargetingRationale([{ label: "A", reason: "b" }])).toBe(true);
  });
});

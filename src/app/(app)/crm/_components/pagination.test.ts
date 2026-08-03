import { describe, expect, it } from "vitest";

import { pageRangeLabel, pageWindow } from "./pagination";

describe("pageWindow", () => {
  it("reaches every record of prod's contact list — the bug this exists for", () => {
    // 254 contacts, the display capped at 100, and the pager was inert: records
    // 101–254 could not be reached by browsing at all (BSR-683). Walking the
    // pages must cover the set exactly once, with no gap and no overlap.
    const total = 254;
    const size = 25;
    const seen: number[] = [];
    const { totalPages } = pageWindow(total, 1, size);
    for (let p = 1; p <= totalPages; p += 1) {
      const { start, end } = pageWindow(total, p, size);
      for (let i = start; i < end; i += 1) seen.push(i);
    }
    expect(totalPages).toBe(11);
    expect(seen).toEqual(Array.from({ length: total }, (_, i) => i));
  });

  it("gives the last page only the rows that are left", () => {
    // 254 = 10 full pages of 25 + a partial page of 4. A naive start+size would
    // slice past the end and the label would claim rows that do not exist.
    expect(pageWindow(254, 11, 25)).toEqual({ totalPages: 11, safePage: 11, start: 250, end: 254 });
  });

  it("clamps a stale page when a filter shrinks the set underneath it", () => {
    // Operator is on page 9, then filters down to 12 rows. Without the clamp
    // they land on an empty table that looks like "no matches".
    expect(pageWindow(12, 9, 25)).toMatchObject({ totalPages: 1, safePage: 1, start: 0, end: 12 });
  });

  it("reports page 1 of 1 for an empty set rather than page 1 of 0", () => {
    expect(pageWindow(0, 1, 25)).toEqual({ totalPages: 1, safePage: 1, start: 0, end: 0 });
  });

  it("survives nonsense input instead of producing a negative slice", () => {
    expect(pageWindow(50, 0, 25)).toMatchObject({ safePage: 1, start: 0 });
    expect(pageWindow(50, -3, 25)).toMatchObject({ safePage: 1, start: 0 });
    expect(pageWindow(50, 2, 0)).toMatchObject({ safePage: 2, start: 1 });
  });

  it("changes the window when rows-per-page changes", () => {
    // The select used to be uncontrolled with no onChange, so 25/50/100 all
    // rendered the same rows.
    expect(pageWindow(254, 1, 50)).toMatchObject({ totalPages: 6, end: 50 });
    expect(pageWindow(254, 1, 100)).toMatchObject({ totalPages: 3, end: 100 });
  });
});

describe("pageRangeLabel", () => {
  it("states the page's real position, not '1–N' of whatever is on screen", () => {
    expect(pageRangeLabel(0, 25, 254)).toBe("1–25 of 254");
    expect(pageRangeLabel(25, 25, 254)).toBe("26–50 of 254");
    expect(pageRangeLabel(250, 4, 254)).toBe("251–254 of 254");
  });

  it("says 0, not '1–0', when nothing matched", () => {
    expect(pageRangeLabel(0, 0, 254)).toBe("0 of 254");
  });

  it("groups thousands so a large workspace stays readable", () => {
    expect(pageRangeLabel(1000, 25, 12_400)).toBe("1,001–1,025 of 12,400");
  });
});

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The Library header said everything twice, and one of the copies was wrong.
 *
 * A stat band above the toolbar carried eleven numbers — the total, a four-way
 * kind breakdown, a three-way readiness split, and "never used" — while the
 * toolbar forty pixels below already had a chip for nearly every one of them.
 * Clicking "39 Arc-ready" in the band and clicking the "Arc-ready" chip ran the
 * same `setCurColl("arc")`. Two control surfaces, one job, and only the one
 * that looked like a control was styled like one: the band's filters were
 * `<span role="button">`, visually identical to the stats beside them that did
 * nothing at all.
 *
 * These tests read source rather than render, in the style of the other guards
 * in this directory. That makes them a floor, not a proof — but the shape they
 * pin is the shape that regressed.
 */

const VIEW = readFileSync(new URL("./_components/library-view.tsx", import.meta.url), "utf8");

/** Strip comments so the notes explaining the old markup are not read as it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SOURCE = withoutComments(VIEW);

describe("the Library header does not duplicate its own toolbar", () => {
  it("keeps every filter in one place — the toolbar", () => {
    const band = SOURCE.match(/<div className="oband">([\s\S]*?)<\/div>\n\n/);
    expect(band, "the header band should still exist").toBeTruthy();
    expect(
      band![1],
      "a filter in the header band is a second copy of a toolbar chip — put the count on the chip instead",
    ).not.toMatch(/setCurColl|setCurKind/);
  });

  it("never dresses a filter as a span", () => {
    // The band's filters were `<span role="button" tabIndex={0}>` with
    // hand-rolled Enter/Space handling — a native <button> or a real chip does
    // this for free, and does not need a keydown handler to be reachable.
    expect(SOURCE).not.toMatch(/role="button"/);
  });
});

describe("a chip's count and the list it produces come from one rule", () => {
  /**
   * The regression this exists for: `totals.arc` counted
   * `!needsReview(a) && isArc(a)` while the filter behind the same word matched
   * `isArc(a)`. A risk-flagged asset that was also marked Arc-available was
   * therefore counted under "need you" and listed under "Arc-ready" — click a
   * 39, get 40 items.
   *
   * No fixture happens to hold such an asset, which is exactly why two
   * definitions of one word survived side by side: they agree until the day
   * they don't. The fix is that there is only one definition to disagree with.
   */
  it("defines each readiness state exactly once", () => {
    for (const predicate of ["isArcReady", "isUnreviewed"]) {
      const declarations = [...SOURCE.matchAll(new RegExp(String.raw`const\s+${predicate}\s*=`, "g"))];
      expect(declarations, `${predicate} should be declared exactly once`).toHaveLength(1);
    }
  });

  it("uses those predicates for BOTH the count and the filter", () => {
    const filter = SOURCE.match(/const inColl = \(a: Asset\) => \{([\s\S]*?)\n  \};/);
    const totals = SOURCE.match(/const totals = useMemo\(\(\) => \{([\s\S]*?)\n  \}, \[/);
    expect(filter, "inColl should still exist").toBeTruthy();
    expect(totals, "totals should still exist").toBeTruthy();

    for (const [name, body] of [
      ["the filter", filter![1]],
      ["the count", totals![1]],
    ] as const) {
      expect(body, `${name} should resolve Arc-ready through isArcReady`).toContain("isArcReady");
      expect(body, `${name} should resolve not-reviewed through isUnreviewed`).toContain("isUnreviewed");
      // The bare predicate is what the two definitions drifted between, so
      // neither side may reach past the shared one to it.
      expect(
        body.replace(/isArcReady|isUnreviewed/g, ""),
        `${name} reaches past isArcReady to a bare isArc(a) — that is the drift`,
      ).not.toMatch(/\bisArc\(a\)/);
    }
  });

  it("gives every collection chip a filter and a count", () => {
    // Scoped to the COLLECTIONS block — an unanchored pair-matcher also scoops
    // up SORTS, and "name" is a sort, not a collection.
    const block = SOURCE.match(/const COLLECTIONS[^=]*= \[([\s\S]*?)\n\] as const;/);
    expect(block, "COLLECTIONS should still exist").toBeTruthy();
    const chips = [...block![1].matchAll(/\["(\w+)",/g)].map((m) => m[1]);
    expect(chips, "COLLECTIONS should list the chips").toContain("untouched");
    expect(chips.length).toBeGreaterThanOrEqual(5);

    const filter = SOURCE.match(/const inColl = \(a: Asset\) => \{([\s\S]*?)\n  \};/)![1];
    const counts = SOURCE.match(/const collectionCount: Record<string, number \| null> = \{([\s\S]*?)\n  \};/)![1];

    for (const chip of chips) {
      // "all" is the unfiltered default and needs no branch.
      if (chip !== "all") {
        expect(filter, `the "${chip}" chip has no filter — it would render every asset`).toContain(`"${chip}"`);
      }
      expect(counts, `the "${chip}" chip has no count entry`).toMatch(new RegExp(`\\b${chip}:`));
    }
  });
});

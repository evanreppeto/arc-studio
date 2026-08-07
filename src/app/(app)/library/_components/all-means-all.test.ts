import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const VIEW = readFileSync(new URL("./library-view.tsx", import.meta.url), "utf8");

/**
 * The Library filters are two independent groups — readiness (All / Arc-ready /
 * Needs you / …) and type (Images / Videos / Logos / Docs) — which is a fine
 * pattern right up until one of them is labelled "All".
 *
 * Measured on the live workspace: pick Videos, and the grid holds 2 of 16 with
 * "All 16" and "Videos 2" BOTH lit. Click "All 16" — still 2. It is the only
 * chip whose label promises the whole set, it renders active, it carries the
 * full count, and in that state pressing it does nothing. The sole way back was
 * remembering which type chip you had pressed and pressing it again to toggle
 * it off.
 */
describe("the chip labelled All resets everything", () => {
  it("clears the type group as well as its own", () => {
    expect(VIEW).toContain('if (k === "all") setCurKind("all");');
  });

  it("leaves the other readiness chips alone", () => {
    // Only "all" is a reset. Picking "Arc-ready" while Videos is active is a
    // legitimate two-axis filter and must keep working.
    const handler = VIEW.match(/onClick=\{\(\) => \{\s*setCurColl\(k\);[\s\S]*?\}\}/)?.[0] ?? "";
    expect(handler).toContain("setCurColl(k);");
    expect(handler).toMatch(/if \(k === "all"\)/);
    // No unconditional reset — that would break the two-axis case above.
    expect(handler).not.toMatch(/^\s*setCurKind\("all"\);/m);
  });

  it("keeps the type chips individually toggleable", () => {
    // Clicking an active type chip clears it. That mechanism was never broken
    // and is what made the bug survivable; it must not regress into the fix.
    expect(VIEW).toContain('onClick={() => setCurKind((c) => (c === k ? "all" : k))}');
  });

  it("still starts with both groups unfiltered", () => {
    expect(VIEW).toContain('const [curKind, setCurKind] = useState("all");');
    expect(VIEW).toContain('const [curColl, setCurColl] = useState("all");');
  });

  it("filters on both axes independently", () => {
    // The predicate both groups feed. If either side stopped being consulted,
    // "All" resetting them would be papering over a larger break.
    expect(VIEW).toMatch(/curKind === "all" \|\| a\.kind === curKind/);
  });
});

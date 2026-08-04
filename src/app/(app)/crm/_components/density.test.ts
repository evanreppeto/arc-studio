import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readStoredDensity } from "./crm-board";

/**
 * BSR-748. "Density settings are coming soon" was a `data-soon` placeholder on
 * a table that routinely holds a few hundred contacts — the screen where row
 * height most earns its keep. It needed no backend, which is what made it worth
 * building rather than leaving marked.
 */

describe("readStoredDensity", () => {
  it("accepts the two real values", () => {
    expect(readStoredDensity("compact")).toBe("compact");
    expect(readStoredDensity("comfortable")).toBe("comfortable");
  });

  it("falls back to comfortable for anything else", () => {
    // localStorage is user-writable and survives deploys, so a value this code
    // never wrote is a normal input, not an impossible one.
    for (const raw of [null, "", "COMPACT", "cosy", "true", "{}", "1"]) {
      expect(readStoredDensity(raw), JSON.stringify(raw)).toBe("comfortable");
    }
  });
});

describe("the control is wired, not decorative", () => {
  const BOARD = readFileSync(join(new URL(".", import.meta.url).pathname, "crm-board.tsx"), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const SOURCE = strip(BOARD);

  it("no longer marks density as unbuilt", () => {
    expect(SOURCE).not.toMatch(/data-soon="[^"]*[Dd]ensity/);
  });

  it("renders a real menu and drives the table from it", () => {
    expect(SOURCE).toMatch(/<DensityMenu value=\{density\} onChange=\{writeDensity\} \/>/);
    expect(SOURCE).toMatch(/data-density=\{density\}/);
  });

  /**
   * Two wrong shapes bracket the right one, and both were tried:
   *
   *   useState(read())            hydration mismatch — the server always
   *                               renders "comfortable"
   *   useState + read in effect   a synchronous setState on mount, i.e. a
   *                               cascading render; eslint rejects it
   *
   * `useSyncExternalStore` has a server snapshot for exactly this reason.
   */
  it("reads the preference without mismatching hydration or cascading a render", () => {
    expect(SOURCE).toMatch(/useSyncExternalStore\(subscribeDensity, densitySnapshot, densityServerSnapshot\)/);
    expect(SOURCE).not.toMatch(/setDensity/);
  });

  it("renders the default on the server, where there is no preference to read", () => {
    expect(SOURCE).toMatch(/function densityServerSnapshot\(\): Density \{\s*return "comfortable";/);
  });

  it("survives a storage read or write that throws", () => {
    // Private mode and quota errors are real, and they can throw on READ too —
    // a display preference must not take the board down for either.
    expect(SOURCE).toMatch(/densityCache = readStoredDensity\(window\.localStorage\.getItem\(DENSITY_KEY\)\);\s*\} catch/);
    expect(SOURCE).toMatch(/window\.localStorage\.setItem\(DENSITY_KEY, next\);\s*\} catch/);
  });
});

describe("the stylesheet actually changes the row", () => {
  const CSS = readFileSync(
    join(new URL("../../", import.meta.url).pathname, "arc-app.css"),
    "utf8",
  );

  it("shrinks the row only vertically", () => {
    const rule = CSS.match(/\[data-density="compact"\][^{]*\.dt tbody td \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/padding-top/);
    expect(rule).toMatch(/padding-bottom/);
    // Horizontal padding must stay: the columns are already tight, and moving
    // it would reflow every cell sideways rather than just packing rows.
    expect(rule).not.toMatch(/padding-left|padding-right|padding:\s/);
  });
});

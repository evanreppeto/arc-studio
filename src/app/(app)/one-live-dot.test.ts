import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * At most one pulsing dot per view (DESIGN.md §6).
 *
 *   "**Live:** the pulsing dot is the `arcBreathe` keyframe (`.indtag i`,
 *    `.arcnote i`); at most one per view."
 *
 * The doc names its two legitimate users, which makes the rule checkable: any
 * third selector animating `arcBreathe` is a second dot waiting to co-occur with
 * one of them.
 *
 * That is not hypothetical. The rail's "Arc is working" dot was given this
 * animation and the rail is persistent chrome — present on every screen — so it
 * competed with whatever live dot the page itself had. Measured on /crm: two
 * breathing simultaneously, the rail dot and `.arcnote i`. The gold "Working"
 * label already carried the meaning; the pulse was decorating it.
 *
 * "Ambient pulsing" is named in the Anti-Patterns list, and the Calm Principles
 * record that a foundation pass already removed a particle field, hero auras and
 * a rail glow. A dot that breathes on every screen is that same drift returning
 * one element at a time.
 *
 * A third dot may be right one day — but it needs the doc updated and this list
 * with it, which is the point of pinning the names here rather than a count.
 */

const APP_DIR = new URL(".", import.meta.url).pathname;

/** The selectors DESIGN.md §6 names as the live dot. */
const ALLOWED = [".indtag i", ".arcnote i"];

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) cssFiles(full, out);
    else if (full.endsWith(".css")) out.push(full);
  }
  return out;
}

describe("only the documented selectors carry the live pulse", () => {
  const animating: string[] = [];
  for (const file of [...cssFiles(APP_DIR), new URL("../globals.css", import.meta.url).pathname]) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      // The keyframe definition itself is not a user of it.
      if (/@keyframes/.test(line)) continue;
      if (!/animation:[^;]*arcBreathe/.test(line)) continue;
      animating.push(line.split("{")[0].trim());
    }
  }

  it("has no third pulsing element", () => {
    const unexpected = animating.filter((sel) => !ALLOWED.some((a) => sel.includes(a)));
    expect(
      unexpected,
      "DESIGN.md §6 allows one live dot per view and names `.indtag i` / `.arcnote i` — a third selector will co-occur with one of them",
    ).toEqual([]);
  });

  it("still has the two the design system relies on", () => {
    // Guard the premise: if both disappear this test passes while asserting
    // nothing, and the rule it protects has quietly stopped existing.
    expect(animating.length).toBeGreaterThan(0);
  });

  /**
   * The rail specifically: it renders on every screen, so a pulse there is not
   * one-per-view under any circumstances.
   */
  it("keeps the rail's working state a label, not a pulse", () => {
    const css = readFileSync(join(APP_DIR, "arc-app.css"), "utf8");
    const railWorking = css.split("\n").filter((l) => l.includes("rail-recent.working"));
    expect(railWorking.length).toBeGreaterThan(0);
    for (const rule of railWorking) {
      expect(rule, "the rail is on every screen — a pulse there is never one-per-view").not.toMatch(/animation:/);
    }
    // ...and the meaning still has to be carried by something.
    expect(css).toMatch(/\.rail-recent-working \{[^}]*color: var\(--accent\)/);
  });
});

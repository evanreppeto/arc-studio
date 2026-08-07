import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `@keyframes` must never sit inside a style rule.
 *
 * `arc-app.css` is one giant nested `.arc-app { … }` block that opens with the
 * whole app's token aliases — `--muted`, `--sans`, `--mono`, `--line`, every
 * surface and text colour. A `@keyframes` nested inside a style rule is not
 * valid CSS nesting, and the parser does not drop just the at-rule: it takes the
 * enclosing block with it. Every token stops resolving at once.
 *
 * What that looks like is NOT a stylesheet that fails to load. The page renders,
 * the layout is intact, and the damage is quiet and plausible:
 *
 *   - `color: var(--muted)` falls through to a `--muted` defined by another
 *     sheet as a near-black *surface* colour, so the rail's timestamps render at
 *     #191920 on a #16161a background — present, aligned, invisible.
 *   - every `font: … var(--sans)` shorthand becomes invalid at computed-value
 *     time and drops WHOLE, font-size included, so 10.5px labels silently render
 *     at the 16px default and wrap.
 *
 * Neither shows up in typecheck, lint, or any test that does not compute style.
 * This is the cheap check that does.
 */
const SHEETS = ["arc-app.css", "arc/arc.css"] as const;

describe("app stylesheets", () => {
  for (const sheet of SHEETS) {
    it(`keeps @keyframes out of nested style blocks in ${sheet}`, () => {
      const css = readFileSync(new URL(`../${sheet}`, import.meta.url), "utf8");

      // Walk the file tracking brace depth. Any `@keyframes` seen at depth > 0
      // is inside a style rule.
      let depth = 0;
      const offenders: string[] = [];
      for (let i = 0; i < css.length; i += 1) {
        const char = css[i];
        if (char === "{") depth += 1;
        else if (char === "}") depth = Math.max(0, depth - 1);
        else if (char === "@" && css.startsWith("@keyframes", i) && depth > 0) {
          offenders.push(css.slice(i, css.indexOf("{", i)).trim());
        }
      }

      expect(offenders).toEqual([]);
    });
  }

  it("defines the tokens the rail reads, on the block that scopes them", () => {
    const css = readFileSync(new URL("../arc-app.css", import.meta.url), "utf8");
    const block = css.slice(css.indexOf(".arc-app {"), css.indexOf("--ease:"));

    // The four the conversation sidebar reads most, and the two whose absence is
    // hardest to see: an undefined --sans silently kills a `font:` shorthand's
    // size, and an undefined --muted resolves to a surface colour, not to
    // nothing.
    for (const token of ["--muted:", "--text-2:", "--line:", "--sans:", "--mono:", "--inset:"]) {
      expect(block).toContain(token);
    }
  });
});

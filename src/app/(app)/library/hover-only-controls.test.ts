import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A control revealed on hover must also be revealed on focus.
 *
 * The Library grid card's `.qa` row holds three real controls per card — add to
 * campaign, edit in Studio, open — at `pointer-events: auto` and in the tab
 * order, but `opacity: 0`. The only rule that revealed them was `.acard:hover`.
 * So a keyboard user tabbing the grid moved through three invisible buttons per
 * card, with nothing on screen to say which card they were on or what they were
 * about to press. Nothing errored and nothing looked wrong to a mouse user,
 * which is why it survived a redesign and two accessibility passes.
 *
 * Two things worth recording, because both cost time and both will recur:
 *
 * 1. The fix belongs on `.qa`, NOT on the `.ov` overlay it sits in, even though
 *    `.ov` is the element with the obvious `opacity: 0` rule. `.ov` is pinned to
 *    opacity 1 by an earlier `:has(.ck)` rule, so a `:focus-within` written
 *    there parses, reads correct in review, and changes nothing. Reading the
 *    stylesheet produced the wrong answer; `getComputedStyle` produced the right
 *    one.
 *
 * 2. Verifying it needs the focus and the measurement in separate ticks. `.qa`
 *    carries `transition: opacity 150ms`, and a backgrounded browser pane
 *    throttles that, so focusing and reading in one go returns the START value
 *    and the fix reads as broken.
 */

const CSS = readFileSync(join(__dirname, "library.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("hover-revealed controls are focus-revealed too", () => {
  it("reveals the grid card's quick actions on focus, not only on hover", () => {
    const reveal = CSS.match(/^[^\n]*\.acard:hover \.ov \.qa[^\n]*$/m)?.[0] ?? "";
    expect(reveal, "the rule that reveals .qa").not.toBe("");
    expect(reveal).toMatch(/:focus-within/);
    expect(reveal).toMatch(/opacity:\s*1/);
  });

  /**
   * The general rule, as a ratchet over this file: any selector that reveals
   * something on `:hover` needs a `:focus-within`/`:focus-visible` twin, unless
   * what it reveals is decoration nobody can focus.
   */
  it("has no opacity-revealing hover rule without a focus twin", () => {
    const offenders: string[] = [];
    for (const line of CSS.split("\n")) {
      if (!/:hover[^{]*\{[^}]*opacity:\s*1/.test(line)) continue;
      // Decoration, not controls: these reveal a gradient scrim, a drag affordance
      // or a row's own chrome — there is nothing inside them to focus.
      if (/\.ov\b(?!.*\.qa)|\.railgrip|::after|::before/.test(line)) continue;
      if (!/:focus-within|:focus-visible/.test(line)) offenders.push(line.trim().slice(0, 100));
    }
    expect(offenders).toEqual([]);
  });
});

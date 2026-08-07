import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Anything revealed on `:hover` must also be revealed on focus.
 *
 * This started as a Library-only guard and is app-wide because the class turned
 * out to be app-wide. Two instances, both found by hit-testing the live DOM
 * rather than by reading the source:
 *
 * - **The Library grid card's `.qa` row** — add to campaign, edit in Studio,
 *   open. `pointer-events: auto` and in the tab order at `opacity: 0`, revealed
 *   by `:hover` alone. Keyboard users tabbed three invisible buttons per card.
 *
 * - **The rail's per-chat options button** (`.rail-recent-more`) — worse,
 *   because it is `display: none`, which removes it from the tab order outright.
 *   Archiving or deleting a chat was not merely hard from a keyboard, it was
 *   impossible, and the `[aria-expanded="true"]` escape hatch could never fire
 *   because nothing could focus the button to press it. This is rail chrome, so
 *   it was true on every screen in the app.
 *
 * `.farch` in Brain is the shape to copy: it guards the *hide* behind
 * `@media (hover: hover)` so a touch screen never gets an invisible-but-tappable
 * control, and adds `:focus-visible { opacity: 1 }`.
 *
 * ## Two traps when verifying this by hand
 *
 * 1. **Measure with the browser pane fronted.** A backgrounded pane freezes both
 *    the page-entrance animation and element transitions, so `getComputedStyle`
 *    returns the START value and a working fix reads as broken. This cost three
 *    separate false "BUG" verdicts before it was pinned down — including on
 *    `.farch`, which was correct all along. A screenshot fronts the pane.
 *
 * 2. **`visibility: hidden` and `display: none` are NOT this bug.** Both remove
 *    an element from the tab order, so a control hidden that way is unreachable
 *    but not *deceptively* focusable. Only `opacity: 0` leaves a focusable,
 *    invisible control. The campaigns board's collapsed asset drawers use
 *    `visibility: hidden` and are correct; an audit that lumps the two together
 *    reports them as bugs.
 */

const APP_DIR = new URL(".", import.meta.url).pathname;

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) cssFiles(full, out);
    else if (full.endsWith(".css")) out.push(full);
  }
  return out;
}

/** The last class named after `:hover` — what the rule reveals. Null = the hovered element itself. */
function revealedClass(selector: string): string | null {
  const afterHover = selector.split(":hover").slice(1).join(":hover");
  const classes = [...afterHover.matchAll(/\.([\w-]+)/g)];
  return classes.length ? classes[classes.length - 1][1] : null;
}

describe("hover-revealed things are focus-revealed too", () => {
  const files = cssFiles(APP_DIR).map((f) => [f.replace(APP_DIR, ""), readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")] as const);

  it("has no hover-reveal of a hidden element without a focus twin", () => {
    const offenders: string[] = [];
    for (const [name, css] of files) {
      for (const line of css.split("\n")) {
        if (!/:hover[^{]*\{[^}]*(opacity:\s*1|display:\s*(flex|block|grid|inline))/.test(line)) continue;
        if (/:focus-within|:focus-visible|:focus\b/.test(line)) continue;
        const cls = revealedClass(line.split("{")[0]);
        if (!cls) continue; // a hover style on the element itself is not a reveal
        // Only a genuinely hidden target matters — otherwise this is emphasis,
        // like brightening an arrow that was already visible at 0.58.
        const hidden = new RegExp(`\\.${cls}\\s*\\{[^}]*(opacity:\\s*0|display:\\s*none)`).test(css);
        if (!hidden) continue;
        // Does any rule anywhere in the file REVEAL the same class on focus?
        //
        // The focus rule has to set the revealing property. Matching any
        // `:focus` rule mentioning the class was too loose: adding a
        // `:focus-visible { outline: … }` — good practice, but it reveals
        // nothing — silenced this check. Verified by reverting the rail fix and
        // watching the general case keep passing while the named one failed.
        const revealsOnFocus = css
          .split("\n")
          .some((l) => new RegExp(`:focus[^{]*\\.${cls}\\b|\\.${cls}\\b[^{]*:focus`).test(l) && /opacity:\s*1|display:\s*(flex|block|grid|inline)/.test(l));
        if (revealsOnFocus) continue;
        offenders.push(`${name}: .${cls} — ${line.trim().slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /** The two that were fixed, named so a regression is obvious rather than a count. */
  it("keeps the Library card's quick actions reachable", () => {
    const css = files.find(([n]) => n.endsWith("library/library.css"))?.[1] ?? "";
    expect(css).not.toBe("");
    const rule = css.match(/^[^\n]*\.acard:hover \.ov \.qa[^\n]*$/m)?.[0] ?? "";
    expect(rule, "the rule that reveals .qa").not.toBe("");
    expect(rule).toMatch(/:focus-within/);
  });

  it("keeps the rail's per-chat options button reachable", () => {
    const css = files.find(([n]) => n.endsWith("arc-app.css"))?.[1] ?? "";
    expect(css).not.toBe("");
    const rule = css.match(/^[^\n]*\.rail-recent-wrap:hover \.rail-recent-more[^\n]*$/m)?.[0] ?? "";
    expect(rule, "the rule that reveals .rail-recent-more").not.toBe("");
    // display:none means it is not merely invisible — it is out of the tab order.
    expect(rule).toMatch(/:focus-within/);
  });
});

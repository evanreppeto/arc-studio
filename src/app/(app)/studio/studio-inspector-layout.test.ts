import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { arStyle } from "./_components/studio-view";

/**
 * Studio's inspector had a silent layout break: `.ipane` was `overflow: auto`
 * with no flex context, so `.arc { flex: 1 }` inside it resolved against auto
 * height and did nothing. The Arc composer laid out directly under the intro
 * paragraph, mid-panel, with the rest of the pane empty beneath it — the panel
 * looked broken and there was no error, no failing test, and nothing in the
 * markup to suggest it.
 *
 * The height chain is now: .insp (flex column) → .ipane (flex column,
 * overflow hidden) → .iscroll / .arcscroll (the only scrollers) + a pinned
 * .ifoot / .composer. Every link has to hold or the footer floats again.
 *
 * Source-text assertions, like the empty-library guard next door: the repo has
 * no jsdom, so a computed-style test isn't available — but these catch the exact
 * regressions (putting `overflow: auto` back on .ipane, dropping the flex
 * column, or letting the toolbar wrap again).
 */

const CSS = readFileSync(join(__dirname, "studio.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declaration block of `.arc-studio <selector> {…}`, base rule only. */
function rule(selector: string): string {
  const match = CSS.match(
    new RegExp(`^\\.arc-studio ${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m"),
  );
  if (!match) throw new Error(`no rule for "${selector}"`);
  return match[1];
}

describe("inspector height chain", () => {
  it("makes .ipane a flex column so a pinned footer has something to pin to", () => {
    const ipane = rule(".ipane");
    expect(ipane).toMatch(/display:\s*flex/);
    expect(ipane).toMatch(/flex-direction:\s*column/);
    expect(ipane).toMatch(/min-height:\s*0/);
  });

  it("does not scroll .ipane itself — that is what made flex:1 inert", () => {
    // `overflow: hidden` is required; `auto`/`scroll` is the regression.
    expect(rule(".ipane")).not.toMatch(/overflow:\s*(auto|scroll)/);
    expect(rule(".ipane")).toMatch(/overflow:\s*hidden/);
  });

  it.each([".iscroll", ".arcscroll"])("scrolls in %s, with a flex floor", (selector) => {
    const block = rule(selector);
    expect(block).toMatch(/overflow:\s*auto/);
    expect(block).toMatch(/min-height:\s*0/);
    expect(block).toMatch(/flex:\s*1/);
  });

  it.each([".ifoot", ".composer"])("pins %s rather than letting it flow", (selector) => {
    expect(rule(selector)).toMatch(/flex-shrink:\s*0/);
  });
});

describe("stage toolbar", () => {
  it("stays on one scrolling row instead of wrapping", () => {
    // Thirteen labelled tools wrapped to four rows — 225px of chrome above the
    // artboard — in the 476px stage a 1280px window leaves.
    const toolbar = rule(".toolbar");
    expect(toolbar).toMatch(/flex-wrap:\s*nowrap/);
    expect(toolbar).toMatch(/overflow-x:\s*auto/);
  });

  it("has no standalone divider element to strand at a row start", () => {
    expect(CSS).not.toMatch(/\.arc-studio \.tdiv\s*\{/);
    const view = readFileSync(join(__dirname, "_components", "studio-view.tsx"), "utf8");
    expect(view).not.toMatch(/className="tdiv"/);
  });

  it("keeps the version strip from overflowing into the inspector", () => {
    // "Ask Arc for variations" rendered 149px inside the inspector column once
    // it stopped wrapping; the strip has to own its overflow.
    expect(rule(".strip")).toMatch(/overflow-x:\s*auto/);
  });
});

/**
 * The artboard scales to the stage instead of scrolling out of it. Every format
 * used to overflow at 1280×720: a 1:1 canvas rendered 421px tall in a 313px
 * stage. The chain is .canvasfit (a size container holding the leftover height)
 * → .canvas (width capped at that height × the format's ratio).
 */
describe("artboard fits the stage", () => {
  it("caps canvas width by the fit box's height, not just its width", () => {
    // `aspect-ratio` + `max-height` cannot do this — max-height clamps the used
    // height and leaves the width, squashing the ratio. The height has to reach
    // the width, which is what the 100cqh term is.
    const canvas = rule(".canvas");
    expect(canvas).toMatch(/width:\s*min\(/);
    expect(canvas).toMatch(/100cqh/);
    expect(canvas).toMatch(/var\(--ar-num/);
  });

  it("puts no min-width on the canvas — a width floor fights the fit", () => {
    // A 180px floor forced a 320px-tall 9:16 canvas into a 213px box, which
    // `contain: size` then let paint over the spec line. The floor lives on
    // .canvasfit, where overflowing it scrolls the stage instead.
    expect(rule(".canvas")).not.toMatch(/min-width:/);
    expect(rule(".canvasfit")).toMatch(/min-height:\s*\d+px/);
  });

  it("eases width alongside aspect-ratio", () => {
    // Ratio-only easing took the new width instantly against the old ratio:
    // 9:16 → 16:9 ballooned the box to ~630px mid-transition.
    const transition = rule(".canvas").match(/transition:([^;]*)/)?.[1] ?? "";
    expect(transition).toMatch(/aspect-ratio/);
    expect(transition).toMatch(/\bwidth\b/);
  });

  it("contains the fit box so it cannot size itself from its own content", () => {
    expect(rule(".canvasfit")).toMatch(/container-type:\s*size/);
    // min-content, not 0: it is what lets the artboard grow past the stage when
    // the fit box hits its floor, giving .stagewrap something to scroll.
    expect(rule(".artboard")).toMatch(/min-height:\s*min-content/);
  });
});

describe("arStyle", () => {
  it.each([
    ["1 / 1", 1],
    ["4 / 5", 0.8],
    ["9 / 16", 0.5625],
    ["16 / 9", 16 / 9],
  ])("turns %s into the ratio CSS needs", (ar, expected) => {
    const style = arStyle(ar) as Record<string, unknown>;
    expect(style.aspectRatio).toBe(ar);
    expect(style["--ar-num"]).toBeCloseTo(expected, 6);
  });

  it("falls back to 1 rather than emitting NaN into the width calc", () => {
    // calc(100cqh * NaN) is an invalid declaration — the whole width rule would
    // be dropped and the canvas would go back to being width-only.
    for (const bad of ["", "auto", "16 / 0", "16/x"]) {
      expect((arStyle(bad) as Record<string, unknown>)["--ar-num"]).toBe(1);
    }
  });
});

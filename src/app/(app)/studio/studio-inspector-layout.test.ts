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

  /**
   * The row fits now, and has to keep fitting. Not wrapping was the right call;
   * thirteen labelled controls was the wrong number. Even compacted they needed
   * 1455px of row inside the 636px stage a 1440×900 window leaves — Edit and
   * half of Generate lived off the right edge, and `scrollbar-width: none` meant
   * nothing on screen admitted it. The eight AI tools moved to the Arc pane,
   * where they belong: every one of them only ever typed into its composer.
   *
   * Counting source entries is the only measurement available here (no jsdom, so
   * no layout), but it is the number that actually regressed.
   */
  it("keeps the stage toolbar down to controls that fit without scrolling", () => {
    const view = readFileSync(join(__dirname, "_components", "studio-view.tsx"), "utf8");
    const toolsBlock = view.match(/const TOOLS = \{[\s\S]*?\n\} as const;/)?.[0] ?? "";
    expect(toolsBlock).not.toBe("");
    // Each entry is one pill on the row.
    expect(toolsBlock.match(/\{ t: "/g) ?? []).toHaveLength(5);
    // The AI tools live in the Arc pane, and seed the composer rather than
    // claiming to act on the canvas.
    expect(toolsBlock).not.toMatch(/ask:/);
    expect(toolsBlock).not.toMatch(/target: "arc"/);
    expect(view).toMatch(/const ARC_ACTIONS = \[/);
  });
});

/**
 * The composer asks for the request, not for a stance on it.
 *
 * Ask / Act / Draft was three buttons that set one word in the message preamble.
 * `sendArcMessageAction` was never passed a mode from Studio at all, so every
 * message ran as `act` whichever button was lit — the control was decoration on
 * a decision the backend had already made. The capability is inferred from what
 * the operator wrote (resolveArcComposerMode, shared with the main chat
 * composer) and actually sent.
 */
describe("Arc composer", () => {
  const view = readFileSync(join(__dirname, "_components", "studio-view.tsx"), "utf8");

  it("has no Ask/Act/Draft picker", () => {
    expect(view).not.toMatch(/setCmode|MODE_HINT|className="modes"/);
    expect(CSS).not.toMatch(/\.arc-studio \.modehint\s*\{/);
  });

  it("infers the mode from the request and sends it", () => {
    expect(view).toMatch(/mode: resolveArcComposerMode\(\{ request: text \}\)/);
  });

  it("renders what Arc made, not just what Arc said", () => {
    // The pane's empty state promised the render would appear. ArcThreadMessage
    // carried body + role only, so it never did.
    expect(view).toMatch(/m\.media\.map/);
    expect(CSS).toMatch(/\.arc-studio \.arcshot\s*\{/);
  });

  /**
   * Arc could make a new asset but not touch the creative in front of you: the
   * answer to "rewrite this punchier" was words to retype by hand, and a
   * generated photo could only be looked at, never composed on.
   */
  it("can put Arc's words into the canvas fields", () => {
    expect(view).toMatch(/extractCanvasCopy\(body\)/);
    expect(view).toMatch(/onClick=\{\(\) => applyCopy\(s\)\}/);
  });

  /**
   * The double-bake guard, and the reason `source` is carried through at all. A
   * `composite` already has the logo and headline in its pixels; making it the
   * background would composite the operator's copy on top of Arc's. Only a
   * generated scene may be adopted — generation strips text by design.
   */
  it("only offers a generated scene as the background, never a composite", () => {
    expect(view).toMatch(/md\.source === "ai_generated"/);
    const fn = view.match(/const applyArcMediaAsBackground[\s\S]*?\n  \};/)?.[0] ?? "";
    expect(fn).toMatch(/media\.source !== "ai_generated"/);
    expect(fn).toMatch(/return;/);
  });

  /**
   * The pane's own copy asks have to produce output the parse can read. The
   * extractor is label-driven and fails closed, so an unlabelled reply yields
   * nothing — which would make the most common copy request the one case the
   * Apply control never fires on.
   */
  it("asks for labelled copy in the quick asks that request copy", () => {
    const actions = view.match(/const ARC_ACTIONS = \[[\s\S]*?\n\] as const;/)?.[0] ?? "";
    expect(actions).toMatch(/id: "headlines"[^\n]*Headline:/);
    expect(actions).toMatch(/id: "shorter"[^\n]*Headline:/);
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

/**
 * The Design pane's controls are real buttons.
 *
 * A live audit of prod (2026-08-05) hit-tested every element in the pane and
 * found the opposite: the accent swatches, the three template tiles, and every
 * `.exrow` — including **Generate creative**, the primary action on the
 * screen — were `<div>`/`<span>` with an `onClick`. `tabIndex: -1`, no role, and
 * in the swatches' case no accessible name at all: a colour with nothing to read.
 * Keyboard and screen-reader users could not change the accent, the template, or
 * generate anything.
 *
 * Source assertions because the repo has no jsdom. They catch the regression that
 * actually happened — someone reaching for a `<div>` because it is one line
 * shorter — which is how these got that way.
 */
describe("Design pane controls are focusable and named", () => {
  const view = readFileSync(join(__dirname, "_components", "studio-view.tsx"), "utf8");

  it("uses buttons for the action rows, not clickable divs", () => {
    expect(view).not.toMatch(/<div className="exrow/);
    expect(view).toMatch(/<button[\s\S]{0,80}className="exrow gold"/);
  });

  it("gives every accent swatch a name — a colour has no text to announce", () => {
    const swatches = view.match(/className=\{`sw\$\{[\s\S]*?\/>/)?.[0] ?? "";
    expect(swatches).toMatch(/aria-label=/);
    expect(swatches).toMatch(/aria-pressed=/);
  });

  it("makes the template tiles buttons that report which is chosen", () => {
    const tmpl = view.match(/className=\{`tmplc\$\{[^}]*\}`\}[^>]*/)?.[0] ?? "";
    expect(view).toMatch(/<button type="button" key=\{tm\.id\}/);
    expect(tmpl).toMatch(/aria-pressed=/);
  });

  /** The gate reason was a hover-only toast; a disabled button has to say why. */
  it("puts the generate gate reason on the button, not only in a toast", () => {
    expect(view).toMatch(/title=\{genGate \?\? undefined\}/);
  });
});

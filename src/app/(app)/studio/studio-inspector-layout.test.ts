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
 * No component may be declared inside StudioView's render body.
 *
 * Reported as "every time I type, the images on the left keep blinking". `Tile`
 * — the Sources rail tile — was a `const Tile = ({item, i}) => …` declared in
 * the render body, so it was a NEW component type on every render. React cannot
 * reconcile across a changed type: it unmounts the old subtree and mounts a
 * fresh one. Each tile's `AppImage` therefore remounted at `loadedSrc = null`,
 * which paints `data-loaded="false"` — the infinite shimmer sweep — and then
 * runs the 260ms opacity fade back in. One keystroke in the Arc composer calls
 * `setMsg`, so all fifteen tiles ran a full skeleton→fade cycle per character.
 *
 * The hazard was already known here: `Section` carries a comment saying exactly
 * this, added when the copy inputs were dropping focus mid-word. `Tile` was the
 * instance that never got the same treatment, and a comment is not a guard.
 *
 * PascalCase is the signal — a capitalised binding at the component's own indent
 * is a component by React's own convention, and it is the shape that regresses.
 */
describe("StudioView declares no components in its render body", () => {
  const view = readFileSync(join(__dirname, "_components", "studio-view.tsx"), "utf8");

  it("hoists every child component to module scope", () => {
    const body = view.match(/export function StudioView\([\s\S]*$/)?.[0] ?? "";
    expect(body).not.toBe("");
    // Two-space indent = StudioView's own body, not a nested callback.
    const declared = [...body.matchAll(/^ {2}(?:const|let|function)\s+([A-Z]\w*)/gm)].map((m) => m[1]);
    expect(declared).toEqual([]);
  });

  it("keeps the rail tile memoised, so typing does not re-render fifteen images", () => {
    expect(view).toMatch(/const Tile = memo\(function Tile\(/);
    // A fresh inline arrow here would defeat the memo on every render.
    expect(view).toMatch(/const pickTile = useCallback\(/);
    expect(view).toMatch(/onPick=\{pickTile\}/);
  });

  it("keys the tiles by asset, not by index", () => {
    // The four source tabs render different lists into the same slots; an index
    // key made React reuse tile 0's <img> across a tab switch and swap its src.
    expect(view).toMatch(/key=\{it\.id \?\? it\.url \?\?/);
  });
});

/**
 * Every control on Studio is a real control — not just the Design pane's.
 *
 * A runtime hit-test of the live page (2026-08-06) found 21 elements carrying an
 * `onClick` that were `<span>`/`<div>`: all four Sources tabs, the dropzone, the
 * four media tiles, the Image/Video toggle, the four format chips, "Keep text
 * clear of edges" and the five version thumbs. Every one sat at `tabIndex = -1`
 * with no role and no pressed state — unreachable by keyboard, announced as
 * nothing, and invisible to a screen reader as anything actionable.
 *
 * This is the same defect #1017 fixed for the swatches, template tiles and
 * `.exrow`s. That pass stopped at the Design pane boundary and left the stage
 * toolbar and the Sources rail untouched, which is exactly how a fixed bug class
 * survives: the fix was scoped to where it was noticed, not to where it applied.
 *
 * `aria-pressed` rather than a tablist, matching what #1017 established as this
 * repo's convention for a mutually exclusive selection.
 */
describe("no clickable non-buttons anywhere in Studio", () => {
  const view = readFileSync(join(__dirname, "_components", "studio-view.tsx"), "utf8");
  /**
   * Comments stripped, like the CSS above. These assertions search for a code
   * SHAPE, and the comments here describe the very shapes being banned — the
   * first run of this guard failed on its own prose explaining what it replaced.
   */
  const code = view.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

  it("has no onClick on a span or div", () => {
    // The shape that regressed: reaching for a <span> because it is shorter.
    const offenders = [...code.matchAll(/<(span|div)\b[^>]*\sonClick=/g)].map((m) => m[0].slice(0, 70));
    expect(offenders).toEqual([]);
  });

  it("has no hand-rolled button — role+tabIndex+keyDown is a <button> spelled long", () => {
    // Four of these existed: "Reset layout", the live version thumb, the video
    // generate row, and both layer rows. Each reimplemented Enter/Space by hand,
    // which a real <button> gets from the UA for free.
    expect(code).not.toMatch(/role="button"[\s\S]{0,120}tabIndex=\{0\}/);
    expect(code).not.toMatch(/onKeyDown=\{\(e\) => \{ if \(e\.key === "Enter" \|\| e\.key === " "\)/);
  });

  /**
   * The eye toggle sat INSIDE the layer row's own `role="button"`. A button
   * inside a button is invalid: the inner control is not reliably reachable, and
   * the outer one's accessible name swallows the inner one's.
   */
  it("puts the layer's two actions side by side, not one inside the other", () => {
    const row = code.match(/const LayerRow = memo\([\s\S]*?\n\}\);/)?.[0] ?? "";
    expect(row).not.toBe("");
    expect(row).toMatch(/className="layerpick"/);
    expect(row).toMatch(/className="eye"/);
    // Two buttons that both close before the next opens — siblings, not nested.
    expect(row.match(/<button/g) ?? []).toHaveLength(2);
    expect(row).toMatch(/<\/button>[\s\S]*<button/);
  });

  it.each([
    ["stab", "srcTab === s"],
    ["fchip", "fmt === i"],
    ["mtile", "selected"],
    ["vthumb", "selSession === v.id"],
  ])("reports which %s is chosen", (cls, state) => {
    const re = new RegExp(`className=\\{\`${cls}\\$\\{[^\`]*\`\\}[^>]*aria-pressed=\\{${state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`);
    expect(view).toMatch(re);
  });

  it("keeps every converted control looking like it did", () => {
    // A <button> inherits none of the page's type and brings its own chrome, so
    // each rule that used to style a span has to reset the UA defaults. Missing
    // `font-family: inherit` is the one that shows — the control silently drops
    // to the browser's system font.
    for (const sel of [".stab", ".drop", ".mtile", ".fchip", ".szbtn", ".vthumb", ".modeseg button"]) {
      expect(rule(sel), sel).toMatch(/font-family:\s*inherit|color:\s*inherit/);
      expect(rule(sel), sel).toMatch(/cursor:\s*pointer/);
    }
  });

  it("gives every converted control a visible focus ring", () => {
    for (const sel of [".stab", ".drop", ".mtile", ".fchip", ".szbtn", ".vthumb", ".modeseg button"]) {
      expect(CSS, sel).toMatch(
        new RegExp(`\\.arc-studio ${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:focus-visible\\s*\\{[^}]*outline:`),
      );
    }
  });

  /**
   * `.mtile .mt > svg` matched NOTHING. The demo art is wrapped in Raw's
   * positioned <span>, so the child combinator never applied and the sample
   * tiles' SVG sized off its own intrinsic box, overflowing the 70px media well
   * and pushing the caption out of the tile's `overflow: hidden`. Two of the
   * four tiles rendered with no visible label. Same class as #1019 — a rule
   * written against a DOM shape the component does not produce.
   */
  it("reaches the tile and thumb art through a descendant, not a child, combinator", () => {
    expect(CSS).not.toMatch(/\.mtile \.mt > svg/);
    expect(CSS).not.toMatch(/\.vthumb > svg/);
    expect(CSS).toMatch(/\.arc-studio \.mtile \.mt svg\s*\{/);
    expect(CSS).toMatch(/\.arc-studio \.vthumb svg/);
  });

  /** A <button> is display:inline-block; the tile and dropzone were block boxes. */
  it("keeps the block-level controls block-level", () => {
    for (const sel of [".mtile", ".drop"]) {
      expect(rule(sel), sel).toMatch(/display:\s*block/);
      expect(rule(sel), sel).toMatch(/width:\s*100%/);
    }
    // The tile's children were <div>s and are now <span>s inside the button.
    expect(rule(".mtile .mt")).toMatch(/display:\s*block/);
    expect(rule(".mtile .ml")).toMatch(/display:\s*block/);
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

/**
 * The logo note annotates an answer; it does not pre-empt one.
 *
 * Reported as "what is this? It appears before Arc even has a moment to respond."
 * It was computed from the OPERATOR's message alone and rendered below the
 * pending bubble, so it argued with a request while Arc was still working on it.
 * The trigger was a bare word list including `text`, `words` and `caption`, so
 * editing the canvas copy summoned a warning about logos in generated images.
 */
describe("logo hint", () => {
  const view = readFileSync(join(__dirname, "_components", "studio-view.tsx"), "utf8");

  it("waits for Arc to have replied", () => {
    const hint = view.match(/const logoHint = useMemo\([\s\S]*?\}, \[[^\]]*\]\);/)?.[0] ?? "";
    expect(hint).toMatch(/if \(!replied\) return false;/);
    expect(hint).toMatch(/\[thread, replied\]/);
  });

  it("no longer fires on any mention of text or a caption", () => {
    expect(view).not.toMatch(/BAKED_TEXT_RE/);
    expect(view).toMatch(/wantsBrandingInScene/);
  });

  it("folds, so it cannot outshout the reply it annotates", () => {
    expect(view).toMatch(/<details className="arcnote"/);
  });
});

/**
 * Free logo placement.
 *
 * The templates pinned the mark — bold to a corner, editorial and minimal into a
 * flowed foot row — and the app explained that as a rule: your logo "can't" go
 * on the van panel. It never was one. The real constraint is that the MODEL must
 * not draw your mark, which is why NO_TEXT_DIRECTIVE stays; compositing your own
 * real file onto a surface is a different act entirely.
 *
 * Every logo mount in BOTH renderers must carry the transform, or the preview
 * and the export disagree about where the logo is — the BSR-679 class of bug,
 * and the one an operator cannot see until the PNG comes back.
 */
describe("logo placement", () => {
  const canvas = readFileSync(join(__dirname, "_components", "studio-canvas.tsx"), "utf8");

  it("arms the logo for dragging, like the copy block", () => {
    expect(canvas).toMatch(/const logoArmed = selected === "Logo"/);
    expect(canvas).toMatch(/"logo-move"/);
    expect(canvas).toMatch(/"logo-scale"/);
    expect(canvas).toMatch(/"logo-rotate"/);
  });

  it("gives every logo mount the drag props — a missed one is a dead layer", () => {
    // Three mounts: bold's positioned lockup and the two flowed foot rows. One
    // was missed on the first pass and selected without arming.
    const mounts = canvas.match(/aria-label="Logo"/g) ?? [];
    const wired = canvas.match(/\{\.\.\.logoDragProps\}/g) ?? [];
    expect(mounts.length).toBeGreaterThan(0);
    expect(wired).toHaveLength(mounts.length);
  });

  it("applies the transform in every template, fallback mark included", () => {
    for (const file of ["bold", "editorial", "minimal"]) {
      const t = readFileSync(join(__dirname, "..", "..", "..", "lib", "media", "compose", "templates", `${file}.tsx`), "utf8");
      // destructure + real logo + fallback mark
      expect((t.match(/logoStyle/g) ?? []).length, file).toBeGreaterThanOrEqual(3);
    }
  });
});

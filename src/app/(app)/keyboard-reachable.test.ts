import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every control can be reached from a keyboard (BSR-664).
 *
 * The audit reported "346 of 396 buttons lack an aria-label". That number was a
 * crude grep and it overstated the problem badly: almost all of those buttons
 * carry visible text, which is a perfectly good accessible name. Only three were
 * genuinely icon-only and unlabelled.
 *
 * The real defect was next door, and worse. Fifty-two click handlers sit on
 * `<span>` and `<div>` elements with no `role` and no `tabIndex` — so they are
 * not tabbable, do not respond to Enter or Space, and are announced as text
 * rather than as controls. A keyboard-only user cannot operate them at all. The
 * Library's grid/list view toggles were two of them.
 *
 * ## Why this is a ratchet and not a clean assertion
 *
 * Fifty-two of these live mostly in `library-view.tsx` (23) and
 * `studio-view.tsx` (18) — the two most complex screens in the app. Converting
 * them wholesale to `<button>` means every one needs its UA styles reset and its
 * layout re-checked, and I could not visually verify that many controls to a
 * standard worth trusting. Doing it badly would trade an accessibility bug for a
 * visual one.
 *
 * So the count is pinned per file. New violations fail immediately; fixing some
 * requires lowering the baseline, which is the nudge. A ratchet is an admission
 * that the work is unfinished — it just refuses to let it get worse meanwhile.
 */

const APP_DIR = new URL(".", import.meta.url).pathname;

/**
 * Known-unfixed counts. **Lower these as they are fixed; never raise them.**
 * A file absent from this map must have zero.
 */
const BASELINE: Record<string, number> = {
  // Was 19, then 10, now 2. The folder rail moved to folder-tree.tsx and became
  // a real ARIA tree on the way, taking nine with it; the 2026-08-06 sweep took
  // the remaining eight — the collection and kind filters, the Arc-suggestion
  // Dismiss, the bulk "Make available to Arc" and its campaign picker (whose
  // options were `<span role="menuitem">`, a role claiming what nothing could
  // focus), Clear, the detail panel's close, and the Available-to-Arc switch.
  //
  // The 2 that remain are the grid card's `<div onClick>` and the list row's
  // `<tr onClick>`, honest for the same reason as crm-board below: both are
  // redundant convenience targets over a real `<button aria-label="Open …">`,
  // so a keyboard user loses nothing. That was NOT true when this baseline was
  // written — the grid's overlay is `opacity: 0` and revealed on `:hover` only,
  // so its four controls sat in the tab order while being invisible to whoever
  // was tabbing through them. `:focus-within` now reveals it, which is what
  // makes leaving these two honest rather than convenient.
  "library/_components/library-view.tsx": 2,
  // The rail's disclosure chevron, and honest at 1 for the same reason as
  // crm-board below: it is a redundant convenience target. Expanding and
  // collapsing is already on the row itself as ArrowRight/ArrowLeft, which is
  // what the ARIA tree pattern specifies — and a nested <button> inside a
  // `treeitem` is the thing that pattern tells you not to do, so "fixing" the
  // count here would make the component worse for the people it is counted on
  // behalf of.
  "library/_components/folder-tree.tsx": 1,
  // studio-view.tsx was 18 and is now ZERO — entry removed, per the rule above.
  //
  // This is the entry the doc-comment's "I could not visually verify that many
  // controls to a standard worth trusting" was written about. A runtime hit-test
  // of the live page (2026-08-06) enumerated them: the four Sources tabs, the
  // dropzone, the media tiles, the Image/Video toggle, the four format chips,
  // "Keep text clear of edges", the version thumbs, both layer rows and the
  // video generate row. All are real <button>s now, each rule that styled a span
  // reset for the UA button defaults, and the page re-hit-tested to zero dead
  // controls, zero nested buttons and zero unnamed buttons in three states
  // (image+Design, image+Arc, video). See studio-inspector-layout.test.ts, which
  // guards the shape so it cannot come back.
  // record-view.tsx (was 2), campaign-detail-view.tsx (was 1) and brand-view.tsx
  // (was 1) are GONE from this map — all three are zero. Each was the same
  // thing: a tab strip, or a palette swatch, built from clickable divs. The tab
  // strips are `role="tablist"` with real `role="tab"` buttons now; the swatch
  // is a button with `aria-pressed`. A record's tabs, a campaign's sections and
  // the brand palette could not be operated from a keyboard at all before.
  // Was 2, now 1. "Clear" became a <button>, and the record name became a real
  // <Link> — previously the row's <tr onClick> was the ONLY way to open a
  // record, so it was unreachable by keyboard, unannounced as a link, and
  // impossible to cmd-click into a new tab.
  //
  // The <tr onClick> itself remains and still counts here, correctly: this
  // check cannot tell that it is now a redundant convenience target sitting
  // over a real link. Removing it would cost mouse users the whole-row click
  // they expect, and adding a role= to quieten the count would be marking the
  // problem instead of fixing it. One is the honest number.
  "crm/_components/crm-board.tsx": 1,
  // Not a control at all, and deliberately left alone: the dialog card's only
  // handler is `stopPropagation`, there to stop a click INSIDE the dialog from
  // reaching the backdrop that dismisses it. There is nothing here to press, so
  // making it a button — or giving it a role to quieten the count — would invent
  // a control rather than fix one. The check cannot tell this apart from a real
  // click target; 1 is the honest number.
  "_components/share-dialog.tsx": 1,
  // The review queue's backdrop `<div onClick>`, which dismisses the dialog.
  //
  // Honest at 1, and deliberately not "fixed". Escape already does exactly what
  // clicking the backdrop does, by the same rule — back out of the revision box
  // first, close the queue only once there is nothing half-written to lose — so
  // a keyboard user loses nothing here; they have the better affordance of the
  // two. Making the backdrop focusable would put a full-viewport tab stop
  // inside a dialog, and giving it a role= would mark the problem rather than
  // fix it. The backdrop only became clickable when the queue stopped being a
  // full-screen takeover: there was no backdrop to click before.
  "campaigns/[campaignId]/_components/review-queue.tsx": 1,
  // The card's `<article onClick>`, and honest at 1 for the same reason as
  // crm-board above: it is a redundant convenience target over real controls —
  // the name is a <Link> and the disclosure is a <button> — so keyboard users
  // lose nothing, but the check cannot see that, and quietening it with a
  // role= would mark the problem instead of fixing it.
  "campaigns/_components/campaigns-board.tsx": 1,
};

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (full.endsWith(".tsx") && !full.includes(".test.")) out.push(full);
  }
  return out;
}

/**
 * `<span onClick=…>` with neither `role` nor `tabIndex` — a control nobody can
 * tab to.
 *
 * `article` is on this list because the campaigns board grew a card with
 * `<article onClick>` and this check reported the file CLEAN — the element was
 * simply not in the list, so a real instance of the pattern read as zero. A
 * blind spot in a ratchet is worse than a high number in it: the number at least
 * tells the truth.
 */
function unreachableCount(source: string): number {
  let n = 0;
  for (const m of source.matchAll(/<(span|div|li|td|tr|article|section)\b/g)) {
    const attrs = openingTagAttrs(source, m.index + m[0].length);
    if (!/onClick=/.test(attrs)) continue;
    if (/role=|tabIndex=/.test(attrs)) continue;
    n += 1;
  }
  return n;
}

/**
 * The opening tag's attribute text, from `start` to the `>` that actually ends
 * the tag.
 *
 * Not a regex. `[^>]*?` stops at the first `>` in the source, and `onClick={(e)
 * =>` contains one — so a handler written as an arrow function hid every
 * attribute after it, and a multi-line `<article onClick={(e) => {…}}>` counted
 * as ZERO. Braces are tracked so a `>` inside an expression does not end the
 * tag.
 */
function openingTagAttrs(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === ">" && depth === 0) return source.slice(start, i);
  }
  return source.slice(start);
}

describe("controls are reachable from a keyboard", () => {
  const counts = new Map<string, number>();
  for (const file of tsxFiles(APP_DIR)) {
    const n = unreachableCount(readFileSync(file, "utf8"));
    if (n > 0) counts.set(file.replace(APP_DIR, ""), n);
  }

  it("adds no new keyboard-unreachable controls", () => {
    const added: string[] = [];
    for (const [file, n] of counts) {
      const allowed = BASELINE[file] ?? 0;
      if (n > allowed) added.push(`${file}: ${n} (baseline ${allowed})`);
    }
    expect(added).toEqual([]);
  });

  it("keeps the baseline honest — drop entries once a file is clean", () => {
    const stale = Object.keys(BASELINE).filter((f) => !counts.has(f));
    expect(stale, "these files are fixed; remove them from BASELINE").toEqual([]);
  });

  /**
   * `openingTagAttrs`, not `<button\b([^>]*)>`.
   *
   * The naive form has the identical bug this file already documents for
   * `unreachableCount`: `[^>]*` stops at the first `>` in the source, and
   * `onClick={(e) =>` contains one. So for any icon-only button with an arrow
   * handler, `attrs` was truncated at the arrow — an `aria-label` written after
   * `onClick` could not be seen — and `body` swallowed the rest of the handler,
   * whose `openDetail(a)` matched the `.\w+` "renders text" heuristic and marked
   * the button as having a visible label. Every such button was exempt.
   *
   * It was fixed for the other check and left here, which is how a fix scoped to
   * where a bug was noticed leaves the same bug standing one function away.
   */
  it("labels every icon-only button", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(APP_DIR)) {
      const src = readFileSync(file, "utf8");
      for (const open of src.matchAll(/<button\b/g)) {
        const attrs = openingTagAttrs(src, open.index + open[0].length);
        const bodyStart = open.index + open[0].length + attrs.length + 1;
        const close = src.indexOf("</button>", bodyStart);
        if (close === -1) continue;
        const body = src.slice(bodyStart, close);
        const m = { index: open.index };
        const withoutTags = body.replace(/<[^>]*>/g, "");
        // `{cond ? "A" : "B"}` renders text; `{x.title}` might too; and so does a
        // bare `{firstName}` / `{brand}` / `{sortLabel}` — which this missed,
        // reporting three properly-labelled buttons as icon-only. Requiring a
        // quote or a `.property` assumed labels are never plain locals.
        //
        // The trade-off is deliberate: a button whose only child is an icon held
        // in a variable now reads as labelled. That direction is the safe one —
        // a false positive here pushes someone to add an `aria-label` duplicating
        // text the button already shows, which breaks WCAG's label-in-name rule
        // to satisfy a checker.
        const expressionText = [...withoutTags.matchAll(/\{([^}]*)\}/g)]
          .map(([, expr]) => (/["'`][^"'`]+["'`]|\.\w+|^\s*\w+\s*$/.test(expr) ? "text" : ""))
          .join("");
        const text = (withoutTags.replace(/\{[^}]*\}/g, "") + expressionText).replace(/\s+/g, " ").trim();
        // `<Ico`/`<Icon` as well as a literal `<svg`: the Library grid's three
        // quick actions per card render through `<Ico>`, so this check reported
        // them clean while all three were icon-only with nothing but a `title`.
        // A screen-reader user tabbing that grid heard "Open, Open, Open…" with
        // no way to tell which asset they were on. A blind spot in a checker
        // reads as a pass, which is worse than a number that admits the problem.
        const iconOnly = text.length === 0 && /<svg|size=\{|<Ico\b|<Icon\b/.test(body);
        if (iconOnly && !/aria-label=/.test(attrs)) {
          offenders.push(`${file.replace(APP_DIR, "")}:${src.slice(0, m.index).split("\n").length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

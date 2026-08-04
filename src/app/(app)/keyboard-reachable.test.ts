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
  "library/_components/library-view.tsx": 19,
  "studio/_components/studio-view.tsx": 18,
  "crm/[objectKey]/[recordId]/_components/record-view.tsx": 2,
  "crm/_components/crm-board.tsx": 2,
  "_components/share-dialog.tsx": 1,
  "brand/_components/brand-view.tsx": 1,
  "campaigns/[campaignId]/_components/campaign-detail-view.tsx": 1,
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

/** `<span onClick=…>` with neither `role` nor `tabIndex` — a control nobody can tab to. */
function unreachableCount(source: string): number {
  let n = 0;
  for (const m of source.matchAll(/<(span|div|li|td|tr)\b([^>]*?)>/g)) {
    const attrs = m[2];
    if (!/onClick=/.test(attrs)) continue;
    if (/role=|tabIndex=/.test(attrs)) continue;
    n += 1;
  }
  return n;
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

  it("labels every icon-only button", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(APP_DIR)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/<button\b([^>]*)>([\s\S]{0,400}?)<\/button>/g)) {
        const [, attrs, body] = m;
        const withoutTags = body.replace(/<[^>]*>/g, "");
        // `{cond ? "A" : "B"}` renders text; `{x.title}` might too, so both count.
        const expressionText = [...withoutTags.matchAll(/\{([^}]*)\}/g)]
          .map(([, expr]) => (/["'`][^"'`]+["'`]|\.\w+/.test(expr) ? "text" : ""))
          .join("");
        const text = (withoutTags.replace(/\{[^}]*\}/g, "") + expressionText).replace(/\s+/g, " ").trim();
        const iconOnly = text.length === 0 && /<svg|size=\{/.test(body);
        if (iconOnly && !/aria-label=/.test(attrs)) {
          offenders.push(`${file.replace(APP_DIR, "")}:${src.slice(0, m.index).split("\n").length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

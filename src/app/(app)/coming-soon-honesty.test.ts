import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Unbuilt controls must not look built (BSR-688).
 *
 * `data-soon` marks a control that isn't wired yet; a delegated listener in
 * `ComingSoonToasts` turns a click into a quiet explanation instead of silence.
 * The mechanism is fine. Two things went wrong around it:
 *
 *   1. It shipped with no stylesheet. The toast wrapper defaulted to
 *      `position: static` and appended itself after `.app`, so on /brand at
 *      1440x900 it rendered at y=900 — below the fold — 1450px tall, growing the
 *      document to 2350px. Clicking a "coming soon" control showed nothing and
 *      silently added a screenful of blank space: precisely the "reads as
 *      broken" outcome the toast was built to prevent.
 *
 *   2. Marked controls rendered at full fidelity, including one gold primary.
 *      An operator has no way to tell a real button from a placeholder until
 *      they click it, which is a small tax on trusting every other control.
 *
 * This file is a ratchet, like `keyboard-reachable.test.ts`. New marks fail
 * immediately; removing one means lowering its count, which is the nudge.
 */

const APP_DIR = new URL(".", import.meta.url).pathname;
const ARC_APP_CSS = readFileSync(join(APP_DIR, "arc-app.css"), "utf8");

/**
 * Known-unbuilt controls, per file. **Lower these as they ship; never raise.**
 * A file absent from this map must have zero.
 *
 * Each remaining one was checked against the code, not assumed — the same
 * question `brand-honesty.test.ts` asks: is the label true, or is the
 * capability already wired and the label lying? All of these are true today.
 */
const BASELINE: Record<string, number> = {
  // Audience rows — no audience model behind them.
  "studio/_components/studio-view.tsx": 1,
  // No palette or typography editor exists; `brand-honesty.test.ts` pins that
  // these two must KEEP saying so, and fails if a write path appears.
  "brand/_components/brand-view.tsx": 2,
  // No column-visibility or density state in the board; no enrichment write path.
  "crm/_components/crm-board.tsx": 3,
  // No template model anywhere in campaigns (`industry-templates` is personas).
  "campaigns/_components/campaigns-board.tsx": 1,
  // Iteration drafting exists via next_iteration opportunities, but this button
  // is not wired to it. Honest today; wiring it is the better fix when someone
  // decides where it should land.
  "analytics/_components/analytics-view.tsx": 1,
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
 * Two different things share this attribute, and only one of them is a defect.
 *
 *   data-soon="…"            a PERMANENT claim: this capability does not exist.
 *   data-soon={`…`}          same, with interpolation.
 *   {...(cond ? { "data-soon": … } : {})}
 *                            a CONDITIONAL claim: the capability exists, but a
 *                            precondition is not met right now.
 *
 * Studio is full of the second kind — "Connect a backend to import art",
 * "Select an approved photo or video to download its file", and the media/video
 * generation gates. Those are correct: the control works the moment the
 * condition clears, and the attribute is only present while it cannot act. The
 * CSS mutes them then, which is exactly right.
 *
 * So this counts JSX attribute syntax (`data-soon=`) and deliberately not the
 * object-property form (`"data-soon":`). The distinction falls out of the syntax
 * rather than needing a convention, which is why it is worth relying on — do not
 * "fix" this regex to catch the spread form.
 */
function soonMarks(source: string): string[] {
  return [...source.matchAll(/data-soon=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2] ?? "");
}

/** The conditional form, which this ratchet intentionally permits. */
function gatedMarks(source: string): number {
  return [...source.matchAll(/"data-soon":/g)].length;
}

describe("unbuilt controls are marked, and marked controls look unbuilt", () => {
  const counts = new Map<string, number>();
  for (const file of tsxFiles(APP_DIR)) {
    const n = soonMarks(readFileSync(file, "utf8")).length;
    if (n > 0) counts.set(file.replace(APP_DIR, ""), n);
  }

  it("adds no new coming-soon controls", () => {
    const added: string[] = [];
    for (const [file, n] of counts) {
      const allowed = BASELINE[file] ?? 0;
      if (n > allowed) added.push(`${file}: ${n} (baseline ${allowed})`);
    }
    expect(added, "wire it, or ship it disabled — do not add a placeholder that looks live").toEqual([]);
  });

  it("keeps the baseline honest — drop entries once a file is clean", () => {
    const stale = Object.keys(BASELINE).filter((f) => !counts.has(f));
    expect(stale, "these files have no marks left; remove them from BASELINE").toEqual([]);
  });

  it("styles the toast so it is actually visible", () => {
    // The bug was not a missing rule, it was NO rule: `position: static` put the
    // toast below the fold and stretched the page. Assert the two properties
    // that make it a toast at all.
    const wrapper = ARC_APP_CSS.slice(ARC_APP_CSS.indexOf(".arc-app .soon-toasts"));
    expect(wrapper).toMatch(/position:\s*fixed/);
    expect(wrapper.slice(0, 400)).toMatch(/z-index:\s*\d+/);
  });

  it("mutes a marked control so it does not read as a working one", () => {
    expect(ARC_APP_CSS).toMatch(/\.arc-app \[data-soon\]\[data-soon\]\s*\{[^}]*opacity/);
  });

  it("never lets an unbuilt control wear the gold primary", () => {
    // One accent per screen (DESIGN.md §4). A placeholder holding it is the
    // strongest possible "this is the thing to click".
    expect(ARC_APP_CSS).toMatch(/\[data-soon\]\.gold/);
    for (const [file] of counts) {
      const source = readFileSync(join(APP_DIR, file), "utf8");
      for (const tag of source.matchAll(/<[a-zA-Z][^>]*data-soon[^>]*>/g)) {
        // The CSS neutralises it, but flagging it at source keeps the intent
        // obvious to whoever writes the next one.
        if (/className="[^"]*\bgold\b/.test(tag[0])) {
          expect(ARC_APP_CSS, `${file} marks a gold control; the neutralising rule must exist`).toMatch(
            /\[data-soon\]\.gbtn\.gold/,
          );
        }
      }
    }
  });

  it("still permits the conditional form, which says why a real control cannot act now", () => {
    // Guard the premise: if Studio's gates disappeared, the distinction above is
    // no longer being exercised and this file is quietly asserting less.
    const studio = readFileSync(join(APP_DIR, "studio/_components/studio-view.tsx"), "utf8");
    expect(gatedMarks(studio)).toBeGreaterThan(0);
  });

  it("does not use the coming-soon mark for something that is merely inapplicable", () => {
    // "Add contacts to a campaign from the People tab" was a data-soon, so bulk
    // -selecting a COMPANY popped a clock icon claiming a shipped feature was
    // unbuilt. Different message, different mechanism.

    const allMessages = [...counts.keys()].flatMap((f) => soonMarks(readFileSync(join(APP_DIR, f), "utf8")));
    for (const message of allMessages) {
      expect(message.toLowerCase(), `"${message}" describes availability, not a missing feature`).not.toMatch(
        /\bfrom the .* tab\b/,
      );
    }
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * One KPI strip, app-wide (BSR-658).
 *
 * There were seven — `.metrics`, `.okpis`, `.kpis`, `.asum`, `.pstats`,
 * `.bstats`, `.jr-kpis` — six of them an equal `repeat(N, 1fr)` row that
 * DESIGN.md §5 and the Calm Principles both ban in bold, plus a shared component
 * built for the job that only CRM used. They drifted apart cell by cell: Outbox
 * put the value above the label, Analytics carried a "prev" line nobody else
 * had, CRM's middle cell had neither the delta nor the sparkline of its
 * neighbours.
 *
 * The failure mode is not that someone edits `KpiStrip` — it is that the next
 * screen quietly hand-rolls number eight.
 */

const APP_DIR = new URL(".", import.meta.url).pathname;
/**
 * EVERY stylesheet under (app), not just arc-app.css.
 *
 * The original scan read one file, and KPI grids numbered eight through eleven
 * duly appeared in the per-route sheets it never opened: `.ukpis` in
 * settings.css, `.egrid` and `.scards` in record.css, `.perfkpis` in
 * campaign.css. "The next screen quietly hand-rolls number eight" is this
 * file's own stated failure mode, and it happened in the blind spot.
 */
function allAppCss(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) allAppCss(full, out);
    else if (full.endsWith(".css")) out.push(full);
  }
  return out;
}
const CSS = allAppCss(new URL(".", import.meta.url).pathname)
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("the KPI strip is the only KPI strip", () => {
  it("has no equal-column KPI grid left in the stylesheet", () => {
    // Scoped to the KPI grids by name — plenty of other layouts legitimately use
    // repeat(), and this test is about the strip, not about banning grid.
    // `.ukpis` and `.egrid` join the list: both were equal 3-column rows in
    // per-route sheets and both now route through KpiStrip.
    //
    // `.perfkpis` is here now, and the reason it was held back was WRONG. This
    // comment used to say it "has never rendered for anyone". It renders — the
    // six restoration demo campaigns each carry a full seeded result set, and
    // the panel was screenshotted with real numbers in it before converting.
    // What was true is narrower and worth keeping: `demoCampaigns()` serves the
    // restoration set only under `ARC_DEMO_INDUSTRY=restoration`, and no launch
    // config sets it, so the DEFAULT preview shows the generic campaigns — none
    // of which the performance seeds cover. "I could not see it" got recorded as
    // "it does not render", which is how a reachable surface goes unconverted.
    //
    // `.scards` is not here either, for a different reason: it carries a
    // progress bar and caption the shared strip has no slot for, so it stays
    // its own component. Its equal-column grid was the real defect and that is
    // fixed — one score no longer leaves two dead columns.
    const dead = ["\\.okpis", "\\.kpis", "\\.asum", "\\.pstats", "\\.bstats", "\\.jr-kpis", "\\.perfgrid", "\\.metrics", "\\.ukpis", "\\.egrid", "\\.perfkpis"];
    const offenders: string[] = [];
    for (const name of dead) {
      const re = new RegExp(`^[^\\n]*${name}[^\\n]*(?:display:\\s*grid|grid-template-columns)[^\\n]*$`, "gm");
      for (const m of CSS.matchAll(re)) {
        // The shared strip legitimately sets grid-template-columns on itself.
        if (!m[0].includes("kpistrip")) offenders.push(m[0].trim().slice(0, 90));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("routes every screen's KPI row through the shared component", () => {
    const handRolled: string[] = [];
    for (const file of tsxFiles(APP_DIR)) {
      if (file.endsWith("kpi-strip.tsx")) continue;
      const src = readFileSync(file, "utf8");
      // The old wrapper class names may survive as spacing hooks, but only ever
      // on a <KpiStrip className=…>, never on a hand-built <div>.
      for (const m of src.matchAll(/<div className="(okpis|kpis|asum|pstats|bstats|jr-kpis|perfgrid|metrics|perfkpis)"/g)) {
        handRolled.push(`${file.replace(APP_DIR, "")}: <div className="${m[1]}">`);
      }
    }
    expect(handRolled).toEqual([]);
  });

  it("keeps the layout asymmetric, which is the whole point of the rule", () => {
    // An equal row says every number matters the same, which is never true.
    //
    // Two through five are one row, so columns == cells. Six is the exception
    // and wraps to 3×2 — six 23px serif values in a row would be the squeeze
    // this rule exists to prevent, so the cells-per-column count is what is
    // pinned instead. Every count still has to lead with a wider first column.
    const COLUMNS: Record<number, number> = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 3 };
    for (const [count, expected] of Object.entries(COLUMNS)) {
      const rule = new RegExp(`\\.kpistrip\\[data-count="${count}"\\] \\{ grid-template-columns: ([^;]+);`);
      const match = CSS.match(rule);
      expect(match, `no rule for ${count} cells`).toBeTruthy();
      const cols = match![1].trim().split(/\s+/);
      expect(cols, `${count} cells should lay out over ${expected} columns`).toHaveLength(expected);
      expect(cols[0]).not.toBe(cols[1]); // the lead metric is wider
      expect(Number(count) % expected, `${count} cells must fill ${expected} columns evenly`).toBe(0);
    }
  });

  /**
   * The component and the stylesheet have to agree on the ceiling. `data-count`
   * is clamped in the TSX, and a clamp higher than the last CSS rule renders a
   * strip with more children than columns — a ragged final row with the grid
   * background showing through, which is exactly what six cells did before the
   * `data-count="6"` rule existed.
   */
  it("clamps data-count to the highest count the stylesheet styles", () => {
    const component = readFileSync(join(APP_DIR, "_components/kpi-strip.tsx"), "utf8");
    const clamp = component.match(/data-count=\{Math\.min\(items\.length, (\d+)\)\}/);
    expect(clamp, "KpiStrip should clamp data-count").toBeTruthy();
    const styled = [...CSS.matchAll(/\.kpistrip\[data-count="(\d+)"\] \{ grid-template-columns:/g)].map((m) => Number(m[1]));
    expect(Number(clamp![1])).toBe(Math.max(...styled));
  });

  /**
   * The strip clips to its rounded corners, so it must never be allowed to be
   * SHORTER than its content — a clipped cell does not scroll, it just cuts the
   * number in half.
   *
   * On Relationships it did exactly that. `.arc-grid` is a column flex
   * container, `.kpistrip` was a flex item at the default `flex-shrink: 1`, and
   * a 105px strip was squeezed into 59px: "11", "8", "4" and "$82,200" all
   * rendered sliced through the middle, with every sublabel below them
   * ("6 need review", "2 won outcomes") clipped away entirely. It reads as a
   * styling choice rather than a bug, which is why it sat there.
   *
   * Outbox had already worked around it privately on `.okpis`. That local patch
   * is the tell: the shrink has to be off on the strip itself, or the next
   * column-flex screen rediscovers this the same way.
   */
  it("never lets a flex parent shrink the strip below its content", () => {
    const block = CSS.match(/\.arc-app \.kpistrip \{([\s\S]*?)\}/);
    expect(block, "the base .kpistrip rule should exist").toBeTruthy();
    expect(block![1]).toMatch(/overflow:\s*hidden/);
    expect(
      block![1],
      "`.kpistrip` clips its overflow, so it must set flex-shrink: 0 — otherwise a column-flex page cuts its numbers in half",
    ).toMatch(/flex-shrink:\s*0/);
  });
});

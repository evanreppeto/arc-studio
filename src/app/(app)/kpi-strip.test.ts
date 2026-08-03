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
const CSS = readFileSync(new URL("./arc-app.css", import.meta.url), "utf8");

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
    const dead = ["\\.okpis", "\\.kpis", "\\.asum", "\\.pstats", "\\.bstats", "\\.jr-kpis", "\\.perfgrid", "\\.metrics"];
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
      for (const m of src.matchAll(/<div className="(okpis|kpis|asum|pstats|bstats|jr-kpis|perfgrid|metrics)"/g)) {
        handRolled.push(`${file.replace(APP_DIR, "")}: <div className="${m[1]}">`);
      }
    }
    expect(handRolled).toEqual([]);
  });

  it("keeps the layout asymmetric, which is the whole point of the rule", () => {
    // An equal row says every number matters the same, which is never true.
    for (const count of [2, 3, 4, 5]) {
      const rule = new RegExp(`\\.kpistrip\\[data-count="${count}"\\] \\{ grid-template-columns: ([^;]+);`);
      const match = CSS.match(rule);
      expect(match, `no rule for ${count} cells`).toBeTruthy();
      const cols = match![1].trim().split(/\s+/);
      expect(cols).toHaveLength(count);
      expect(cols[0]).not.toBe(cols[1]); // the lead metric is wider
    }
  });
});

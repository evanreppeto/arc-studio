import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The phone layout for the two data tables (BSR-662).
 *
 * These are CSS contracts rather than rendering assertions, because the reflow
 * is deliberately CSS-only — grouping the meta cells with a wrapper element
 * would be a DOM change, and an unstyled wrapper added by the a11y pass is what
 * broke scrolling on every screen for two weeks. The rules below encode the two
 * mistakes that actually happened while building this, both of which were
 * invisible until someone looked at a phone.
 */

const CSS = readFileSync(new URL("./arc-app.css", import.meta.url), "utf8");
const CAMPAIGNS = readFileSync(new URL("./campaigns/_components/campaigns-board.tsx", import.meta.url), "utf8");
const CRM = readFileSync(new URL("./crm/_components/crm-board.tsx", import.meta.url), "utf8");

describe("phone reflow for the data tables", () => {
  /**
   * `.arc-campaigns` and `.arc-crm` are BOTH `.arc-grid`, so a rule written for
   * "the fifth column" hits both tables. On Campaigns the fifth column is
   * Channels; on CRM contacts it is STATUS. Scoping this to `.arc-grid` hid the
   * status column on every viewport ≤900px — the exact column this ticket is
   * about — and nothing caught it because the desktop view was fine.
   */
  it("never hides a column by position on the shared .arc-grid class", () => {
    const positional = [...CSS.matchAll(/^\s*\.arc-app \.arc-grid \.dt (?:td|th):nth-child\(\d+\)[^\n]*display:\s*none/gm)];
    expect(positional.map((m) => m[0].trim())).toEqual([]);
  });

  it("hides Channels on Campaigns only, and by its real position", () => {
    expect(CSS).toContain(".arc-app .arc-campaigns .dt td:nth-child(5)");
    // Position 5 must still BE Channels — reorder the header and this lies.
    const headers = [...CAMPAIGNS.matchAll(/<th>([^<]+)<\/th>/g)].map((m) => m[1].trim());
    expect(headers).toEqual(["Campaign", "Status", "Next action", "Audience", "Channels", "Updated"]);
  });

  /**
   * `.arc-grid` is a fixed-height flex column. Letting it scroll is not enough:
   * its children still shrink to fit, so the squeeze just moves to whichever
   * child was not pinned. It flattened the table to 7px (with all seven rows
   * rendered inside it), and once the table was pinned it flattened the KPI
   * strip to 2px — its two borders and nothing else.
   */
  it("stops the scrolling phone column from shrinking its children", () => {
    expect(CSS).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.arc-app \.arc-grid > \* \{ flex-shrink: 0; \}/);
  });

  it("keeps CRM's stable column positions, which the phone layout keys off", () => {
    // select first, primary second, actions last — true for all six objects.
    const rows = [...CRM.matchAll(/^\s{2}\w+: \[(\{ k: "sel".*)\],$/gm)].map((m) => m[1]);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const row of rows) {
      expect(row.startsWith('{ k: "sel" }')).toBe(true);
      expect(row.trimEnd().endsWith('{ k: "act" }')).toBe(true);
    }
  });
});

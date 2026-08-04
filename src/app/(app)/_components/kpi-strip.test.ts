import { describe, expect, it } from "vitest";

import { kpiStripTone, type KpiCell } from "./kpi-strip";

/**
 * BSR-738, following BSR-703's rule for the Studio spend strip: change VOLUME,
 * not visibility.
 *
 * The live workspace has 243 contacts and no closed revenue, so Home and CRM
 * both led with three big serif zeros under flat sparklines. Every number was
 * true; the treatment said "here are your headline metrics" about nothing.
 */

const cell = (label: string, value: string, points?: number[]): KpiCell => ({
  label,
  value,
  ...(points ? { spark: { points, up: false } } : {}),
});

describe("kpiStripTone", () => {
  it("is quiet for the exact strip the live workspace renders", () => {
    // Home: Won revenue / Booked jobs / Leads, all zero, 30 days of flat trend.
    const flat = [0, 0, 0, 0, 0];
    expect(
      kpiStripTone([
        cell("Won revenue", "$0", flat),
        cell("Booked jobs", "0", flat),
        cell("Leads", "0", flat),
      ]),
    ).toBe("quiet");
  });

  it("is quiet for CRM's strip, where the middle cell has no value at all", () => {
    expect(
      kpiStripTone([cell("Leads", "0"), cell("Lead → won", "—"), cell("Won revenue", "$0")]),
    ).toBe("quiet");
  });

  it("speaks up as soon as one number is real", () => {
    expect(
      kpiStripTone([cell("Won revenue", "$0"), cell("Booked jobs", "0"), cell("Leads", "12")]),
    ).toBe("full");
    expect(kpiStripTone([cell("Won revenue", "$18,400"), cell("Leads", "0")])).toBe("full");
  });

  it("speaks up when the numbers are zero TODAY but the period moved", () => {
    // Zero now with history behind it is a story — a drop — and drops are the
    // thing an operator most needs the loud treatment for.
    expect(kpiStripTone([cell("Leads", "0", [4, 7, 2, 0, 0])])).toBe("full");
  });

  it("reads through currency, separators and units", () => {
    expect(kpiStripTone([cell("Revenue", "$0.00"), cell("Rate", "0%")])).toBe("quiet");
    expect(kpiStripTone([cell("Revenue", "$1,240")])).toBe("full");
    expect(kpiStripTone([cell("Rate", "0.4%")])).toBe("full");
  });

  it("never goes quiet on an empty strip — that case renders nothing at all", () => {
    expect(kpiStripTone([])).toBe("full");
  });
});

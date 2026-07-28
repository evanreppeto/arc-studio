import { describe, expect, it } from "vitest";

import {
  CONNECTOR_COST_RATES,
  DEFAULT_SPEND_CAP_CENTS,
  MAX_WORKSPACE_SPEND_CAP_CENTS,
  clampSpendCapCents,
  computeSpendDecision,
  describeConnectorCost,
  estimateConnectorCostCents,
  formatCents,
  getConnectorCostRate,
  isMeteredTier,
  remainingBudgetCents,
  summarizeConnectorSpend,
  type ConnectorUsageEvent,
} from "@/domain";

describe("connector cost rates + disclosure", () => {
  it("prices a metered connector by its per-unit rate", () => {
    expect(estimateConnectorCostCents("permit-data", 10)).toBe(80); // 8c * 10
    expect(estimateConnectorCostCents("permit-data", 0)).toBe(0);
  });

  it("prices an unknown / unpriced connector at 0", () => {
    expect(estimateConnectorCostCents("weather-signals", 100)).toBe(0);
    expect(getConnectorCostRate("weather-signals")).toBeNull();
  });

  it("clamps negative / fractional units", () => {
    expect(estimateConnectorCostCents("permit-data", -5)).toBe(0);
    expect(estimateConnectorCostCents("permit-data", 2.9)).toBe(16); // floor(2.9)=2 → 16c
  });

  it("discloses cost up front as a per-batch string", () => {
    expect(describeConnectorCost("permit-data")).toBe("~$8.00 per 100 lookups");
    expect(describeConnectorCost("weather-signals")).toBeNull();
  });

  it("formatCents renders integer cents as USD", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(8000)).toBe("$80.00");
    expect(formatCents(1234)).toBe("$12.34");
  });

  it("every priced rate is well-formed", () => {
    for (const [key, rate] of Object.entries(CONNECTOR_COST_RATES)) {
      expect(rate.centsPerUnit).toBeGreaterThan(0);
      expect(rate.disclosureUnits).toBeGreaterThan(0);
      expect(rate.unitLabel.length).toBeGreaterThan(0);
      expect(getConnectorCostRate(key)).toEqual(rate);
    }
  });
});

describe("computeSpendDecision (the cap guard)", () => {
  it("allows a call that stays at or under the cap", () => {
    const d = computeSpendDecision({ spentCents: 1000, capCents: 5000, estimatedCostCents: 800 });
    expect(d.allow).toBe(true);
    expect(d.projectedCents).toBe(1800);
    expect(d.remainingCents).toBe(4000);
    expect(d.overByCents).toBe(0);
  });

  it("allows a call that lands exactly on the cap", () => {
    const d = computeSpendDecision({ spentCents: 4200, capCents: 5000, estimatedCostCents: 800 });
    expect(d.allow).toBe(true);
    expect(d.projectedCents).toBe(5000);
    expect(d.overByCents).toBe(0);
  });

  it("refuses a call that would tip over the cap, reporting the overage", () => {
    const d = computeSpendDecision({ spentCents: 4800, capCents: 5000, estimatedCostCents: 800 });
    expect(d.allow).toBe(false);
    expect(d.projectedCents).toBe(5600);
    expect(d.overByCents).toBe(600);
    expect(d.remainingCents).toBe(200);
  });

  it("refuses any priced call when the cap is 0 (no metered spend allowed)", () => {
    const d = computeSpendDecision({ spentCents: 0, capCents: 0, estimatedCostCents: 1 });
    expect(d.allow).toBe(false);
    expect(d.overByCents).toBe(1);
  });

  it("allows a free (0-cost) call even when already at the cap", () => {
    const d = computeSpendDecision({ spentCents: 5000, capCents: 5000, estimatedCostCents: 0 });
    expect(d.allow).toBe(true);
  });

  it("clamps negative inputs", () => {
    const d = computeSpendDecision({ spentCents: -100, capCents: -50, estimatedCostCents: -10 });
    expect(d.spentCents).toBe(0);
    expect(d.capCents).toBe(0);
    expect(d.estimatedCostCents).toBe(0);
    expect(d.allow).toBe(true); // 0 <= 0
  });

  it("remainingBudgetCents floors at 0", () => {
    expect(remainingBudgetCents(1000, 5000)).toBe(4000);
    expect(remainingBudgetCents(6000, 5000)).toBe(0);
  });
});

describe("summarizeConnectorSpend", () => {
  const events: ConnectorUsageEvent[] = [
    { connectorKey: "permit-data", units: 10, costCents: 80, occurredAt: "2026-07-01T00:00:00Z" },
    { connectorKey: "permit-data", units: 5, costCents: 40, occurredAt: "2026-07-02T00:00:00Z" },
    { connectorKey: "enrichment", units: 3, costCents: 300, occurredAt: "2026-07-03T00:00:00Z" },
  ];

  it("rolls up per-connector and headline totals", () => {
    const s = summarizeConnectorSpend(events, 5000);
    expect(s.totalCostCents).toBe(420);
    expect(s.totalUnits).toBe(18);
    expect(s.eventCount).toBe(3);
    expect(s.remainingCents).toBe(4580);
    expect(s.byConnector).toHaveLength(2);
    // highest spend first
    expect(s.byConnector[0].connectorKey).toBe("enrichment");
    expect(s.byConnector[0].costCents).toBe(300);
    const permit = s.byConnector.find((r) => r.connectorKey === "permit-data");
    expect(permit).toMatchObject({ costCents: 120, units: 15, count: 2 });
  });

  it("flags near-cap and over-cap", () => {
    expect(summarizeConnectorSpend([{ connectorKey: "x", units: 1, costCents: 4000, occurredAt: "t" }], 5000).isNearCap).toBe(true);
    const over = summarizeConnectorSpend([{ connectorKey: "x", units: 1, costCents: 5200, occurredAt: "t" }], 5000);
    expect(over.isOverCap).toBe(true);
    expect(over.pctOfCap).toBe(104);
    expect(over.remainingCents).toBe(0);
  });

  it("no cap => no percentages", () => {
    const s = summarizeConnectorSpend(events, 0);
    expect(s.pctOfCap).toBe(0);
    expect(s.isNearCap).toBe(false);
    expect(s.isOverCap).toBe(false);
  });
});

describe("isMeteredTier + defaults", () => {
  it("only the metered tier is governed", () => {
    expect(isMeteredTier("metered")).toBe(true);
    expect(isMeteredTier("free")).toBe(false);
    expect(isMeteredTier("byo_key")).toBe(false);
  });
  it("ships a sane default cap", () => {
    expect(DEFAULT_SPEND_CAP_CENTS).toBeGreaterThan(0);
  });
});

// BSR-515. The workspace spend cap is operator-settable and, until this ceiling
// existed, unbounded — a units mistake in the Settings field ("5000" meaning
// dollars) authorised five figures of real provider spend with nothing to catch
// it. The cap is the last thing between a runaway loop and our card.
describe("platform spend ceiling", () => {
  it("caps any proposed value at the platform ceiling", () => {
    expect(clampSpendCapCents(MAX_WORKSPACE_SPEND_CAP_CENTS + 1)).toBe(MAX_WORKSPACE_SPEND_CAP_CENTS);
    // The realistic mistake: dollars typed into a cents field.
    expect(clampSpendCapCents(5_000 * 100 * 100)).toBe(MAX_WORKSPACE_SPEND_CAP_CENTS);
  });

  it("passes through values under the ceiling untouched", () => {
    expect(clampSpendCapCents(DEFAULT_SPEND_CAP_CENTS)).toBe(DEFAULT_SPEND_CAP_CENTS);
    expect(clampSpendCapCents(MAX_WORKSPACE_SPEND_CAP_CENTS)).toBe(MAX_WORKSPACE_SPEND_CAP_CENTS);
  });

  // Zero is a meaningful setting — it blocks all metered spend — so it must not
  // be coerced into the default.
  it("preserves a deliberate zero cap", () => {
    expect(clampSpendCapCents(0)).toBe(0);
  });

  // Non-finite input is nonsense, never a real setting. For a spend guard the
  // safe direction is closed (spend nothing), not open — Infinity must not be
  // read as "authorise the maximum".
  it("fails closed on nonsense input rather than authorising the ceiling", () => {
    expect(clampSpendCapCents(-1)).toBe(0);
    expect(clampSpendCapCents(Number.NaN)).toBe(0);
    expect(clampSpendCapCents(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("keeps the ceiling above the default so the default is always settable", () => {
    expect(MAX_WORKSPACE_SPEND_CAP_CENTS).toBeGreaterThan(DEFAULT_SPEND_CAP_CENTS);
  });
});

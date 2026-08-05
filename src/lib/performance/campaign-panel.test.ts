import { describe, expect, it } from "vitest";

import { type CampaignEconomics } from "@/domain";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { buildAttributedPanel, buildDemoPanel, buildWeeklyTrend } from "./campaign-panel";
import { demoCampaignSeeds, getCampaignAnalyticsDemoDetail } from "./campaign-demo-detail";
import { getCampaignTrendRows } from "./attribution-read-model";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("buildDemoPanel", () => {
  it("maps the illustrative demo detail into the shared panel shape", () => {
    // Whatever campaign the demo is CURRENTLY serving, not a hard-coded id.
    //
    // This line used to name `demo-emergency-water-response-2026` and passed for
    // months while the panel was unreachable in every preview: that id is real,
    // but only under `ARC_DEMO_INDUSTRY=restoration`, which no launch config
    // sets. The test proved the mapper worked on a campaign nobody could open.
    // Asking the seed list keeps it pointed at something actually reachable.
    const detail = getCampaignAnalyticsDemoDetail(demoCampaignSeeds()[0].id);
    expect(detail).not.toBeNull();

    const panel = buildDemoPanel(detail!);
    if (panel.status !== "live") throw new Error("expected a live panel");

    expect(panel.source).toBe("demo");
    expect(panel.kpis.length).toBeGreaterThan(0);
    // Channels carry a formatted revenue string and an em-dash where spend is zero.
    expect(panel.channels.length).toBeGreaterThan(0);
    expect(panel.channels.every((c) => c.revenue.startsWith("$"))).toBe(true);
    expect(panel.channels.some((c) => c.spend === "—")).toBe(true);
    expect(panel.funnel.map((f) => f.label)).toContain("Booked");
    // Weekly trend + per-asset provenance-tagged rows come through for the drill-down.
    expect(panel.trend.length).toBeGreaterThan(1);
    expect(panel.trend.every((t) => typeof t.revenue === "number")).toBe(true);
    expect(panel.assets.length).toBeGreaterThan(0);
    expect(panel.assets.every((a) => a.source.length > 0 && a.ctr >= 0)).toBe(true);
  });
});

describe("buildAttributedPanel", () => {
  const econ: CampaignEconomics & { status: "live"; selfReported: { wonRevenueCents: number; leads: number } } = {
    status: "live",
    realizedRevenueCents: 500_000,
    pipelineRevenueCents: 200_000,
    spendCents: 100_000,
    attributedLeads: 40,
    wonCount: 5,
    roas: 5,
    cac: 20_000,
    cpl: 2_500,
    selfReported: { wonRevenueCents: 0, leads: 0 },
  };

  it("formats economics into KPIs, funnel, and the attribution note", () => {
    const panel = buildAttributedPanel(econ);
    if (panel.status !== "live") throw new Error("expected a live panel");

    expect(panel.source).toBe("attributed");
    const byKey = Object.fromEntries(panel.kpis.map((k) => [k.key, k.value]));
    expect(byKey.realized).toBe("$5,000");
    expect(byKey.pipeline).toBe("$2,000");
    expect(byKey.leads).toBe("40");
    expect(byKey.booked).toBe("5");
    expect(byKey.roas).toBe("5.00×");
    expect(byKey.spend).toBe("$1,000");
    // Spend KPI hint prefers cost-per-booked-job when available.
    expect(panel.kpis.find((k) => k.key === "spend")?.hint).toContain("per booked job");
    expect(panel.funnel).toEqual([
      { label: "Attributed leads", count: 40 },
      { label: "Booked jobs", count: 5 },
    ]);
    expect(panel.channels).toEqual([]);
    // Trend + per-asset delivery metrics need attached delivery data — empty for now.
    expect(panel.trend).toEqual([]);
    expect(panel.assets).toEqual([]);
  });

  it("shows an em-dash ROAS and no-spend hint when there is no spend", () => {
    const panel = buildAttributedPanel({ ...econ, spendCents: 0, roas: null, cac: null, cpl: null });
    if (panel.status !== "live") throw new Error("expected a live panel");
    expect(panel.kpis.find((k) => k.key === "roas")?.value).toBe("—");
    expect(panel.kpis.find((k) => k.key === "spend")?.hint).toBe("no spend recorded");
  });

  it("passes a supplied weekly trend through unchanged", () => {
    const trend = [{ week: "1/1", revenue: 100, leads: 2, booked: 1 }];
    const panel = buildAttributedPanel(econ, trend);
    if (panel.status !== "live") throw new Error("expected a live panel");
    expect(panel.trend).toEqual(trend);
  });
});

describe("buildWeeklyTrend", () => {
  const now = Date.parse("2026-07-08T12:00:00.000Z");

  it("buckets lead dates and won-revenue events into weekly points (revenue in whole dollars)", () => {
    const leadDates = [new Date(now - 2 * DAY_MS).toISOString(), new Date(now - 9 * DAY_MS).toISOString()];
    const wonEvents = [
      { at: new Date(now - 10 * DAY_MS).toISOString(), cents: 500_000 },
      { at: new Date(now - 40 * DAY_MS).toISOString(), cents: 999_000 }, // outside the 4-week window → skipped
    ];
    const points = buildWeeklyTrend(leadDates, wonEvents, now, 4);

    expect(points).toHaveLength(4);
    expect(points[3].leads).toBe(1); // lead 2 days ago → current week
    expect(points[2].leads).toBe(1); // lead 9 days ago → one week back
    expect(points[2].revenue).toBe(5_000); // 500,000 cents → $5,000
    expect(points[2].booked).toBe(1);
    // The 40-day-old event is out of window and contributes nothing.
    expect(points.reduce((s, p) => s + p.revenue, 0)).toBe(5_000);
  });

  it("skips null and unparseable dates", () => {
    const points = buildWeeklyTrend([null, "not-a-date"], [{ at: null, cents: 100 }], now, 3);
    expect(points.every((p) => p.leads === 0 && p.revenue === 0 && p.booked === 0)).toBe(true);
  });
});

describe("getCampaignTrendRows", () => {
  const CAMPAIGN = "22222222-2222-2222-2222-222222222222";

  it("returns attributed lead dates and won-revenue events", async () => {
    const supabase = createSupabaseQueryMock({
      leads: { data: [{ id: "l1", created_at: "2026-07-01T00:00:00Z" }, { id: "l2", created_at: "2026-07-05T00:00:00Z" }], error: null },
      outcomes: {
        data: [
          { status: "won", gross_revenue_cents: 500_000, closed_at: "2026-07-06T00:00:00Z", created_at: null },
          { status: "lost", gross_revenue_cents: 0, closed_at: null, created_at: "2026-07-02T00:00:00Z" },
        ],
        error: null,
      },
    });

    const out = await getCampaignTrendRows(CAMPAIGN, supabase);
    expect(out.status).toBe("live");
    if (out.status === "live") {
      expect(out.leadDates).toEqual(["2026-07-01T00:00:00Z", "2026-07-05T00:00:00Z"]);
      expect(out.wonEvents).toEqual([{ at: "2026-07-06T00:00:00Z", cents: 500_000 }]); // only the won outcome
    }
  });

  it("reports unavailable when the leads query errors", async () => {
    const supabase = createSupabaseQueryMock({ leads: { data: null, error: { message: "boom" } } });
    const out = await getCampaignTrendRows(CAMPAIGN, supabase);
    expect(out.status).toBe("unavailable");
  });
});

import { describe, expect, it } from "vitest";

import { buildPerformanceLearning, type CampaignPerformancePanel } from "./campaign-panel";

function panel(overrides: Partial<Extract<CampaignPerformancePanel, { status: "live" }>> = {}): CampaignPerformancePanel {
  return {
    status: "live",
    source: "attributed",
    windowLabel: "Last 90 days",
    note: "",
    kpis: [],
    funnel: [],
    trend: [],
    channels: [
      { channel: "Email", leads: 40, booked: 9, revenue: "$120k", spend: "—", share: 0.6 },
      { channel: "SMS", leads: 22, booked: 0, revenue: "$0", spend: "—", share: 0.4 },
    ],
    assets: [
      { id: "a1", title: "Inspection follow-up", channel: "Email", format: "1:1", source: "bsr_real", status: "approved", impressions: 1000, clicks: 42, leads: 20, ctr: 4.2 },
      { id: "a2", title: "SMS check-in", channel: "SMS", format: "text", source: "ai_generated", status: "approved", impressions: 800, clicks: 8, leads: 6, ctr: 1.0 },
    ],
    ...overrides,
  };
}

describe("buildPerformanceLearning", () => {
  it("names the best channel and asset and recommends a grounded next move", () => {
    const learning = buildPerformanceLearning(panel(), "Storm Rapid Response");
    expect(learning).not.toBeNull();
    expect(learning!.wins[0]).toContain("Email led on outcomes");
    expect(learning!.wins[0]).toContain("9 booked jobs");
    expect(learning!.wins.some((w) => w.includes("Inspection follow-up") && w.includes("4.2%"))).toBe(true);
    expect(learning!.recommendation).toContain("lead with Email");
    expect(learning!.recommendation).toContain("rework SMS");
    expect(learning!.arcPrompt).toContain("Storm Rapid Response");
    expect(learning!.arcPrompt).toMatch(/draft for my approval/i);
  });

  it("falls back to interest when nothing has booked yet", () => {
    const learning = buildPerformanceLearning(panel({
      channels: [
        { channel: "Email", leads: 12, booked: 0, revenue: "$0", spend: "—", share: 1 },
      ],
      assets: [],
    }));
    expect(learning!.wins[0]).toContain("drove the most interest");
    expect(learning!.recommendation).toContain("lead with Email");
  });

  it("returns null while measuring or with no delivered signal", () => {
    expect(buildPerformanceLearning({ status: "measuring", message: "…" })).toBeNull();
    expect(buildPerformanceLearning(panel({ channels: [] }))).toBeNull();
    expect(buildPerformanceLearning(panel({ channels: [{ channel: "Email", leads: 0, booked: 0, revenue: "$0", spend: "—", share: 1 }], assets: [] }))).toBeNull();
  });
});

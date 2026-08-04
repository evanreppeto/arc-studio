import { describe, expect, it } from "vitest";

import { type OpportunityRecord } from "@/lib/opportunities/read-model";

import { buildArcWaitingOpportunities } from "./waiting-opps";

function opp(over: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return {
    id: "o1",
    subject_type: "lead",
    subject_id: "s1",
    title: "A lead has gone quiet",
    summary: "…",
    confidence: 60,
    urgency: "medium",
    status: "pending",
    recommended_action: "Re-engage",
    evidence: null,
    ...over,
  };
}

describe("buildArcWaitingOpportunities", () => {
  it("orders by urgency then confidence and caps at the limit", () => {
    const items = buildArcWaitingOpportunities(
      [
        opp({ id: "low", urgency: "low", confidence: 99 }),
        opp({ id: "med", urgency: "medium", confidence: 50 }),
        opp({ id: "high1", urgency: "high", confidence: 70 }),
        opp({ id: "high2", urgency: "high", confidence: 90 }),
      ],
      3,
    );
    expect(items.map((i) => i.id)).toEqual(["high2", "high1", "med"]); // low dropped by the cap
  });

  it("uses the opportunity's own arcPrompt when present (next-iteration)", () => {
    const [item] = buildArcWaitingOpportunities([
      opp({
        id: "camp",
        subject_type: "campaign",
        urgency: "high",
        title: "Spring Storm Prep is converting — draft the next iteration",
        evidence: { arcPrompt: "Draft the next iteration of the Spring Storm Prep campaign. Keep it approval-gated." },
      }),
    ]);
    expect(item.prompt).toBe("Draft the next iteration of the Spring Storm Prep campaign. Keep it approval-gated.");
    expect(item.urgency).toBe("high");
    expect(item.title).toContain("Spring Storm Prep");
  });

  it("falls back to an approval-safe act-on-it prompt when there is no arcPrompt", () => {
    const [item] = buildArcWaitingOpportunities([opp({ title: "Flash-flood warning — Riverside" })]);
    expect(item.prompt).toContain("Flash-flood warning — Riverside");
    expect(item.prompt).toMatch(/draft for my approval/i);
  });

  it("ignores a blank arcPrompt and uses the fallback", () => {
    const [item] = buildArcWaitingOpportunities([opp({ evidence: { arcPrompt: "   " } })]);
    expect(item.prompt).toMatch(/Help me act on this opportunity/);
  });

  it("returns an empty list for no opportunities", () => {
    expect(buildArcWaitingOpportunities([])).toEqual([]);
  });
});

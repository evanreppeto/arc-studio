import { describe, expect, it } from "vitest";

import {
  PRICING_VERSION,
  estimateClaudeCostCents,
  estimateEmbeddingCostCents,
  estimateMediaCostCents,
  estimateTokensFromChars,
  isPricedModel,
  isPricedUsage,
} from "../ai-usage";
import type { UsageRollupEvent, UsageSummary } from "../ai-usage";
import { summarizeUsage, bucketCostByDay, summarizeUsageForSettings } from "../ai-usage";

describe("summarizeUsageForSettings", () => {
  const base: UsageSummary = {
    totalCostCents: 4800,
    totalInputTokens: 1_200_000,
    totalOutputTokens: 640_000,
    totalUnits: 0,
    eventCount: 312,
    byService: [],
    byModel: [],
    byUser: [],
  };

  it("computes cost, total tokens, runs, and % of a soft cap", () => {
    const result = summarizeUsageForSettings(base, 8000); // $80.00 soft cap
    expect(result.totalCostCents).toBe(4800);
    expect(result.totalTokens).toBe(1_840_000);
    expect(result.totalRuns).toBe(312);
    expect(result.pctOfCap).toBe(60);
    expect(result.isNearCap).toBe(false);
  });

  it("reports 0% and not-near when no soft cap is set", () => {
    const result = summarizeUsageForSettings(base);
    expect(result.pctOfCap).toBe(0);
    expect(result.isNearCap).toBe(false);
  });

  it("flags near-cap at or above 80%", () => {
    const result = summarizeUsageForSettings({ ...base, totalCostCents: 6800 }, 8000); // 85%
    expect(result.pctOfCap).toBe(85);
    expect(result.isNearCap).toBe(true);
  });
});

const EVENTS: UsageRollupEvent[] = [
  { service: "arc_claude", model: "claude-opus-4-8", actorUser: "evan", inputTokens: 1000, outputTokens: 500, units: null, costCents: 30, occurredAt: "2026-06-20T10:00:00Z" },
  { service: "arc_claude", model: "claude-haiku-4-5", actorUser: null, inputTokens: 2000, outputTokens: 1000, units: null, costCents: 5, occurredAt: "2026-06-21T10:00:00Z" },
  { service: "gemini_image", model: "gemini-2.5-flash-image", actorUser: "evan", inputTokens: null, outputTokens: null, units: 2, costCents: 8, occurredAt: "2026-06-21T11:00:00Z" },
];

describe("summarizeUsage", () => {
  it("totals cost, tokens, units, and event count", () => {
    const s = summarizeUsage(EVENTS);
    expect(s.totalCostCents).toBe(43);
    expect(s.totalInputTokens).toBe(3000);
    expect(s.totalOutputTokens).toBe(1500);
    expect(s.totalUnits).toBe(2);
    expect(s.eventCount).toBe(3);
  });

  it("groups by service sorted by cost desc", () => {
    const s = summarizeUsage(EVENTS);
    expect(s.byService.map((r) => r.service)).toEqual(["arc_claude", "gemini_image"]);
    expect(s.byService[0].costCents).toBe(35);
    expect(s.byService[0].count).toBe(2);
  });

  it("groups by model sorted by cost desc", () => {
    const s = summarizeUsage(EVENTS);
    expect(s.byModel[0]).toMatchObject({ model: "claude-opus-4-8", costCents: 30 });
  });

  it("groups by user with null folded into the autonomous bucket", () => {
    const s = summarizeUsage(EVENTS);
    const auto = s.byUser.find((r) => r.actorUser === null);
    const evan = s.byUser.find((r) => r.actorUser === "evan");
    expect(auto?.costCents).toBe(5);
    expect(evan?.costCents).toBe(38);
    expect(evan?.count).toBe(2);
  });

  it("returns zeros for an empty event list", () => {
    const s = summarizeUsage([]);
    expect(s).toMatchObject({ totalCostCents: 0, eventCount: 0 });
    expect(s.byService).toEqual([]);
    expect(s.byUser).toEqual([]);
  });
});

describe("bucketCostByDay", () => {
  it("sums cost into the supplied ordered day keys, zero-filling gaps", () => {
    const days = ["2026-06-19", "2026-06-20", "2026-06-21"];
    expect(bucketCostByDay(EVENTS, days)).toEqual([
      { date: "2026-06-19", costCents: 0 },
      { date: "2026-06-20", costCents: 30 },
      { date: "2026-06-21", costCents: 13 },
    ]);
  });
});

describe("estimateClaudeCostCents", () => {
  it("prices opus from input+output tokens (cents per million)", () => {
    // opus: 1500 c/Mtok in, 7500 c/Mtok out.
    // 1,000,000 in -> 1500c; 200,000 out -> 1500c; total 3000c
    expect(estimateClaudeCostCents("claude-opus-4-8", 1_000_000, 200_000)).toBe(3000);
  });

  it("prices haiku cheaper than opus for the same tokens", () => {
    const haiku = estimateClaudeCostCents("claude-haiku-4-5", 1_000_000, 1_000_000);
    const opus = estimateClaudeCostCents("claude-opus-4-8", 1_000_000, 1_000_000);
    expect(haiku).toBeLessThan(opus);
    expect(haiku).toBeGreaterThan(0);
  });

  it("matches a known model by prefix when an exact id is missing", () => {
    expect(estimateClaudeCostCents("claude-opus-4-8-20260101", 1_000_000, 0)).toBe(1500);
  });

  it("returns 0 for an unknown model", () => {
    expect(estimateClaudeCostCents("some-unknown-model", 1_000_000, 1_000_000)).toBe(0);
  });

  it("rounds to the nearest cent and treats null tokens as zero", () => {
    expect(estimateClaudeCostCents("claude-haiku-4-5", null, null)).toBe(0);
  });
});

describe("estimateMediaCostCents", () => {
  it("prices image generations per unit", () => {
    expect(estimateMediaCostCents("gemini_image", 3)).toBe(12); // 4c each
  });

  it("prices video generations per unit higher than images", () => {
    expect(estimateMediaCostCents("gemini_video", 1)).toBeGreaterThan(
      estimateMediaCostCents("gemini_image", 1),
    );
  });

  it("defaults missing units to 1", () => {
    expect(estimateMediaCostCents("gemini_image", null)).toBe(4);
  });
});

describe("isPricedModel / PRICING_VERSION", () => {
  it("flags known vs unknown models", () => {
    expect(isPricedModel("claude-opus-4-8")).toBe(true);
    expect(isPricedModel("mystery")).toBe(false);
  });

  it("exposes a pricing version string", () => {
    expect(typeof PRICING_VERSION).toBe("string");
    expect(PRICING_VERSION.length).toBeGreaterThan(0);
  });
});

describe("claude-sonnet-5 pricing (BSR-502)", () => {
  // It ran in production from 2026-07-10 with no pricing entry, so every turn
  // was recorded at zero. 36 events, ~42k output tokens, 52% of the ledger.
  it("is priced, so a sonnet turn no longer costs nothing", () => {
    expect(isPricedModel("claude-sonnet-5")).toBe(true);
    expect(estimateClaudeCostCents("claude-sonnet-5", 0, 1_000_000)).toBe(1500);
    expect(estimateClaudeCostCents("claude-sonnet-5", 1_000_000, 0)).toBe(300);
  });

  it("reprices the exact volume that was recorded as free", () => {
    // The real prod totals: 250 input, 42,454 output tokens across 36 events.
    // At 300/1500 cents per Mtok that is ~64 cents the ledger is missing.
    const cents = estimateClaudeCostCents("claude-sonnet-5", 250, 42_454);
    expect(cents).toBe(64);
  });

  it("still refuses to invent a price for a model it does not know", () => {
    // The zero must stay VISIBLE for anything unpriced — persistence reports it.
    expect(isPricedModel("claude-nonexistent-9")).toBe(false);
    expect(estimateClaudeCostCents("claude-nonexistent-9", 1_000_000, 1_000_000)).toBe(0);
  });
});

describe("embedding pricing (BSR-502 Finding 1)", () => {
  it("estimates tokens from characters, rounding UP", () => {
    // Gemini's developer API returns no token count for embedContent — the
    // billableCharacterCount / statistics fields are Enterprise-only — so the
    // token figure is derived. Rounding up keeps the estimate from being the
    // optimistic side of an already-undercounting meter.
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(1)).toBe(1);
    expect(estimateTokensFromChars(4)).toBe(1);
    expect(estimateTokensFromChars(5)).toBe(2);
    expect(estimateTokensFromChars(-10)).toBe(0);
  });

  it("records ZERO for an unpriced embedding model — and says so", () => {
    // The rate table is deliberately empty: no published figure has been
    // supplied, and inferring one would swap a visible zero for an invisible
    // wrong number. What matters is that the zero is DECLARED unpriced, so
    // recordUsageEvent reports it instead of filing it silently — the exact
    // failure that let claude-sonnet-5 bill nothing for three weeks.
    expect(estimateEmbeddingCostCents("gemini-embedding-2", 10_000)).toBe(0);
    expect(isPricedUsage("gemini_embedding", "gemini-embedding-2")).toBe(false);
  });

  it("does not let a Claude-only priced check vouch for another service", () => {
    // isPricedModel consults the Claude table. Asking it about an embedding
    // model would answer "unpriced" for the right reason by accident, and would
    // answer "priced" for a media row that has no model id at all.
    expect(isPricedUsage("arc_claude", "claude-opus-4-8")).toBe(true);
    expect(isPricedUsage("arc_claude", "claude-not-a-real-model-9")).toBe(false);
    expect(isPricedUsage("gemini_image", "")).toBe(true);
  });
});

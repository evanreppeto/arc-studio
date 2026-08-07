import { describe, expect, it } from "vitest";

import { CACHE_MULTIPLIERS, cacheTokensFromUsageDetail, estimateClaudeCostMicrocents } from "../ai-usage";

/**
 * With prompt caching, `input_tokens` is only the UNCACHED remainder — so
 * pricing it alone bills the output side and calls it a turn.
 *
 * The fixture below is a real prod row (2026-08-07): 18 input tokens against
 * 349,930 cache reads and 56,782 one-hour cache writes, recorded at 89¢ when it
 * cost ~$3.12. The counts had been captured and tested for a week; nothing
 * priced them. That is the bug this file exists to keep fixed.
 */
const LIVE_DETAIL = {
  speed: "standard",
  input_tokens: 18,
  output_tokens: 11897,
  service_tier: "standard",
  cache_creation: { ephemeral_1h_input_tokens: 56782, ephemeral_5m_input_tokens: 0 },
  cache_read_input_tokens: 349930,
  cache_creation_input_tokens: 56782,
};

/** claude-opus-4-8: 1500¢ / MTok in, 7500¢ / MTok out. */
const OPUS = "claude-opus-4-8";

describe("cache multipliers", () => {
  it("matches Anthropic's published rates", () => {
    // Confirmed against the prompt-caching docs 2026-08-07, not recalled. If
    // these ever change upstream, this is the line that should fail first.
    expect(CACHE_MULTIPLIERS).toEqual({ write5m: 1.25, write1h: 2, read: 0.1 });
  });
});

describe("estimateClaudeCostMicrocents with cached input", () => {
  it("prices the real prod turn at ~$3.12 instead of $0.89", () => {
    const cache = cacheTokensFromUsageDetail(LIVE_DETAIL)!;
    const micro = estimateClaudeCostMicrocents(OPUS, 18, 11897, cache);

    // output 11897*7500 + input 18*1500 + read 349930*150 + write1h 56782*3000
    const expectedCents = (11897 * 7500 + 18 * 1500 + 349930 * 1500 * 0.1 + 56782 * 1500 * 2) / 1_000_000;
    expect(micro / 1000).toBeCloseTo(expectedCents, 2);
    expect(Math.round(micro / 1000)).toBe(312);
  });

  it("is what the OLD signature undercounted — same turn, no cache argument", () => {
    // Guards the regression directly: dropping the 4th argument must not
    // silently return the old wrong number without anyone noticing.
    const withoutCache = estimateClaudeCostMicrocents(OPUS, 18, 11897);
    expect(Math.round(withoutCache / 1000)).toBe(89);
    const withCache = estimateClaudeCostMicrocents(OPUS, 18, 11897, cacheTokensFromUsageDetail(LIVE_DETAIL));
    expect(withCache / withoutCache).toBeGreaterThan(3);
  });

  it("bills a 1-hour write at 2x and a 5-minute write at 1.25x", () => {
    // The two differ by 60%, which is why the per-TTL split is captured at all.
    const oneHour = estimateClaudeCostMicrocents(OPUS, 0, 0, { creation1h: 1_000_000 });
    const fiveMin = estimateClaudeCostMicrocents(OPUS, 0, 0, { creation5m: 1_000_000 });
    expect(oneHour / 1000).toBeCloseTo(1500 * 2, 0);
    expect(fiveMin / 1000).toBeCloseTo(1500 * 1.25, 0);
    expect(oneHour).toBeGreaterThan(fiveMin);
  });

  it("bills a cache read at a tenth of base input", () => {
    const read = estimateClaudeCostMicrocents(OPUS, 0, 0, { read: 1_000_000 });
    const uncached = estimateClaudeCostMicrocents(OPUS, 1_000_000, 0);
    expect(read).toBe(Math.round(uncached * 0.1));
  });

  it("falls back to the CHEAPER rate when only the aggregate is known", () => {
    // Rows written before the per-TTL split was captured. Under-stating beats
    // over-billing a customer for a precision we do not actually have.
    const aggregate = estimateClaudeCostMicrocents(OPUS, 0, 0, { creationTotal: 1_000_000 });
    expect(aggregate / 1000).toBeCloseTo(1500 * 1.25, 0);
  });

  it("prefers the split over the aggregate when both are present", () => {
    // The live rows carry both, and double-counting them would over-bill 3x.
    const both = estimateClaudeCostMicrocents(OPUS, 0, 0, { creation1h: 1_000_000, creationTotal: 1_000_000 });
    expect(both / 1000).toBeCloseTo(1500 * 2, 0);
  });

  it("is unchanged for an uncached turn", () => {
    expect(estimateClaudeCostMicrocents(OPUS, 1000, 1000, null)).toBe(estimateClaudeCostMicrocents(OPUS, 1000, 1000));
  });

  it("still returns 0 for an unknown model rather than guessing", () => {
    expect(estimateClaudeCostMicrocents("claude-not-a-model", 1000, 1000, { read: 999_999 })).toBe(0);
  });
});

describe("cacheTokensFromUsageDetail", () => {
  it("reads the real runner blob", () => {
    expect(cacheTokensFromUsageDetail(LIVE_DETAIL)).toEqual({
      read: 349930,
      creation5m: 0,
      creation1h: 56782,
      creationTotal: 56782,
    });
  });

  it("returns null when there is nothing cached to price", () => {
    for (const value of [null, undefined, {}, "x", 42, { input_tokens: 5 }]) {
      expect(cacheTokensFromUsageDetail(value)).toBeNull();
    }
  });

  it("keeps a real zero, which is a measurement and not a missing value", () => {
    expect(cacheTokensFromUsageDetail({ cache_read_input_tokens: 0 })?.read).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

import { cacheTokensFromUsageDetail, estimateClaudeCostMicrocents } from "../ai-usage";

/**
 * The gap this closes is NOT "a field we forgot to capture" — it is a field we
 * captured, tested, shipped, and never priced.
 *
 * `cache_read_input_tokens` and `cache_creation_input_tokens` reached the ledger
 * on 2026-07-31 with their own passing tests. For a week every prod row carried
 * them and every row billed the output side alone, ~3.5x under. Nothing failed,
 * because "recorded" and "billed" were separate concerns with no test spanning
 * both.
 *
 * So: every token-bearing field the runner records must either move the price,
 * or be listed below with a reason. Adding a new one and doing neither fails
 * here.
 */

/** Fields observed in a real prod `usage_detail` (2026-08-07). */
const OBSERVED_KEYS = [
  "cache_creation",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
  "inference_geo",
  "input_tokens",
  "iterations",
  "output_tokens",
  "server_tool_use",
  "service_tier",
  "speed",
];

/**
 * Recorded but deliberately not billable, each with the reason it is not a
 * token count we owe money on. Anything NOT here has to move the price.
 */
const NOT_BILLABLE: Record<string, string> = {
  inference_geo: "routing metadata, not a token count",
  iterations: "agent loop count, not a token count",
  server_tool_use: "request counts for web search/fetch — billed per request by a separate line, not per token",
  service_tier: "which tier served it; would change the RATE, not the token count (see caveat below)",
  speed: "latency tier label, not a token count",
};

const OPUS = "claude-opus-4-8";

/** A turn where every billable field is non-zero, so any unpriced one shows up. */
const ALL_NONZERO = {
  input_tokens: 1000,
  output_tokens: 1000,
  cache_read_input_tokens: 1000,
  cache_creation_input_tokens: 1000,
  cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 600 },
};

function priceOf(detail: Record<string, unknown>): number {
  return estimateClaudeCostMicrocents(
    OPUS,
    detail.input_tokens as number,
    detail.output_tokens as number,
    cacheTokensFromUsageDetail(detail),
  );
}

describe("every recorded token class moves the price", () => {
  it("accounts for every field the runner actually records", () => {
    // Fails when a new key appears in prod that nobody has classified. The fix
    // is to price it or to say here why it is not billable — never to widen
    // this list without a reason.
    const billable = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "cache_creation"];
    for (const key of OBSERVED_KEYS) {
      const classified = billable.includes(key) || key in NOT_BILLABLE;
      expect(classified, `${key} is recorded but neither priced nor declared non-billable`).toBe(true);
    }
  });

  it("zeroing ANY billable token class lowers the price", () => {
    // This is the assertion that would have failed a week ago: with cache
    // pricing missing, zeroing the cache fields changed nothing at all.
    const full = priceOf(ALL_NONZERO);
    for (const key of ["input_tokens", "output_tokens", "cache_read_input_tokens"] as const) {
      const without = priceOf({ ...ALL_NONZERO, [key]: 0 });
      expect(without, `zeroing ${key} did not change the price — it is recorded but unpriced`).toBeLessThan(full);
    }
    // The creation split, zeroed together (either alone still leaves the other).
    const noCreation = priceOf({ ...ALL_NONZERO, cache_creation_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } });
    expect(noCreation).toBeLessThan(full);
  });

  it("the cached classes are the MAJORITY of a realistic turn's cost", () => {
    // Not a style point: on the product's main path the workspace context is
    // re-sent every turn, so cached input dominates. A meter that prices only
    // the uncached remainder is not slightly low, it is mostly blind.
    const detail = { input_tokens: 18, output_tokens: 11897, cache_read_input_tokens: 349930, cache_creation_input_tokens: 56782, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 56782 } };
    const full = priceOf(detail);
    const uncachedOnly = estimateClaudeCostMicrocents(OPUS, 18, 11897);
    expect(uncachedOnly / full).toBeLessThan(0.35);
  });

  it("documents the service_tier caveat rather than silently assuming standard", () => {
    // Every observed prod row is service_tier "standard", which is what the
    // base rates are. A priority/batch tier would change the RATE, and nothing
    // here reads it — so if that ever appears, this is the reminder.
    expect(NOT_BILLABLE.service_tier).toMatch(/RATE/);
  });
});

import { describe, expect, it } from "vitest";

import { estimateEmbeddingCostMicrocents, isPricedUsage, resolveEmbeddingRate } from "../ai-usage";

/**
 * The embedding path was metered on 2026-07-31 with NO rate, so 114 prod rows
 * recorded volume at $0.00 — deliberately, and loudly (an unpriced model reports
 * to Sentry). This supplies the rate that closes it.
 *
 * $0.20 per 1M input tokens: Gemini API paid tier, standard, read off Google's
 * published pricing page on 2026-08-07. Not inferred — the whole reason the
 * table sat empty is that a plausible wrong price in a billing meter is worse
 * than a visible zero.
 */
describe("gemini-embedding-2 rate", () => {
  it("is the published paid-tier price, in cents per MTok", () => {
    // $0.20 / 1M tokens = 20 cents / 1M tokens. If this ever looks wrong, check
    // the page before changing it — a wrong rate here is invisible downstream.
    expect(resolveEmbeddingRate("gemini-embedding-2")).toBe(20);
  });

  it("makes the model count as priced, so it stops reporting to Sentry", () => {
    // isPricedUsage, not isPricedModel: the latter only consults the CLAUDE
    // table, so asking it about an embedding model quietly answers false.
    expect(isPricedUsage("gemini_embedding", "gemini-embedding-2")).toBe(true);
  });

  it("still refuses to price a model nobody supplied a rate for", () => {
    // The guarantee that matters: adding one rate must not make the table
    // permissive. An unknown embedding model stays zero AND stays loud.
    expect(resolveEmbeddingRate("some-future-embedder")).toBeNull();
    expect(isPricedUsage("gemini_embedding", "some-future-embedder")).toBe(false);
    expect(estimateEmbeddingCostMicrocents("some-future-embedder", 1_000_000)).toBe(0);
  });

  it("prices a million tokens at 20 cents", () => {
    expect(estimateEmbeddingCostMicrocents("gemini-embedding-2", 1_000_000)).toBe(20_000);
  });

  it("keeps sub-cent precision instead of flooring to zero", () => {
    // The ledger's entire embedding history is ~10,799 tokens — about a fifth of
    // a cent. Whole-cent rounding would record the correct answer as $0.00 and
    // look identical to having no rate at all.
    const micro = estimateEmbeddingCostMicrocents("gemini-embedding-2", 10_799);
    expect(micro).toBeGreaterThan(0);
    expect(micro).toBe(Math.round((10_799 * 20 * 1000) / 1_000_000));
  });
});

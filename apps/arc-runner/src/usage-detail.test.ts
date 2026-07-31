import { describe, expect, it } from "vitest";

import { buildUsageDetail } from "./usage-detail";

/** The shape production actually sent, from the first metered turn (BSR-502). */
const REAL_PAYLOAD = {
  input_tokens: 8,
  output_tokens: 1051,
  cache_read_input_tokens: 92_215,
  cache_creation_input_tokens: 12_707,
  cache_creation: { ephemeral_5m_input_tokens: 12_707, ephemeral_1h_input_tokens: 0 },
  server_tool_use: { web_search_requests: 0 },
  service_tier: "standard",
  inference_geo: "us",
  iterations: 3,
  speed: "fast",
};

describe("buildUsageDetail", () => {
  it("captures the per-TTL cache split, which the enumerated version missed", () => {
    // The whole reason for this change: cache_creation's halves bill at
    // different multipliers, so the aggregate cache_creation_input_tokens alone
    // cannot be priced. The first production row proved the field existed and
    // that its value had not been captured.
    const detail = buildUsageDetail(REAL_PAYLOAD)!;
    expect(detail.cache_creation).toEqual({ ephemeral_5m_input_tokens: 12_707, ephemeral_1h_input_tokens: 0 });
    expect(detail.service_tier).toBe("standard");
    expect(detail.server_tool_use).toEqual({ web_search_requests: 0 });
    expect(detail.cache_read_input_tokens).toBe(92_215);
  });

  it("always records the full key set, including keys it dropped", () => {
    // This list is the tripwire — it is how the missing cache_creation values
    // were noticed at all, and it has to keep working for fields nobody is
    // looking for yet.
    const detail = buildUsageDetail({ input_tokens: 1, weird: [1, 2, 3] })!;
    expect(detail.usage_keys).toEqual(["input_tokens", "weird"]);
    expect(detail.dropped_keys).toEqual(["weird"]);
    expect(detail).not.toHaveProperty("weird");
  });

  it("drops structures deeper than one level rather than storing them", () => {
    const detail = buildUsageDetail({ deep: { a: { b: 1 } }, flat: { a: 1 } })!;
    // `deep.a` is an object, so nothing scalar survives and the key is dropped.
    expect(detail).not.toHaveProperty("deep");
    expect(detail.dropped_keys).toEqual(["deep"]);
    expect(detail.flat).toEqual({ a: 1 });
  });

  it("bounds key count and string length so a payload change cannot bloat every row", () => {
    const wide = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]));
    const detail = buildUsageDetail({ ...wide, label: "x".repeat(5_000) })!;
    // 40 captured + usage_keys + dropped_keys
    expect(Object.keys(detail)).toHaveLength(42);
    expect((detail.usage_keys as string[]).length).toBe(101);
    const label = detail.label as string | undefined;
    if (label !== undefined) expect(label.length).toBeLessThanOrEqual(200);
  });

  it("returns null for a missing or non-object payload", () => {
    expect(buildUsageDetail(null)).toBeNull();
    expect(buildUsageDetail(undefined)).toBeNull();
    expect(buildUsageDetail([] as unknown as Record<string, unknown>)).toBeNull();
  });

  it("keeps a genuine zero rather than treating it as absent", () => {
    // cache_read_input_tokens = 0 on an uncached turn is a real measurement and
    // must not be indistinguishable from "the SDK stopped sending this field".
    const detail = buildUsageDetail({ cache_read_input_tokens: 0 })!;
    expect(detail.cache_read_input_tokens).toBe(0);
    expect(detail.dropped_keys).toBeUndefined();
  });
});

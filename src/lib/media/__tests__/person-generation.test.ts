import { describe, expect, it } from "vitest";

import { resolvePersonGeneration } from "../gemini";

/**
 * Regression guard for the bug that made EVERY Veo call fail: the provider
 * hardcoded ALLOW_ADULT, which live veo-3.1-fast rejects with a 400.
 *
 * Probed against the live model 2026-08-03 — ALLOW_ADULT and DONT_ALLOW are
 * BOTH rejected; ALLOW_ALL is the only accepted value. The default must stay
 * ALLOW_ALL or video generation goes back to failing 100% of the time.
 */
describe("resolvePersonGeneration (request -> env -> default)", () => {
  it("defaults to the only value live Veo 3.1 accepts", () => {
    expect(resolvePersonGeneration(undefined, undefined)).toBe("ALLOW_ALL");
  });

  it("never defaults to a value the live API rejects", () => {
    for (const input of [undefined, "", "   "]) {
      const resolved = resolvePersonGeneration(input, input);
      expect(resolved).not.toBe("ALLOW_ADULT");
      expect(resolved).not.toBe("DONT_ALLOW");
    }
  });

  it("still allows the stricter values explicitly, for a future model revision", () => {
    expect(resolvePersonGeneration(undefined, "DONT_ALLOW")).toBe("DONT_ALLOW");
    expect(resolvePersonGeneration(undefined, "ALLOW_ADULT")).toBe("ALLOW_ADULT");
  });

  it("prefers a per-request override over the env", () => {
    expect(resolvePersonGeneration("ALLOW_ALL", "DONT_ALLOW")).toBe("ALLOW_ALL");
  });

  it("accepts lowercase and surrounding whitespace, matching how operators type it", () => {
    expect(resolvePersonGeneration("dont_allow", undefined)).toBe("DONT_ALLOW");
    expect(resolvePersonGeneration(" allow_all ", undefined)).toBe("ALLOW_ALL");
  });

  it("falls back to the default on a value the SDK enum does not accept", () => {
    expect(resolvePersonGeneration("allow_everyone", undefined)).toBe("ALLOW_ALL");
    expect(resolvePersonGeneration(undefined, "yes")).toBe("ALLOW_ALL");
  });
});

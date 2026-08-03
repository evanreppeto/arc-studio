import { describe, expect, it } from "vitest";

import { resolvePersonGeneration } from "../gemini";

/**
 * Regression guard for the bug that made EVERY Veo call fail: the provider
 * hardcoded ALLOW_ADULT, which an un-allowlisted Veo 3.1 project rejects with
 * a 400. The default must stay DONT_ALLOW — the only value that renders
 * without a project allowlist.
 */
describe("resolvePersonGeneration (request -> env -> default)", () => {
  it("defaults to DONT_ALLOW so an un-allowlisted project can still render", () => {
    expect(resolvePersonGeneration(undefined, undefined)).toBe("DONT_ALLOW");
  });

  it("never silently defaults to ALLOW_ADULT — the value Veo 3.1 rejects", () => {
    expect(resolvePersonGeneration(undefined, undefined)).not.toBe("ALLOW_ADULT");
    expect(resolvePersonGeneration("", "")).not.toBe("ALLOW_ADULT");
  });

  it("lets the env lift the policy once the project is allowlisted", () => {
    expect(resolvePersonGeneration(undefined, "ALLOW_ADULT")).toBe("ALLOW_ADULT");
    expect(resolvePersonGeneration(undefined, "ALLOW_ALL")).toBe("ALLOW_ALL");
  });

  it("prefers a per-request override over the env", () => {
    expect(resolvePersonGeneration("ALLOW_ALL", "DONT_ALLOW")).toBe("ALLOW_ALL");
  });

  it("accepts lowercase and pads whitespace, matching how operators type it", () => {
    expect(resolvePersonGeneration("allow_adult", undefined)).toBe("ALLOW_ADULT");
    expect(resolvePersonGeneration(" allow_all ", undefined)).toBe("ALLOW_ALL");
  });

  it("falls back to the default on a value the SDK enum does not accept", () => {
    expect(resolvePersonGeneration("allow_everyone", undefined)).toBe("DONT_ALLOW");
    expect(resolvePersonGeneration(undefined, "yes")).toBe("DONT_ALLOW");
  });
});

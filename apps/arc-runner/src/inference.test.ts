import { describe, expect, it } from "vitest";

import { buildQueryOptions, inferenceForRoute, describeRailStop, isRailStop } from "./inference";

describe("inferenceForRoute", () => {
  it("routes Arc Pulse (fast) chat to Sonnet 5 with a light thinking budget", () => {
    const s = inferenceForRoute("fast");
    expect(s.model).toBe("claude-sonnet-5");
    expect(s.maxThinkingTokens).toBe(2_000);
  });

  it("routes Arc Drive (standard) work to Opus with a deeper thinking budget than chat", () => {
    const s = inferenceForRoute("standard");
    expect(s.model).toBe("claude-opus-4-8");
    expect(s.maxThinkingTokens).toBeGreaterThan(inferenceForRoute("fast").maxThinkingTokens);
    expect(s.maxThinkingTokens).toBe(10_000);
  });

  it("routes Arc Deep (deep) to the ceiling model at the deepest thinking budget", () => {
    const s = inferenceForRoute("deep");
    expect(s.model).toBe("claude-opus-4-8");
    expect(s.maxThinkingTokens).toBeGreaterThan(inferenceForRoute("standard").maxThinkingTokens);
  });

  it("sets a fallback model and cost/turn rails on every route", () => {
    for (const route of ["fast", "standard", "deep"] as const) {
      const s = inferenceForRoute(route);
      expect(s.fallbackModel.length).toBeGreaterThan(0);
      expect(s.maxTurns).toBeGreaterThan(0);
      expect(s.maxBudgetUsd).toBeGreaterThan(0);
    }
  });
});

describe("buildQueryOptions", () => {
  it("applies inference settings and keeps the outbound-safe permission flags", () => {
    const opts = buildQueryOptions({
      inference: inferenceForRoute("standard"),
      systemPrompt: "SYS",
      mcpServers: {},
      allowedTools: ["query_brain"],
    });
    expect(opts.systemPrompt).toBe("SYS");
    expect(opts.model).toBe("claude-opus-4-8");
    expect(opts.fallbackModel).toBe("claude-sonnet-5");
    expect(opts.maxThinkingTokens).toBeGreaterThan(0);
    expect(opts.maxTurns).toBeGreaterThan(0);
    expect(opts.maxBudgetUsd).toBeGreaterThan(0);
    expect(opts.allowedTools).toEqual(["query_brain"]);
    expect(opts.permissionMode).toBe("bypassPermissions");
    expect(opts.includePartialMessages).toBe(true);
  });

  it("carries the Arc Pulse Sonnet 5 model + Haiku fallback through", () => {
    const opts = buildQueryOptions({
      inference: inferenceForRoute("fast"),
      systemPrompt: "SYS",
      mcpServers: {},
      allowedTools: [],
    });
    expect(opts.model).toBe("claude-sonnet-5");
    expect(opts.fallbackModel).toBe("claude-haiku-4-5");
  });
});

/**
 * BSR-721. A Studio image edit spent all 12 turns on the fast tier and the
 * operator was told "Arc hit an error generating a reply. Check the runner
 * logs." The rail was working as designed; the reporting made it look like a
 * crash, and gave no hint that the same request finishes on a tier with 24.
 */
describe("describeRailStop", () => {
  it("names the limit and the tier, and offers the tier with more room", () => {
    // Derived, not hardcoded: these are tuning dials and the literal 12 from the
    // original incident is already stale — the fast tier has since been raised.
    const fast = inferenceForRoute("fast").maxTurns;
    const standard = inferenceForRoute("standard").maxTurns;
    const out = describeRailStop("fast", { partial: true, reason: "Reached maximum number of turns" });
    expect(out).toContain(`${fast}-step limit`);
    expect(out).toContain("Arc Spark");
    expect(out).toContain("Arc Forge");
    expect(out).toContain(`${standard} steps`);
  });

  it("does not offer an escalation that has no more room", () => {
    // Telling someone to switch to a tier with the same ceiling wastes a retry.
    const out = describeRailStop("standard", { partial: true, reason: "Reached maximum number of turns" });
    expect(out).toContain(`${inferenceForRoute("standard").maxTurns}-step limit`);
    expect(out).not.toContain("switch to");
  });

  it("reports a spend rail as spend, not as steps", () => {
    const out = describeRailStop("fast", { partial: false, reason: "Exceeded max budget of $1" });
    expect(out).toContain("spend limit");
    expect(out).not.toContain("step limit");
  });

  it("says a rail is a safety limit rather than a failure when nothing survived", () => {
    const out = describeRailStop("fast", { partial: false, reason: "Reached maximum number of turns (12)" });
    expect(out).toContain("safety limit, not a failure");
    expect(out).toContain("nothing to show");
  });

  it("distinguishes a salvaged turn from an empty one", () => {
    const partial = describeRailStop("fast", { partial: true, reason: "turns" });
    const empty = describeRailStop("fast", { partial: false, reason: "turns" });
    expect(partial).toContain("pick up where it left off");
    expect(empty).toContain("nothing to show");
    expect(partial).not.toEqual(empty);
  });
});

describe("isRailStop", () => {
  it("recognises our own rails", () => {
    expect(isRailStop(new Error("Claude Code returned an error result: Reached maximum number of turns (12)"))).toBe(true);
    expect(isRailStop(new Error("Exceeded max budget of $1"))).toBe(true);
  });

  it("does not claim a genuine fault is a rail", () => {
    // Misreporting a crash as a safety limit would hide real breakage.
    expect(isRailStop(new Error("ECONNRESET"))).toBe(false);
    expect(isRailStop(new Error("token store 503"))).toBe(false);
    expect(isRailStop(null)).toBe(false);
    expect(isRailStop(undefined)).toBe(false);
  });
});

describe("describeRailStop with a route it does not know", () => {
  it("omits the tier rather than naming it 'undefined'", () => {
    // A caller that lost the route should degrade, not emit nonsense at the
    // operator. Caught by a test fixture that had no route.
    const out = describeRailStop(undefined as never, { partial: true, reason: "turns" });
    expect(out).not.toContain("undefined");
    expect(out).toMatch(/\d+-step limit/);
  });
});

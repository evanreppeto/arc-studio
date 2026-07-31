import { describe, expect, it } from "vitest";

import { countOrNull, requireCount } from "./count";

describe("requireCount", () => {
  it("returns a real count, including zero", () => {
    // The distinction the whole guard rests on: an EMPTY table counts 0, so 0 is
    // a fact and must pass through untouched.
    expect(requireCount("contacts", { count: 0, error: null })).toBe(0);
    expect(requireCount("contacts", { count: 42, error: null })).toBe(42);
  });

  it("throws on a null count with NO error — the HEAD blind spot", () => {
    // Exactly what PostgREST returns for a missing relation on a HEAD count.
    // `count ?? 0` turned this into a confident zero and hid a broken query
    // through three forced failures (BSR-575).
    expect(() => requireCount("contacts", { count: null, error: null })).toThrow(/missing or inaccessible/);
  });

  it("names what failed, so a log line is actionable", () => {
    expect(() => requireCount("knowledge_nodes", { count: null, error: null })).toThrow(/knowledge_nodes/);
  });

  it("still surfaces a reported error, and keeps its message", () => {
    expect(() => requireCount("jobs", { count: null, error: { message: "permission denied" } })).toThrow(
      /jobs count failed: permission denied/,
    );
  });

  it("does not invent a message when the error carries none", () => {
    expect(() => requireCount("leads", { count: null, error: {} })).toThrow(/unknown Supabase error/);
  });
});

describe("countOrNull", () => {
  it("returns null rather than 0 when the count is unknown", () => {
    // The point of the non-throwing variant: the caller must decide. It must
    // never hand back a number that reads as fact.
    expect(countOrNull({ count: null, error: null })).toBeNull();
    expect(countOrNull({ count: null, error: { message: "boom" } })).toBeNull();
  });

  it("passes a real count through, including zero", () => {
    expect(countOrNull({ count: 0, error: null })).toBe(0);
    expect(countOrNull({ count: 7, error: null })).toBe(7);
  });
});

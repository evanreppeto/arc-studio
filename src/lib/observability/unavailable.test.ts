import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./report-degraded", () => ({ reportDegraded: vi.fn() }));

import { reportDegraded } from "./report-degraded";
import { reasonIfUnavailable, unavailable, unavailableRead } from "./unavailable";

const reported = vi.mocked(reportDegraded);

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("unavailable", () => {
  it("keeps the error's own message instead of erasing it", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = unavailable("analytics.performance", "org-1")(new Error("column x does not exist"));
    expect(result).toEqual({ status: "unavailable", message: "column x does not exist" });
  });

  it("logs the label and org so a tenant-specific failure is traceable", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    unavailable("brain.nodes", "org-42")(new Error("boom"));
    const line = String(spy.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("brain.nodes");
    expect(line).toContain("org-42");
    expect(line).toContain("boom");
  });

  it("still produces a message for a non-Error throw", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = unavailable("x.y")("just a string");
    expect(result.status).toBe("unavailable");
    expect(result.message).toBeTruthy();
  });

  it("says the org is unknown rather than inventing one", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    unavailable("x.y")(new Error("boom"));
    expect(String(spy.mock.calls[0]?.[0])).toContain("unknown");
  });
});

describe("unavailableRead — failures that never reach a page's .catch (BSR-547)", () => {
  it("attributes the failure to the org that was actually queried", () => {
    // A failure affecting one workspace, in a log covering all of them, has to
    // name the workspace. This is the org the read really used, not one the
    // page guessed by resolving context a second time.
    unavailableRead("knowledge-graph.listNodes", "org-abc", new Error("boom"));
    expect(reported).toHaveBeenCalledTimes(1);
    expect(reported.mock.calls[0]?.[1]).toMatchObject({
      scope: "knowledge-graph.listNodes",
      detail: expect.objectContaining({ orgId: "org-abc" }),
    });
  });

  it("says 'unresolved' when the org could not be determined", () => {
    // Deliberately not "unknown": it states that resolution failed, which is
    // actionable, rather than that the field happened to be absent.
    unavailableRead("knowledge-graph.getBrainGraph", null, new Error("boom"));
    expect(reported.mock.calls[0]?.[1].detail).toMatchObject({ orgId: "unresolved" });
  });

  it("returns the shape the read-models already return", () => {
    expect(unavailableRead("s", "org-abc", new Error("boom"))).toEqual({
      status: "unavailable",
      message: "boom",
    });
  });

  it("keeps the message from a PostgREST error object", () => {
    // Supabase returns a plain object, not an Error. `String(obj)` is
    // "[object Object]" — which would discard the one useful detail, usually
    // the missing column or constraint.
    const pgError = { message: "column knowledge_nodes.summary does not exist", code: "42703", hint: "Perhaps you meant body" };
    const result = unavailableRead("knowledge-graph.listNodes", "org-abc", pgError);
    expect(result.message).toBe("column knowledge_nodes.summary does not exist");
    expect(reported.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect((reported.mock.calls[0]?.[0] as Error).message).toBe("column knowledge_nodes.summary does not exist");
  });

  it("carries the Postgres code and hint into the report", () => {
    unavailableRead("s", "org-abc", { message: "m", code: "42P01", hint: "h" });
    expect(reported.mock.calls[0]?.[1].detail).toMatchObject({ code: "42P01", hint: "h" });
  });

  it("never emits '[object Object]' as the reason", () => {
    expect(unavailableRead("s", "org-abc", { code: "42P01" }).message).not.toContain("[object Object]");
  });

  it("falls back to the caller's message when the error carries none", () => {
    const result = unavailableRead("s", "org-abc", {}, { fallbackMessage: "Brain is unavailable." });
    expect(result.message).toBe("Brain is unavailable.");
  });

  it("treats a read that IS the screen as primary, and defaults to secondary", () => {
    unavailableRead("s", "org-abc", new Error("boom"));
    expect(reported.mock.calls[0]?.[1].surface).toBe("secondary");
    unavailableRead("s", "org-abc", new Error("boom"), { surface: "primary" });
    expect(reported.mock.calls[1]?.[1].surface).toBe("primary");
  });
});

describe("reasonIfUnavailable", () => {
  it("returns null for a healthy read — an empty result is not a failure", () => {
    // The distinction this whole ticket exists for: "loaded and empty" must not
    // be reported as broken, or the signal becomes noise.
    expect(reasonIfUnavailable({ status: "live" })).toBeNull();
    expect(reasonIfUnavailable(null)).toBeNull();
    expect(reasonIfUnavailable(undefined)).toBeNull();
  });

  it("returns the reason for a failed read", () => {
    expect(reasonIfUnavailable({ status: "unavailable", message: "timeout" })).toBe("timeout");
  });

  it("never returns an empty string a view would render as blank", () => {
    expect(reasonIfUnavailable({ status: "unavailable", message: "   " })).toBe("This data could not be loaded.");
    expect(reasonIfUnavailable({ status: "unavailable" })).toBe("This data could not be loaded.");
  });
});

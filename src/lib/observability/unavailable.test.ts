import { afterEach, describe, expect, it, vi } from "vitest";

import { reasonIfUnavailable, unavailable } from "./unavailable";

afterEach(() => vi.restoreAllMocks());

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

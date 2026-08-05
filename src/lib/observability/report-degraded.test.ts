import { afterEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => sentry);
vi.mock("./sentry-options", () => ({ isSentryEnabled: true }));

import { reportDegraded } from "./report-degraded";

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("reportDegraded", () => {
  it("captures the error with the scope, so a swallowed failure is findable", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    reportDegraded(new Error("column x does not exist"), {
      scope: "campaigns.getCampaignWorkspaceList",
      surface: "primary",
    });

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const [err, opts] = sentry.captureException.mock.calls[0]!;
    expect((err as Error).message).toBe("column x does not exist");
    expect(opts).toMatchObject({
      level: "error",
      tags: { degraded: "true", scope: "campaigns.getCampaignWorkspaceList", surface: "primary" },
    });
  });

  // A broken primary surface is an outage; a broken side panel is not. The
  // level has to distinguish them or the alert channel becomes noise.
  it("reports a secondary surface at a lower level", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    reportDegraded(new Error("boom"), { scope: "x.y" });
    expect(sentry.captureException.mock.calls[0]![1]).toMatchObject({ level: "warning" });
  });

  it("wraps a non-Error throw so it still reports", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    reportDegraded("just a string", { scope: "x.y" });
    expect((sentry.captureException.mock.calls[0]![0] as Error).message).toBe("just a string");
  });

  it("always leaves a server-log trace — Sentry is often unconfigured exactly when someone is staring at an empty screen", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reportDegraded(new Error("boom"), { scope: "crm.list", detail: { orgId: "org-1" } });
    const line = warn.mock.calls[0]![0] as string;
    expect(line).toContain("[degraded] crm.list:");
    expect(line).toContain("boom");
  });

  /**
   * The stack is the actionable half. Without it the line names a scope and a
   * message, which for a generic message is not enough to act on: Studio's dead
   * compose path logged `[degraded] studio.generateStudioAsset: Invalid URL`,
   * which is true and does not say which of the render's several URLs was
   * invalid or which frame threw. Sentry had the stack; whoever was reading the
   * platform log had the useless half.
   */
  it("includes the stack, not just the message", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reportDegraded(new Error("boom"), { scope: "crm.list" });
    expect(warn.mock.calls[0]![0] as string).toMatch(/\n\s+at /);
  });

  it("falls back to the message when the throw carries no stack", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stackless = new Error("no stack here");
    stackless.stack = undefined;
    reportDegraded(stackless, { scope: "x.y" });
    expect(warn.mock.calls[0]![0] as string).toContain("[degraded] x.y: no stack here");
  });

  // Reporting a failure must never become the outage the caller was avoiding.
  it("never throws, even if the reporter does", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sentry.captureException.mockImplementationOnce(() => {
      throw new Error("sentry is down");
    });
    expect(() => reportDegraded(new Error("boom"), { scope: "x.y" })).not.toThrow();
  });
});

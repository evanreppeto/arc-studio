import { describe, expect, it, vi } from "vitest";

import type { ArcClient } from "../arc-client";
import { performanceReadTools } from "./performance";

function loose(tool: ReturnType<typeof performanceReadTools>[number]) {
  return (args: Record<string, unknown>) =>
    (tool.handler as (a: Record<string, unknown>, e?: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>)(args);
}

describe("read_performance", () => {
  it("reads /api/v1/arc/performance and returns the slices in its text result", async () => {
    const apiGet = vi.fn(async () => ({
      ok: true,
      dimension: "persona",
      slices: [{ key: "persona_landlord", jobs: 4, roas: 4 }],
    }));
    const client = { apiGet } as unknown as ArcClient;
    const step = vi.fn(async () => {});

    const [readPerformance] = performanceReadTools(client, step);
    expect(readPerformance.name).toBe("read_performance");

    const res = await loose(readPerformance)({ dimension: "persona", days: 90 });

    // apiGet was called against the performance endpoint.
    expect(apiGet).toHaveBeenCalledWith(
      "/api/v1/arc/performance",
      expect.objectContaining({ dimension: "persona", days: 90 }),
    );

    // The slice data is stringified into the tool's text result.
    const text = res.content[0].text;
    expect(text).toContain("persona_landlord");
    expect(text).toContain("4");
  });

  it("reports a missing slices field as a FAILURE, not as no performance data (BSR-508)", async () => {
    // This test previously asserted the opposite — that a response with no
    // `slices` field "falls back to an empty slices array". That fallback is the
    // bug: a 200 that forgot to answer became indistinguishable from a workspace
    // with no performance history, and Arc would report "no data yet" with total
    // confidence. Empty is a real answer; ABSENT is a fault.
    const apiGet = vi.fn(async () => ({ ok: true, dimension: "channel" }));
    const client = { apiGet } as unknown as ArcClient;
    const step = vi.fn(async () => {});

    const [readPerformance] = performanceReadTools(client, step);
    const res = await loose(readPerformance)({ dimension: "channel" });

    expect(res.content[0].text).toContain("RETRIEVAL FAILED");
    expect(res.content[0].text).toContain("no `slices` field");
    expect(res.content[0].text).not.toContain('"slices":[]');
    expect((res as { isError?: boolean }).isError).toBe(true);
  });

  it("still returns a genuinely empty slices list as data", async () => {
    // The guard must not turn "nothing happened yet" into an alarm, or it gets
    // ignored within a week.
    const apiGet = vi.fn(async () => ({ ok: true, dimension: "channel", slices: [] }));
    const client = { apiGet } as unknown as ArcClient;
    const step = vi.fn(async () => {});

    const [readPerformance] = performanceReadTools(client, step);
    const res = await loose(readPerformance)({ dimension: "channel" });

    expect(res.content[0].text).toContain('"slices":[]');
    expect(res.content[0].text).not.toContain("RETRIEVAL FAILED");
  });
});

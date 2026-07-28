import { describe, expect, it, vi } from "vitest";

const reporter = vi.hoisted(() => ({ reportDegraded: vi.fn() }));
vi.mock("@/lib/observability/report-degraded", () => reporter);
vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: () => true,
  getSupabaseAdminClient: () => {
    throw new Error("should not be reached — the test injects a client");
  },
}));

import { getOutboxList } from "./read-model";

/**
 * Proves the BSR-544 wiring actually fires on a real read path, rather than
 * confirming it by reading the source. A primary surface that fails must both
 * degrade (so the console survives) AND report (so someone finds out).
 */
describe("getOutboxList — degraded reporting", () => {
  it("reports to the degraded channel when the query throws, and still degrades", async () => {
    reporter.reportDegraded.mockClear();

    const exploding = {
      from() {
        throw new Error('column "nope" does not exist');
      },
    } as never;

    const result = await getOutboxList(exploding);

    // Degrades — the page is not taken down.
    expect(result.status).toBe("unavailable");

    // ...but it is no longer silent. This is the half that was missing, and the
    // half whose absence let a broken campaigns board look merely empty.
    expect(reporter.reportDegraded).toHaveBeenCalledTimes(1);
    const [err, ctx] = reporter.reportDegraded.mock.calls[0]!;
    expect((err as Error).message).toContain("does not exist");
    expect(ctx).toMatchObject({ scope: "dispatch.getOutboxList", surface: "primary" });
  });
});

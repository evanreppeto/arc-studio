import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdminClient: vi.fn(),
  isSupabaseAdminConfigured: vi.fn(() => true),
}));

import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { getPipelineStages } from "./read-model";

/**
 * A tenant-defined record type gets NO default pipeline.
 *
 * The six do: the product knows the shape of a lead's lifecycle and seeds one
 * per industry. It has no idea what "Equipment" moves through, and guessing
 * wrong is worse than staying quiet — so an empty result is the honest answer
 * AND the signal the UI keys off to leave the status column, the filter and
 * the picker off entirely.
 *
 * Falling back to a lead's stages here would put "Qualified" on a forklift, and
 * would do it silently: every custom object would sprout a Status column full
 * of sales words nobody chose.
 */

function clientReturning(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order"]) {
    chain[method] = vi.fn(() => chain);
  }
  // `order` is the awaited terminal in getPipelineStages.
  chain.order = vi.fn(async () => ({ data: rows, error: null }));
  return { from: vi.fn(() => chain) };
}

beforeEach(() => {
  vi.mocked(getSupabaseAdminClient).mockReturnValue(clientReturning([]) as never);
});
afterEach(() => vi.clearAllMocks());

describe("getPipelineStages for a tenant-defined type", () => {
  it("returns nothing when the org has defined no stages for it", async () => {
    const stages = await getPipelineStages("org-1", "equipment");
    expect(stages).toEqual([]);
  });

  it("returns the org's own stages when it has them", async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(
      clientReturning([
        { key: "in_service", label: "In service", sort_order: 0, is_terminal: false, is_won: false, is_lost: false, is_qualified: false, active: true },
        { key: "retired", label: "Retired", sort_order: 1, is_terminal: true, is_won: false, is_lost: false, is_qualified: false, active: true },
      ]) as never,
    );

    const stages = await getPipelineStages("org-1", "equipment");
    expect(stages.map((s) => s.label)).toEqual(["In service", "Retired"]);
    // The semantic flags survive, so reporting can ask what a stage MEANS
    // rather than matching its name — the rule the six already follow.
    expect(stages.find((s) => s.key === "retired")?.isTerminal).toBe(true);
  });

  /**
   * The built-ins keep their fallback. This is the half that would break
   * quietly: widening the key type without keeping the asymmetry would hand
   * every object an empty pipeline and read every lead as stageless.
   */
  it("still falls back to the defaults for a built-in pipeline", async () => {
    const stages = await getPipelineStages("org-1", "leads");
    expect(stages.length).toBeGreaterThan(0);
  });

  it("gives a custom type nothing even with no org at all", async () => {
    // The no-org path returns the fallback directly, so it needs the same
    // asymmetry — otherwise the offline preview shows lead stages on Equipment.
    expect(await getPipelineStages("", "equipment")).toEqual([]);
    expect((await getPipelineStages("", "leads")).length).toBeGreaterThan(0);
  });
});

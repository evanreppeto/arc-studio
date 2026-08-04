import { beforeEach, describe, expect, it, vi } from "vitest";

import { type OpportunityCandidate } from "@/domain";


// Static, not `await import(…)` inside each test: `vi.mock` is hoisted above
// imports, so the mocks apply either way. The dynamic form bought nothing and
// charged this file's module transform to whichever test ran first (BSR-739).
import { runWeatherEventDetection } from "./detector";

/**
 * `runWeatherEventDetection` passed NO config to the detector: no persona, no
 * event categories. It runs in the same scan as the `weather-signals` connector,
 * which DOES read both — over a different source (this reads the stored
 * `weather_events` table; the connector hits live NWS).
 *
 * `upsertOpportunities` dedups by skipping a subject that already has an open
 * opportunity of the same kind, and the two run inside one Promise.all, so
 * whichever finishes first wins. That made the bug intermittent rather than
 * constant: a storm card carried a persona only when the connector happened to
 * win the race.
 *
 * The persona matters because `selectAutoDraftCandidates` skips an opportunity
 * with no resolvable persona as `no_persona` — so this silently made storm
 * opportunities undraftable rather than visibly wrong.
 */

const upsertOpportunities =
  vi.fn<(candidates: OpportunityCandidate[], db?: unknown, opts?: unknown) => Promise<{ ok: true; count: number }>>();
vi.mock("./persistence", () => ({
  upsertOpportunities: (c: OpportunityCandidate[], db?: unknown, opts?: unknown) => upsertOpportunities(c, db, opts),
}));

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: () => true,
  getSupabaseAdminClient: () => {
    throw new Error("detector must use the injected client");
  },
}));

vi.mock("@/lib/auth/org", () => ({ getCurrentOrgId: async () => "org_1" }));
vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: async () => ({ orgId: "org_1", workspaceId: "ws_1" }),
}));

const getConnectorConfig = vi.fn<() => Promise<Record<string, unknown>>>();
vi.mock("@/lib/connectors/config", () => ({
  getConnectorConfig: () => getConnectorConfig(),
}));


const NOW = "2026-07-29T13:00:00.000Z";

/** One live property-damage alert, which the default categories surface. */
const source = {
  listActiveEvents: async () => [
    {
      id: "nws-1",
      eventType: "Flood Warning",
      severity: "severe",
      areaDescription: "Cook County, IL",
      onsetAt: NOW,
      expiresAt: "2026-07-30T13:00:00.000Z",
      zipCodes: ["60614"],
    },
  ],
};

const captured = (): OpportunityCandidate[] => {
  const call = upsertOpportunities.mock.calls[0];
  if (!call) throw new Error("persistence was never called — the detector produced nothing");
  return call[0];
};

beforeEach(() => {
  upsertOpportunities.mockReset();
  upsertOpportunities.mockResolvedValue({ ok: true, count: 1 });
  getConnectorConfig.mockReset();
  getConnectorConfig.mockResolvedValue({});
});

describe("runWeatherEventDetection reads the workspace's weather config", () => {
  it("carries the configured persona onto the opportunity", async () => {
    getConnectorConfig.mockResolvedValue({ persona: "persona_property_manager" });

    await runWeatherEventDetection(source as never, {} as never, NOW);

    const [candidate] = captured();
    expect(candidate).toBeDefined();
    expect((candidate.evidence as Record<string, unknown>).persona).toBe("persona_property_manager");
  });

  it("omits the persona when the workspace has not configured one", async () => {
    // Refuse rather than invent: a detector cannot know who a workspace sells to.
    getConnectorConfig.mockResolvedValue({});

    await runWeatherEventDetection(source as never, {} as never, NOW);

    const [candidate] = captured();
    expect((candidate.evidence as Record<string, unknown>).persona).toBeUndefined();
  });

  it("ignores a blank persona rather than storing whitespace", async () => {
    getConnectorConfig.mockResolvedValue({ persona: "   " });

    await runWeatherEventDetection(source as never, {} as never, NOW);

    expect((captured()[0].evidence as Record<string, unknown>).persona).toBeUndefined();
  });

  it("honours the operator's event-category opt-in", async () => {
    // Heat only — a flood alert must not reach a workspace that deliberately
    // narrowed what it watches.
    getConnectorConfig.mockResolvedValue({ eventCategories: ["extreme_heat"] });

    await runWeatherEventDetection(source as never, {} as never, NOW);

    // Nothing survived the filter, so persistence receives an empty candidate set.
    expect(captured()).toHaveLength(0);
  });

  it("falls back to the default categories when the config lists none we know", async () => {
    // Deliberate: an unparseable list means "not configured", not "watch
    // nothing" — watching nothing is indistinguishable from a quiet week.
    getConnectorConfig.mockResolvedValue({ eventCategories: ["fire"] });

    await runWeatherEventDetection(source as never, {} as never, NOW);

    expect(captured()).toHaveLength(1);
  });

  it("still detects when the config lookup fails", async () => {
    // A connector-config read error must degrade to "no persona", not to a
    // scan that drops storm coverage entirely.
    getConnectorConfig.mockRejectedValue(new Error("boom"));

    await runWeatherEventDetection(source as never, {} as never, NOW);

    expect(captured()).toHaveLength(1);
  });
});

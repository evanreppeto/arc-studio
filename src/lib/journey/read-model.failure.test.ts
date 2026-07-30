/**
 * Forced-failure tests for the journey read-model (BSR-575).
 *
 * The bug these lock out was found by renaming a table away and reloading the
 * page: `contacts` produced a banner, `journey_touchpoints` produced a normal
 * looking page. Six of the seven queries inspected their error and discarded it,
 * so a broken attribution surface reported `status: "live"` with zero revenue
 * and no touchpoints — a confident false statement about a customer's history.
 *
 * These drive the same failure through a stub client, one table at a time, so
 * the next person to add a query here cannot quietly re-open the hole.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseQueryMock, type MockResponse } from "@/lib/repos/__tests__/test-helpers";

import { getJourneysReadModel } from "./read-model";

afterEach(() => vi.unstubAllEnvs());

/** Every table the read-model touches, all healthy. */
const HEALTHY: Record<string, MockResponse> = {
  contacts: { data: [{ id: "c1", full_name: "Dana Reed", email: "dana@example.com", persona: null, created_at: "2026-07-01T00:00:00Z" }], error: null },
  engagement_events: { data: [], error: null },
  leads: { data: [], error: null },
  jobs: { data: [], error: null },
  outcomes: { data: [], error: null },
  journey_identities: { data: [], error: null },
  journey_touchpoints: { data: [], error: null },
};

const TABLES = Object.keys(HEALTHY);

function clientWithFailure(table: string) {
  return createSupabaseQueryMock({
    ...HEALTHY,
    [table]: { data: null, error: { message: `relation "${table}" does not exist` } },
  });
}

describe("journey read-model: a failed query is never rendered as empty", () => {
  // Demo mode OFF everywhere here: demo fallback on an ERROR would reintroduce
  // exactly the confident-but-wrong page these tests exist to prevent.
  it.each(TABLES)("reports failure when %s cannot be read", async (table) => {
    vi.stubEnv("ARC_DEMO_DATA", "0");
    const result = await getJourneysReadModel(clientWithFailure(table), "org-1");

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    // The message has to name the table, or the banner sends an operator
    // hunting through seven possible sources.
    expect(result.message).toContain(table);
  });

  it("names every failed source, not just the first", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "0");
    const client = createSupabaseQueryMock({
      ...HEALTHY,
      outcomes: { data: null, error: { message: "boom" } },
      journey_touchpoints: { data: null, error: { message: "boom" } },
    });

    const result = await getJourneysReadModel(client, "org-1");
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.message).toContain("outcomes");
    expect(result.message).toContain("journey_touchpoints");
  });

  it("still reports failure with demo data enabled", async () => {
    // The demo fallback lives on the empty path, not the error path. If that
    // ever moves, a broken prod read starts rendering a fabricated journey.
    vi.stubEnv("ARC_DEMO_DATA", "1");
    const result = await getJourneysReadModel(clientWithFailure("outcomes"), "org-1");
    expect(result.status).toBe("unavailable");
  });

  it("reads healthy when nothing is broken", async () => {
    // The other half of the contract: this must not cry wolf on an empty
    // workspace, which is the state most tenants are actually in.
    vi.stubEnv("ARC_DEMO_DATA", "0");
    const result = await getJourneysReadModel(createSupabaseQueryMock(HEALTHY), "org-1");
    expect(result.status).toBe("live");
  });
});

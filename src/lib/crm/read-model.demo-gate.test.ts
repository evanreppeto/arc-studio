/**
 * Demo-gate tests for CRM read-model.
 * Verifies the isDemoDataEnabled() flag controls demo fallbacks:
 *   - flag OFF + empty live data → real empty result (no demo- IDs)
 *   - flag ON  + empty live data → demo bundle (regression: existing behavior)
 *
 * ERROR paths are different, and changed deliberately in BSR-575: a failed read
 * now reports failure REGARDLESS of the flag. The four "flag ON + DB error →
 * demo" cases below used to assert the opposite. That behaviour was never
 * argued for — #182/#220 were fixing the flag-OFF leak into real workspaces and
 * carried flag-ON along unchanged — and it is what made this class of bug
 * unfindable, since every launch.json config sets ARC_DEMO_DATA=1 and so no
 * local forced-failure test could ever make these reads fail.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { getCrmNavCounts, getCrmObjectData, getCrmOverviewData, getCrmRecordData } from "./read-model";

afterEach(() => vi.unstubAllEnvs());

// ---------------------------------------------------------------------------
// Empty Supabase response (live DB, zero rows)
// ---------------------------------------------------------------------------
function emptyClient() {
  return createSupabaseQueryMock({
    companies: { data: [], error: null },
    contacts: { data: [], error: null },
    properties: { data: [], error: null },
    leads: { data: [], error: null },
    jobs: { data: [], error: null },
    outcomes: { data: [], error: null },
  });
}

function emptyCountClient() {
  return createSupabaseQueryMock({
    companies: { data: [], error: null, count: 0 },
    contacts: { data: [], error: null, count: 0 },
    properties: { data: [], error: null, count: 0 },
    leads: { data: [], error: null, count: 0 },
    jobs: { data: [], error: null, count: 0 },
    outcomes: { data: [], error: null, count: 0 },
  });
}

// A live DB read that errors (e.g. prod schema drift). getCrmTableBundle/countRows
// throw on a Supabase error, so this drives the read-model's catch branch.
function erroringClient() {
  return createSupabaseQueryMock({
    companies: { data: null, error: { message: "boom" } },
    contacts: { data: [], error: null },
    properties: { data: [], error: null },
    leads: { data: [], error: null },
    jobs: { data: [], error: null },
    outcomes: { data: [], error: null },
  });
}

// ---------------------------------------------------------------------------
// getCrmOverviewData
// ---------------------------------------------------------------------------
describe("getCrmOverviewData demo gate", () => {
  it("flag OFF + empty live read → real empty live result (no demo- row IDs)", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "0");
    const result = await getCrmOverviewData(emptyClient());

    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    expect(result.rows).toHaveLength(0);
    expect(result.rows.every((row) => !row.id.startsWith("demo-"))).toBe(true);
  });

  it("flag ON + empty live read → demo bundle (regression)", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "1");
    const result = await getCrmOverviewData(emptyClient());

    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    // Demo bundle has leads — rows should be present
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.some((row) => row.id.startsWith("demo-"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getCrmObjectData
// ---------------------------------------------------------------------------
describe("getCrmObjectData demo gate", () => {
  it("flag OFF + empty live read → real empty object (count 0, no demo- rows)", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "0");
    const result = await getCrmObjectData("companies", emptyClient());

    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    expect(result.count).toBe(0);
    expect(result.sampleRows).toHaveLength(0);
  });

  it("flag ON + empty live read → demo object (regression)", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "1");
    const result = await getCrmObjectData("companies", emptyClient());

    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    expect(result.count).toBeGreaterThan(0);
    expect(result.sampleRows.some((row) => row.id.startsWith("demo-"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getCrmNavCounts
// ---------------------------------------------------------------------------
describe("getCrmNavCounts demo gate", () => {
  it("flag OFF + empty live counts → real zero counts (no demo data)", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "0");
    const result = await getCrmNavCounts(emptyCountClient());

    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    expect(result.counts.companies).toBe(0);
    expect(result.counts.leads).toBe(0);
  });

  it("flag ON + empty live counts → demo counts (regression)", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "1");
    const result = await getCrmNavCounts(emptyCountClient());

    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    expect(result.counts.companies).toBeGreaterThan(0);
    expect(result.counts.leads).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getCrmRecordData
// ---------------------------------------------------------------------------
describe("getCrmRecordData demo gate", () => {
  it("flag OFF + empty live data → not_found (no demo record substituted)", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "0");
    const result = await getCrmRecordData("companies", "nonexistent-id", emptyClient());

    expect(result.status).toBe("not_found");
  });

  it("flag ON + empty live data → demo record returned (regression)", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "1");
    const result = await getCrmRecordData("companies", "demo-co-northside-plumbing", emptyClient());

    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    expect(result.id).toBe("demo-co-northside-plumbing");
  });
});

// ---------------------------------------------------------------------------
// Error path (live read throws, e.g. schema drift): must report the failure,
// with or without the demo flag. Fixtures over an outage are a fabrication, not
// a degrade — and in demo mode they are invisible, which is worse.
// ---------------------------------------------------------------------------
describe("CRM read-model error fallback gate", () => {
  it("getCrmOverviewData: flag OFF + DB error → unavailable (no demo)", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "0");
    const result = await getCrmOverviewData(erroringClient());
    expect(result.status).toBe("unavailable");
  });

  it("getCrmOverviewData: flag ON + DB error → still unavailable (BSR-575)", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "1");
    const result = await getCrmOverviewData(erroringClient());
    expect(result.status).toBe("unavailable");
  });

  it("getCrmObjectData: flag OFF + DB error → unavailable (no demo)", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "0");
    const result = await getCrmObjectData("companies", erroringClient());
    expect(result.status).toBe("unavailable");
  });

  it("getCrmObjectData: flag ON + DB error → still unavailable (BSR-575)", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "1");
    const result = await getCrmObjectData("companies", erroringClient());
    expect(result.status).toBe("unavailable");
  });

  it("getCrmNavCounts: flag OFF + DB error → unavailable (no demo)", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "0");
    const result = await getCrmNavCounts(erroringClient());
    expect(result.status).toBe("unavailable");
  });

  it("getCrmNavCounts: flag ON + DB error → still unavailable (BSR-575)", async () => {
    // The one that "could not be made to fail": it reported status "live"
    // alongside demo counts, so callers were told the read had succeeded.
    vi.stubEnv("ARC_DEMO_DATA", "1");
    const result = await getCrmNavCounts(erroringClient());
    expect(result.status).toBe("unavailable");
  });

  it("getCrmRecordData: flag OFF + DB error → unavailable (no demo)", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "0");
    const result = await getCrmRecordData("companies", "demo-co-northside-plumbing", erroringClient());
    expect(result.status).toBe("unavailable");
  });

  it("getCrmRecordData: flag ON + DB error → still unavailable (BSR-575)", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "1");
    const result = await getCrmRecordData("companies", "demo-co-northside-plumbing", erroringClient());
    expect(result.status).toBe("unavailable");
  });
});

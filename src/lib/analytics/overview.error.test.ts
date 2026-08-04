import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseQueryMock, type MockResponse } from "@/lib/repos/__tests__/test-helpers";


// Static, not `await import(…)` inside each test: `vi.mock` is hoisted above
// imports, so the mocks apply either way. The dynamic form bought nothing and
// charged this file's module transform to whichever test ran first (BSR-739).
import { getAnalyticsOverview } from "./overview";

const state: { configured: boolean; responses: Record<string, MockResponse> } = {
  configured: true,
  responses: {},
};

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: () => state.configured,
  getSupabaseAdminClient: () => createSupabaseQueryMock(state.responses),
}));


const ok = (data: unknown): MockResponse => ({ data, error: null });
const boom = (message: string): MockResponse => ({ data: null, error: { message } });

function setTables(over: Partial<Record<"leads" | "jobs" | "outcomes", MockResponse>>) {
  state.responses = { leads: ok([]), jobs: ok([]), outcomes: ok([]), ...over };
}

afterEach(() => {
  vi.restoreAllMocks();
  state.configured = true;
});

/**
 * The failure this pins: postgrest reports errors in `{ error }` instead of
 * throwing, so reading only `.data ?? []` turned an RLS denial or a timeout into a
 * page of zeros rendered under "org-scoped, straight from CRM" — indistinguishable
 * from a workspace that genuinely has no data.
 */
describe("getAnalyticsOverview — a failed CRM read is not an empty workspace", () => {
  it("reports dataError when the leads query errors", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setTables({ leads: boom("permission denied for table leads") });
    const result = await getAnalyticsOverview("org-1", 30);
    expect(result.dataError).toBeTruthy();
    expect(result.dataError).toContain("leads");
  });

  it("reports dataError for jobs and outcomes too, naming each failed table", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setTables({ jobs: boom("timeout"), outcomes: boom("timeout") });
    const result = await getAnalyticsOverview("org-1", 30);
    expect(result.dataError).toContain("jobs");
    expect(result.dataError).toContain("outcomes");
  });

  it("logs the underlying provider message so the cause is diagnosable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setTables({ leads: boom("permission denied for table leads") });
    await getAnalyticsOverview("org-1", 30);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("permission denied for table leads"));
  });

  it("leaves dataError unset when the queries genuinely return nothing", async () => {
    setTables({});
    const result = await getAnalyticsOverview("org-1", 30);
    // An empty workspace is a legitimate state and must stay distinguishable
    // from a failed read — this is the whole point of the flag.
    expect(result.dataError ?? null).toBeNull();
  });

  it("does not present a failed read as real rows", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setTables({ outcomes: boom("nope") });
    const result = await getAnalyticsOverview("org-1", 30);
    expect(result.revenueByPersona).toEqual([]);
    expect(result.hasHistory).toBe(false);
  });
});

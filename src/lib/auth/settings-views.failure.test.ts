/**
 * The three settings reads must report a failure, not render it as empty
 * (BSR-578).
 *
 * These were the tail of BSR-575, in a shape that ticket's census could not
 * find: a swallowed exception rather than an uninspected `error` field. All
 * three had an empty `catch` with no report, no message and no log, so in prod
 * — where ARC_DEMO_DATA is unset — a failure rendered as "your team has no
 * members", an account with no workspaces, and a generic brand kit shown as if
 * it were the tenant's own.
 */
import { afterEach, describe, expect, it, vi } from "vitest";


// Static, not `await import(…)` inside each test: `vi.mock` is hoisted above
// imports, so the mocks apply either way. The dynamic form bought nothing and
// charged this file's module transform to whichever test ran first (BSR-739).
import { getSettingsTeamView } from "./team-view";
import { getSettingsWorkspacesView } from "./workspaces-view";
import { reportDegraded } from "@/lib/observability/report-degraded";

vi.mock("@/lib/supabase/server", () => ({ isSupabaseAdminConfigured: () => true }));
vi.mock("@/lib/demo/demo-mode", () => ({ isDemoDataEnabled: () => false }));
vi.mock("@/lib/observability/report-degraded", () => ({ reportDegraded: vi.fn() }));

const BOOM = new Error("relation \"workspace_members\" does not exist");

vi.mock("./workspace", () => ({
  getCurrentWorkspaceContext: async () => {
    throw BOOM;
  },
}));
vi.mock("./workspace-admin", () => ({
  listWorkspacesForUser: async () => {
    throw BOOM;
  },
}));
vi.mock("./workspace-invites", () => ({ listWorkspaceTeamAccess: async () => ({ ok: true, members: [], invites: [] }) }));
vi.mock("./workspace-activity", () => ({ listWorkspaceActivity: async () => [] }));

afterEach(() => vi.clearAllMocks());

describe("a failed team read says so", () => {
  it("reports the failure instead of an empty team", async () => {
    const view = await getSettingsTeamView();

    // The distinction that matters: not "0 members" but "we do not know".
    expect(view.failed).toBeTruthy();
    expect(view.failed).toContain("workspace_members");
    expect(view.members).toEqual([]);
  });

  it("tells someone about it", async () => {
    await getSettingsTeamView();

    // The old empty catch left no trace anywhere — no Sentry event, no log line.
    expect(reportDegraded).toHaveBeenCalled();
  });
});

describe("a failed workspace list says so", () => {
  it("reports the failure instead of an empty list", async () => {
    const view = await getSettingsWorkspacesView();

    // This one also feeds the app shell's switcher, so an erased failure reads
    // as "this account has one workspace" on every page.
    expect(view.failed).toBeTruthy();
    expect(view.workspaces).toEqual([]);
  });
});

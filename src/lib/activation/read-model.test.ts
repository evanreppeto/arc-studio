import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdminClient: vi.fn(),
  isSupabaseAdminConfigured: vi.fn(),
}));

import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { getActivationState } from "./read-model";

const getAdmin = vi.mocked(getSupabaseAdminClient);
const configured = vi.mocked(isSupabaseAdminConfigured);

type TableSpec = { single?: unknown; count?: number | null; error?: { message: string } | null };

function fakeDb(spec: Record<string, TableSpec>) {
  return {
    from(table: string) {
      const conf = spec[table] ?? {};
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: conf.single ?? null, error: conf.error ?? null }),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve({ count: conf.count ?? null, error: conf.error ?? null }).then(resolve, reject),
      };
      return chain;
    },
  };
}

beforeEach(() => {
  configured.mockReset().mockReturnValue(true);
  getAdmin.mockReset();
});

describe("getActivationState", () => {
  it("returns all-false signals and an empty checklist when Supabase is not configured", async () => {
    configured.mockReturnValue(false);

    const state = await getActivationState("org-1", "ws-1");

    expect(state.signals).toEqual({
      hasRecords: false,
      brandCaptured: false,
      dismissed: false,
      hasMedia: false,
      hasCampaign: false,
      hasTeammate: false,
    });
    expect(state.checklist.coreDone).toBe(false);
    expect(state.checklist.showChecklist).toBe(true);
  });

  it("derives signals from the onboarding row and existence counts", async () => {
    getAdmin.mockReturnValue(
      fakeDb({
        org_onboarding_state: { single: { brand_captured_at: "2026-06-22T00:00:00Z", dismissed_at: null } },
        contacts: { count: 12 },
        companies: { count: 0 },
        media_assets: { count: 3 },
        campaigns: { count: 0 },
        workspace_memberships: { count: 1 },
      }) as never,
    );

    const state = await getActivationState("org-1", "ws-1");

    expect(state.signals).toEqual({
      hasRecords: true,
      brandCaptured: true,
      dismissed: false,
      hasMedia: true,
      hasCampaign: false,
      hasTeammate: false,
    });
    // Core is records, not brand.
    expect(state.checklist.coreDone).toBe(true);
  });

  it("counts a teammate only when more than one active member exists", async () => {
    getAdmin.mockReturnValue(
      fakeDb({
        org_onboarding_state: { single: null },
        contacts: { count: 0 },
        companies: { count: 0 },
        media_assets: { count: 0 },
        campaigns: { count: 0 },
        workspace_memberships: { count: 2 },
      }) as never,
    );

    const state = await getActivationState("org-1", "ws-1");

    expect(state.signals.hasTeammate).toBe(true);
  });

  it("defaults a signal to false when its query errors", async () => {
    getAdmin.mockReturnValue(
      fakeDb({
        org_onboarding_state: { single: { brand_captured_at: null, dismissed_at: null } },
        media_assets: { error: { message: "boom" } },
        campaigns: { count: 0 },
        workspace_memberships: { count: 0 },
      }) as never,
    );

    const state = await getActivationState("org-1", "ws-1");

    expect(state.signals.hasMedia).toBe(false);
});

  // An owner may start from a company list rather than contacts; requiring both
  // would leave the blocking step unfinished for someone who already did the
  // useful thing.
  it("counts companies alone as having records", async () => {
    getAdmin.mockReturnValue(
      fakeDb({
        org_onboarding_state: { single: null },
        contacts: { count: 0 },
        companies: { count: 4 },
        media_assets: { count: 0 },
        campaigns: { count: 0 },
        workspace_memberships: { count: 1 },
      }) as never,
    );

    const state = await getActivationState("org-1", "ws-1");

    expect(state.signals.hasRecords).toBe(true);
    expect(state.checklist.coreDone).toBe(true);
    expect(state.checklist.nextStep).toBe("brand");
  });
});

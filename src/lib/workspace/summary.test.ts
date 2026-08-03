import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Per-table exact counts, keyed by table name. `null` simulates a count that
 * cannot be read — which must surface as unknown, never as 0 (BSR-678).
 */
let countByTable: Record<string, number | null> = {};

/** Minimal stand-in for `.from(t).select(_, {count,head}).eq(col, id)`. */
function makeDbStub() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: async () =>
          countByTable[table] === null
            ? { count: null, error: { message: `count failed for ${table}` } }
            : { count: countByTable[table] ?? 0, error: null },
      }),
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdminClient: vi.fn(() => makeDbStub()),
  isSupabaseAdminConfigured: vi.fn(() => true),
}));
vi.mock("@/lib/brand-kit/persistence", () => ({
  getBusinessProfile: vi.fn(),
  listPersonaDefinitions: vi.fn(),
}));
vi.mock("@/lib/brand-kit/read-model", () => ({ getBusinessContext: vi.fn() }));
vi.mock("@/lib/connectors/read-model", () => ({ listWorkspaceConnectors: vi.fn() }));
vi.mock("@/lib/approvals/read-model", () => ({ countActiveApprovals: vi.fn() }));
vi.mock("@/lib/media-library/arc-handoff", () => ({ listAvailableArcMedia: vi.fn() }));

import { getBusinessProfile, listPersonaDefinitions } from "@/lib/brand-kit/persistence";
import { listWorkspaceConnectors } from "@/lib/connectors/read-model";
import { countActiveApprovals } from "@/lib/approvals/read-model";
import { listAvailableArcMedia } from "@/lib/media-library/arc-handoff";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { getWorkspaceSummary } from "./summary";

const profileMock = vi.mocked(getBusinessProfile);
const personasMock = vi.mocked(listPersonaDefinitions);
const connectorsMock = vi.mocked(listWorkspaceConnectors);
const approvalsMock = vi.mocked(countActiveApprovals);
const mediaMock = vi.mocked(listAvailableArcMedia);

beforeEach(() => {
  profileMock.mockResolvedValue({ status: "draft" } as never);
  personasMock.mockResolvedValue([{ key: "a" }, { key: "b" }] as never);
  connectorsMock.mockResolvedValue([
    { credentialPresent: true },
    { credentialPresent: false },
    { credentialPresent: true },
  ] as never);
  approvalsMock.mockResolvedValue(4);
  mediaMock.mockResolvedValue([{ id: "m1" }, { id: "m2" }] as never);
  countByTable = { contacts: 243, companies: 12, leads: 0, campaigns: 3 };
});
afterEach(() => vi.clearAllMocks());

describe("getWorkspaceSummary", () => {
  it("aggregates a compact snapshot", async () => {
    const s = await getWorkspaceSummary("org_1", "ws_1");
    expect(s).toEqual({
      brandKit: "draft",
      connectors: { connected: 2, total: 3 },
      mediaAvailable: 2,
      pendingApprovals: 4,
      personas: 2,
      records: { contacts: 243, companies: 12, leads: 0, campaigns: 3 },
      dismissalPatterns: [],
    });
  });

  it("reports brandKit none when there is no profile", async () => {
    profileMock.mockResolvedValue(null);
    const s = await getWorkspaceSummary("org_1", "ws_1");
    expect(s.brandKit).toBe("none");
  });

  it("falls back per-field when a source throws (never breaks the turn)", async () => {
    connectorsMock.mockRejectedValue(new Error("connectors down"));
    approvalsMock.mockRejectedValue(new Error("approvals down"));
    const s = await getWorkspaceSummary("org_1", "ws_1");
    expect(s.connectors).toEqual({ connected: 0, total: 0 });
    expect(s.pendingApprovals).toBe(0);
    expect(s.brandKit).toBe("draft"); // unaffected source still resolves
  });

  it("returns a neutral snapshot without reading when Supabase is unconfigured", async () => {
    vi.mocked(isSupabaseAdminConfigured).mockReturnValueOnce(false);
    const s = await getWorkspaceSummary("org_1", "ws_1");
    expect(s).toEqual({
      brandKit: "none",
      connectors: { connected: 0, total: 0 },
      mediaAvailable: 0,
      pendingApprovals: 0,
      personas: 0,
      // Unconfigured means unknown, not empty.
      records: { contacts: null, companies: null, leads: null, campaigns: null },
      dismissalPatterns: [],
    });
    expect(getBusinessProfile).not.toHaveBeenCalled();
  });
});

/**
 * BSR-678: Arc told an operator the CRM was empty 85 minutes after 243 contacts
 * were imported. This snapshot is injected into the prompt every turn and
 * carried no record counts, so the only CRM figure available to the model was a
 * remembered one.
 */
describe("live record counts", () => {
  it("reads counts for the tenancy column each table actually uses", async () => {
    const s = await getWorkspaceSummary("org_1", "ws_1");
    expect(s.records).toEqual({ contacts: 243, companies: 12, leads: 0, campaigns: 3 });
  });

  it("reports an unreadable count as null, not as zero", async () => {
    countByTable = { contacts: null, companies: 12, leads: null, campaigns: 3 };
    const s = await getWorkspaceSummary("org_1", "ws_1");
    // The whole point: "we could not read it" must not render as "there are none".
    expect(s.records.contacts).toBeNull();
    expect(s.records.leads).toBeNull();
    expect(s.records.companies).toBe(12);
  });

  it("keeps a genuine zero as zero", async () => {
    countByTable = { contacts: 0, companies: 0, leads: 0, campaigns: 0 };
    const s = await getWorkspaceSummary("org_1", "ws_1");
    expect(s.records).toEqual({ contacts: 0, companies: 0, leads: 0, campaigns: 0 });
  });

  it("still returns the rest of the snapshot when every count fails", async () => {
    countByTable = { contacts: null, companies: null, leads: null, campaigns: null };
    const s = await getWorkspaceSummary("org_1", "ws_1");
    expect(s.brandKit).toBe("draft");
    expect(s.pendingApprovals).toBe(4);
  });
});

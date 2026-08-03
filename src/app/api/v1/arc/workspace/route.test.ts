import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({
    orgId: "org_1",
    orgSlug: "big-shoulders-restoration",
    orgName: "Big Shoulders Restoration",
    workspaceId: "workspace_1",
    workspaceKey: "default",
    workspaceSlug: "default",
    workspaceName: "Default",
    role: null,
    userId: null,
    source: "default-org",
  })),
}));
vi.mock("@/lib/workspace/summary", () => ({
  getWorkspaceSummary: vi.fn(),
  getWorkspaceSettingsDetail: vi.fn(),
}));

import { getWorkspaceSummary, getWorkspaceSettingsDetail } from "@/lib/workspace/summary";
import { GET } from "./route";

const summaryMock = vi.mocked(getWorkspaceSummary);
const detailMock = vi.mocked(getWorkspaceSettingsDetail);

function req(url: string, authorization: string | undefined) {
  return new Request(url, { headers: { ...(authorization ? { authorization } : {}) } });
}

const env = {
  ARC_AGENT_API_TOKEN: process.env.ARC_AGENT_API_TOKEN,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};
function configure() {
  process.env.ARC_AGENT_API_TOKEN = "secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
}

beforeEach(() => {
  summaryMock.mockReset();
  detailMock.mockReset();
  summaryMock.mockResolvedValue({
    brandKit: "active",
    connectors: { connected: 1, total: 2 },
    mediaAvailable: 7,
    pendingApprovals: 3,
    personas: 5,
    records: { contacts: 243, companies: 12, leads: 0, campaigns: 3 },
    dismissalPatterns: [],
  });
  detailMock.mockResolvedValue({
    brandKit: "active",
    connectors: { connected: 1, total: 2 },
    mediaAvailable: 7,
    pendingApprovals: 3,
    personas: 5,
    records: { contacts: 243, companies: 12, leads: 0, campaigns: 3 },
    dismissalPatterns: [],
    connectorList: [],
    personaList: [],
    compliance: { disallowedClaims: ["guarantee"], complianceNotes: "" },
    identity: { tagline: null, websiteUrl: null, serviceAreas: [] },
  });
});
afterEach(() => {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("GET /api/v1/arc/workspace", () => {
  it("401s without a valid token and never reads", async () => {
    process.env.ARC_AGENT_API_TOKEN = "secret";
    const res = await GET(req("http://localhost/api/v1/arc/workspace", "Bearer wrong"));
    expect(res.status).toBe(401);
    expect(summaryMock).not.toHaveBeenCalled();
  });

  it("returns the compact snapshot by default", async () => {
    configure();
    const res = await GET(req("http://localhost/api/v1/arc/workspace", "Bearer secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, workspace: { brandKit: "active", personas: 5 } });
    expect(summaryMock).toHaveBeenCalledWith("org_1", "workspace_1");
    expect(detailMock).not.toHaveBeenCalled();
  });

  it("returns the full detail when detail=full", async () => {
    configure();
    const res = await GET(req("http://localhost/api/v1/arc/workspace?detail=full", "Bearer secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, workspace: { compliance: { disallowedClaims: ["guarantee"] } } });
    expect(detailMock).toHaveBeenCalledWith("org_1", "workspace_1");
  });
});

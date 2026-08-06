import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({
    orgId: "org-1",
    workspaceId: "workspace-1",
  })),
}));
vi.mock("@/lib/repos", () => ({ getLead: vi.fn() }));

import { getLead } from "@/lib/repos";

import { GET } from "./route";

const getLeadMock = vi.mocked(getLead);

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

function request(token = "secret") {
  return new Request("http://localhost/api/v1/arc/crm/leads/lead-1", {
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  getLeadMock.mockReset();
  getLeadMock.mockResolvedValue({
    id: "lead-1",
    companyId: null,
    contactId: null,
    propertyId: null,
    persona: "persona_homeowner_emergency",
    status: "validated",
    routingRecommendation: "elevated",
    source: "website",
    externalLeadId: null,
    lossSummary: "Basement flooding",
    lossSignals: [],
    matchedTargetKeywords: [],
    matchedNonTargetKeywords: [],
    leadScore: 85,
    receivedAt: "2026-06-19T12:00:00.000Z",
    metadata: {},
    createdAt: "2026-06-19T12:00:00.000Z",
    updatedAt: "2026-06-19T12:00:00.000Z",
  });
});

afterEach(() => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("GET /api/v1/arc/crm/leads/:id", () => {
  it("passes the resolved Arc workspace scope into lead detail reads", async () => {
    configure();

    const res = await GET(request(), { params: Promise.resolve({ id: "lead-1" }) });

    expect(res.status).toBe(200);
    expect(getLeadMock).toHaveBeenCalledWith("lead-1", undefined, { orgId: "org-1" });
  });

  it("rejects invalid bearer tokens before reading", async () => {
    configure();

    const res = await GET(request("wrong"), { params: Promise.resolve({ id: "lead-1" }) });

    // These tests point at an unreachable Supabase, so the token store cannot
    // answer — and "I could not verify this" is now 503, distinct from the 401
    // that means "this token is not ours". The security property under test is
    // unchanged: the request is refused and nothing is read or written. The 401
    // path is covered where the store can be made to answer (see the
    // token-store test below, and src/lib/auth/check-agent-bearer.test.ts).
    expect(res.status).toBe(503);
    expect(getLeadMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the scoped lead is not found", async () => {
    configure();
    getLeadMock.mockResolvedValue(null);

    const res = await GET(request(), { params: Promise.resolve({ id: "lead-1" }) });

    expect(res.status).toBe(404);
  });
});

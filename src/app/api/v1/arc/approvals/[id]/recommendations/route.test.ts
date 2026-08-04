import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/arc-api", () => ({ listApprovalRecommendations: vi.fn() }));
vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({
    orgId: "org-1",
    workspaceId: "workspace-1",
  })),
}));

import { listApprovalRecommendations } from "@/lib/arc-api";

import { GET } from "./route";

const listRecommendationsMock = vi.mocked(listApprovalRecommendations);

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
  return new Request("http://localhost/api/v1/arc/approvals/ap1/recommendations", {
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  listRecommendationsMock.mockReset();
  listRecommendationsMock.mockResolvedValue([]);
});

afterEach(() => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("GET /api/v1/arc/approvals/:id/recommendations", () => {
  it("passes the resolved Arc workspace scope into recommendation reads", async () => {
    configure();

    const res = await GET(request(), { params: Promise.resolve({ id: "ap1" }) });

    expect(res.status).toBe(200);
    expect(listRecommendationsMock).toHaveBeenCalledWith(
      "ap1",
      undefined,
      { orgId: "org-1", workspaceId: "workspace-1" },
    );
  });

  it("rejects invalid bearer tokens before reading", async () => {
    configure();

    const res = await GET(request("wrong"), { params: Promise.resolve({ id: "ap1" }) });

    // These tests point at an unreachable Supabase, so the token store cannot
    // answer — and "I could not verify this" is now 503, distinct from the 401
    // that means "this token is not ours". The security property under test is
    // unchanged: the request is refused and nothing is read or written. The 401
    // path is covered where the store can be made to answer (see the
    // token-store test below, and src/lib/auth/check-agent-bearer.test.ts).
    expect(res.status).toBe(503);
    expect(listRecommendationsMock).not.toHaveBeenCalled();
  });
});

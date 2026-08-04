import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/arc-api", () => ({ listApprovalsForApi: vi.fn() }));
// The token store, stubbed so it ANSWERS instead of being unreachable — that is
// what separates "not ours" (401) from "could not check" (503).
vi.mock("@/lib/agent/tokens", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/tokens")>()),
  verifyAgentToken: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const })),
  hasActiveAgentTokens: vi.fn(async () => true),
}));
vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({
    orgId: "org-1",
    workspaceId: "workspace-1",
  })),
}));

import { listApprovalsForApi } from "@/lib/arc-api";
import { verifyAgentToken } from "@/lib/agent/tokens";

import { GET } from "./route";

const listApprovalsMock = vi.mocked(listApprovalsForApi);

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

function request(url = "http://localhost/api/v1/arc/approvals?status=pending_approval&limit=20", token = "secret") {
  return new Request(url, { headers: { authorization: `Bearer ${token}` } });
}

beforeEach(() => {
  listApprovalsMock.mockReset();
  listApprovalsMock.mockResolvedValue([]);
});

afterEach(() => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("GET /api/v1/arc/approvals", () => {
  it("passes the resolved Arc workspace scope into approval reads", async () => {
    configure();

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(listApprovalsMock).toHaveBeenCalledWith(
      { statuses: ["pending_approval"], limit: 20 },
      undefined,
      { orgId: "org-1", workspaceId: "workspace-1" },
    );
  });

  it("rejects invalid bearer tokens before reading", async () => {
    configure();

    const res = await GET(request("http://localhost/api/v1/arc/approvals", "wrong"));

    // The store answered: no such token. That is a verdict, and it is fatal.
    expect(res.status).toBe(401);
    expect(listApprovalsMock).not.toHaveBeenCalled();
  });

  // The other half of the same gate. A caller holding a good credential was
  // being told it was invalid whenever the store hiccuped — fatal-looking, and
  // on 2026-08-04 it stranded a finished opportunity scan as `queued`. Refusing
  // is still right; calling it "unauthorized" was not.
  it("refuses without reading, but does not call the token invalid, when the store is unreachable", async () => {
    configure();
    vi.mocked(verifyAgentToken).mockRejectedValueOnce(new Error("connection reset"));

    const res = await GET(request("http://localhost/api/v1/arc/approvals", "sk_live_good"));

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, status: "unavailable" });
    expect(listApprovalsMock).not.toHaveBeenCalled();
  });
});

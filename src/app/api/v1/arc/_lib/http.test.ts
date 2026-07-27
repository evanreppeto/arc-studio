import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/api-token", () => ({ checkAgentBearer: vi.fn() }));
vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(),
  resolveWorkspaceScopeById: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdminClient: vi.fn(),
  isSupabaseAdminConfigured: vi.fn(() => true),
}));

import { checkAgentBearer } from "@/lib/auth/api-token";
import { getCurrentWorkspaceContext, resolveWorkspaceScopeById } from "@/lib/auth/workspace";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

import { arcGuard } from "./http";

const checkAgentBearerMock = vi.mocked(checkAgentBearer);
const getCurrentWorkspaceContextMock = vi.mocked(getCurrentWorkspaceContext);
const resolveWorkspaceScopeByIdMock = vi.mocked(resolveWorkspaceScopeById);
const getSupabaseAdminClientMock = vi.mocked(getSupabaseAdminClient);

const request = new Request("http://localhost/api/v1/arc/brain/query", {
  headers: { authorization: "Bearer token" },
});

/** An env-token request that asserts a workspace via the runner headers. */
function assertedRequest(headers: Record<string, string>) {
  return new Request("http://localhost/api/v1/arc/brain/query", {
    headers: { authorization: "Bearer token", ...headers },
  });
}

describe("arcGuard", () => {
  beforeEach(() => {
    checkAgentBearerMock.mockReset();
    getCurrentWorkspaceContextMock.mockReset();
    resolveWorkspaceScopeByIdMock.mockReset();
    getSupabaseAdminClientMock.mockReset();
    getCurrentWorkspaceContextMock.mockResolvedValue({
      orgId: "org-fallback",
      orgSlug: "fallback",
      orgName: "Fallback Org",
      workspaceId: "workspace-fallback",
      workspaceKey: "default",
      workspaceSlug: "fallback",
      workspaceName: "Fallback Workspace",
      role: null,
      userId: null,
      source: "default-org",
    });
  });

  it("returns the org/workspace scope from a database-issued agent token", async () => {
    checkAgentBearerMock.mockResolvedValue({
      ok: true,
      tokenSource: "database",
      orgId: "org-token",
      workspaceId: "00000000-0000-4000-8000-000000000001",
    });

    const result = await arcGuard(request);

    expect(result).toEqual({
      ok: true,
      scope: {
        orgId: "org-token",
        workspaceId: "00000000-0000-4000-8000-000000000001",
        source: "agent-token",
      },
    });
    expect(getCurrentWorkspaceContextMock).not.toHaveBeenCalled();
  });

  // A scoped token pins the request to its own workspace — but the runner also
  // states which workspace each wake is for, and this branch used to discard
  // that. One shared runner holding one workspace's token would then accept
  // another tenant's work and file it here, with no error and the wrong tenant.
  it("refuses when a database token is scoped to a different workspace than the request asserts", async () => {
    checkAgentBearerMock.mockResolvedValue({
      ok: true,
      tokenSource: "database",
      orgId: "org-token",
      workspaceId: "00000000-0000-4000-8000-000000000001",
    });

    const result = await arcGuard(
      assertedRequest({ "x-arc-workspace-id": "00000000-0000-4000-8000-0000000000ff" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.response.status).toBe(409);
    await expect(result.response.json()).resolves.toMatchObject({ status: "workspace_mismatch" });
  });

  it("accepts a database token when the asserted workspace agrees with it", async () => {
    checkAgentBearerMock.mockResolvedValue({
      ok: true,
      tokenSource: "database",
      orgId: "org-token",
      workspaceId: "00000000-0000-4000-8000-000000000001",
    });

    const result = await arcGuard(
      assertedRequest({ "x-arc-workspace-id": "00000000-0000-4000-8000-000000000001" }),
    );

    expect(result).toEqual({
      ok: true,
      scope: {
        orgId: "org-token",
        workspaceId: "00000000-0000-4000-8000-000000000001",
        source: "agent-token",
      },
    });
  });

  it("resolves a database token workspace key to the workspace uuid", async () => {
    checkAgentBearerMock.mockResolvedValue({
      ok: true,
      tokenSource: "database",
      orgId: "org-token",
      workspaceId: "default",
    });
    getSupabaseAdminClientMock.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "workspace-uuid" }, error: null }),
            }),
          }),
        }),
      }),
    } as never);

    const result = await arcGuard(request);

    expect(result).toEqual({
      ok: true,
      scope: {
        orgId: "org-token",
        workspaceId: "workspace-uuid",
        source: "agent-token",
      },
    });
  });

  it("falls back to the current workspace context for the legacy env token", async () => {
    checkAgentBearerMock.mockResolvedValue({ ok: true, tokenSource: "env" });

    const result = await arcGuard(request);

    expect(result).toEqual({
      ok: true,
      scope: {
        orgId: "org-fallback",
        workspaceId: "workspace-fallback",
        source: "legacy-env-token",
      },
    });
  });

  it("scopes an env-token callback to the workspace the trusted runner asserts", async () => {
    checkAgentBearerMock.mockResolvedValue({ ok: true, tokenSource: "env" });
    resolveWorkspaceScopeByIdMock.mockResolvedValue({ orgId: "org-A", workspaceId: "ws-A" });

    const result = await arcGuard(
      assertedRequest({ "x-arc-workspace-id": "ws-A", "x-arc-org-id": "org-A" }),
    );

    expect(resolveWorkspaceScopeByIdMock).toHaveBeenCalledWith("ws-A");
    expect(result).toEqual({
      ok: true,
      scope: { orgId: "org-A", workspaceId: "ws-A", source: "env-workspace-asserted" },
    });
    // The asserted path derives the workspace from the DB, not the default context.
    expect(getCurrentWorkspaceContextMock).not.toHaveBeenCalled();
  });

  it("409s when the asserted workspace is unknown/inactive", async () => {
    checkAgentBearerMock.mockResolvedValue({ ok: true, tokenSource: "env" });
    resolveWorkspaceScopeByIdMock.mockResolvedValue(null);

    const result = await arcGuard(assertedRequest({ "x-arc-workspace-id": "ws-missing" }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(409);
    expect(getCurrentWorkspaceContextMock).not.toHaveBeenCalled();
  });

  it("409s and refuses to widen scope when the asserted org doesn't match the workspace", async () => {
    checkAgentBearerMock.mockResolvedValue({ ok: true, tokenSource: "env" });
    resolveWorkspaceScopeByIdMock.mockResolvedValue({ orgId: "org-A", workspaceId: "ws-A" });

    const result = await arcGuard(
      assertedRequest({ "x-arc-workspace-id": "ws-A", "x-arc-org-id": "org-EVIL" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(409);
  });
});

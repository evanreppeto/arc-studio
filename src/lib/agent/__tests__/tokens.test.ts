import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(),
}));

import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";

import { generateToken, hashToken, issueAgentToken, verifyAgentToken } from "../tokens";

const getCurrentWorkspaceContextMock = vi.mocked(getCurrentWorkspaceContext);

beforeEach(() => {
  getCurrentWorkspaceContextMock.mockReset();
  getCurrentWorkspaceContextMock.mockResolvedValue({
    orgId: "org-1",
    orgSlug: "org",
    orgName: "Org",
    workspaceId: "workspace-uuid",
    workspaceKey: "default",
    workspaceSlug: "default",
    workspaceName: "Default",
    workspaceSubtitle: null,
    workspaceShortLabel: null,
    workspaceAccentKey: null,
    workspaceLogoUrl: null,
    role: "admin",
    userId: "user-1",
    source: "membership",
  });
});

describe("token primitives", () => {
  it("hashes deterministically to 64 hex chars", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });

  it("generates an sk_live token whose hash and prefix match the plaintext", () => {
    const token = generateToken();

    expect(token.plaintext.startsWith("sk_live_")).toBe(true);
    expect(token.prefix).toBe(token.plaintext.slice(0, 12));
    expect(token.hash).toBe(hashToken(token.plaintext));
  });
});

describe("verifyAgentToken", () => {
  function fakeClient(row: { org_id?: string; workspace_id: string; scopes?: string[] | null } | null) {
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: async () => ({ data: row, error: null }),
            }),
          }),
        }),
        update,
      }),
    } as never;
  }

  it("returns the workspace for a known, non-revoked token", async () => {
    const result = await verifyAgentToken("sk_live_known", fakeClient({ workspace_id: "default" }));

    // scopes: null = a legacy token — unrestricted, exactly as before scoping existed.
    expect(result).toEqual({ ok: true, workspaceId: "default", scopes: null });
  });

  it("returns the organization and workspace scope for a scoped token", async () => {
    const result = await verifyAgentToken("sk_live_known", fakeClient({ org_id: "org-1", workspace_id: "workspace-1" }));

    expect(result).toEqual({ ok: true, orgId: "org-1", workspaceId: "workspace-1", scopes: null });
  });

  it("surfaces a narrow token's scopes so the bearer gate can enforce them", async () => {
    const result = await verifyAgentToken(
      "sk_live_known",
      fakeClient({ org_id: "org-1", workspace_id: "workspace-1", scopes: ["leads:ingest"] }),
    );

    expect(result).toEqual({ ok: true, orgId: "org-1", workspaceId: "workspace-1", scopes: ["leads:ingest"] });
  });

  it("returns not-ok for an unknown token", async () => {
    const result = await verifyAgentToken("sk_live_nope", fakeClient(null));

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  /**
   * A failed lookup is not a verdict on the token. Both the scoped select and the
   * legacy fallback have to fail before we say so — the fallback exists for a
   * pre-scopes database and must not be mistaken for the outage case.
   */
  it("says unavailable, not not-found, when the lookup itself fails", async () => {
    const failing = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: async () => ({ data: null, error: { message: "timeout" } }),
            }),
          }),
        }),
        update: vi.fn(),
      }),
    } as never;

    const result = await verifyAgentToken("sk_live_valid_but_unverifiable", failing);

    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("issueAgentToken", () => {
  it("stores the current workspace uuid, not only the workspace key", async () => {
    let inserted: Record<string, unknown> | null = null;
    const client = {
      from: () => ({
        insert: (payload: Record<string, unknown>) => {
          inserted = payload;
          return {
            select: () => ({
              single: async () => ({
                data: {
                  id: "token-1",
                  prefix: "sk_live_test",
                  label: "Runner",
                  created_at: "2026-06-18T12:00:00.000Z",
                  last_used_at: null,
                  revoked_at: null,
                },
                error: null,
              }),
            }),
          };
        },
      }),
    } as never;

    await issueAgentToken("Runner", client);

    expect(inserted).toMatchObject({ org_id: "org-1", workspace_id: "workspace-uuid" });
  });
});

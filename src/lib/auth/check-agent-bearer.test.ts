import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkAgentBearer } from "./api-token";

function req(token?: string) {
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === "authorization" && token ? `Bearer ${token}` : null),
    },
  };
}

describe("checkAgentBearer", () => {
  const originalToken = process.env.ARC_AGENT_API_TOKEN;
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    delete process.env.ARC_AGENT_API_TOKEN;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.ARC_AGENT_API_TOKEN;
    else process.env.ARC_AGENT_API_TOKEN = originalToken;
    if (originalSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    if (originalSupabaseKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseKey;
  });

  it("accepts the env token for back-compat", async () => {
    process.env.ARC_AGENT_API_TOKEN = "env-secret";

    const result = await checkAgentBearer(req("env-secret"), { recordSeen: async () => undefined });

    expect(result).toEqual({ ok: true, tokenSource: "env" });
  });

  it("accepts a DB token when the env token does not match", async () => {
    process.env.ARC_AGENT_API_TOKEN = "env-secret";
    const verify = vi.fn().mockResolvedValue({ ok: true, orgId: "org-1", workspaceId: "workspace-1" });

    const result = await checkAgentBearer(req("sk_live_db"), {
      verify,
      anyConfigured: async () => true,
      recordSeen: async () => undefined,
    });

    expect(result).toEqual({ ok: true, tokenSource: "database", orgId: "org-1", workspaceId: "workspace-1" });
    expect(verify).toHaveBeenCalledWith("sk_live_db");
  });

  it("401s on a bad token when something is configured", async () => {
    const result = await checkAgentBearer(req("bad"), {
      verify: async () => ({ ok: false, reason: "not_found" }),
      anyConfigured: async () => true,
      recordSeen: async () => undefined,
    });

    expect(result).toEqual({ ok: false, status: 401, reason: "unauthorized" });
  });

  // 2026-08-04: the runner finished an opportunity scan, then failed to mark the
  // task complete with "401 ... requires a valid bearer token" — holding a token
  // that was, and still is, perfectly valid. Every DB-issued token is verified
  // against Supabase on EVERY request, and a failed lookup returned the same
  // answer as a wrong token. The task stayed `queued` and the scan's work was
  // stranded. "I could not check" must be retryable, not fatal.
  it("503s when the token store cannot be reached, rather than calling the token bad", async () => {
    const result = await checkAgentBearer(req("sk_live_db"), {
      verify: async () => ({ ok: false, reason: "unavailable" }),
      anyConfigured: async () => true,
      recordSeen: async () => undefined,
    });

    expect(result).toEqual({ ok: false, status: 503, reason: "unavailable" });
    expect(result).not.toMatchObject({ status: 401 });
  });

  it("still 401s an unverifiable-looking token that is simply not ours", async () => {
    const result = await checkAgentBearer(req("bad"), {
      verify: async () => ({ ok: false, reason: "not_found" }),
      anyConfigured: async () => true,
      recordSeen: async () => undefined,
    });

    expect(result).toEqual({ ok: false, status: 401, reason: "unauthorized" });
  });

  it("503s when nothing is configured", async () => {
    const result = await checkAgentBearer(req("bad"), {
      verify: async () => ({ ok: false, reason: "not_found" }),
      anyConfigured: async () => false,
      recordSeen: async () => undefined,
    });

    expect(result).toEqual({ ok: false, status: 503, reason: "not_configured" });
  });

  // Scope was verified on the ingest routes and nowhere else, so a narrow token —
  // the kind you hand to a website form or a partner — was accepted on the entire
  // Arc Operations API for its workspace.
  it("401s a narrow-scoped token on the Arc surface", async () => {
    const result = await checkAgentBearer(req("sk_live_leads"), {
      verify: async () => ({ ok: true, orgId: "org-1", workspaceId: "workspace-1", scopes: ["leads:ingest"] }),
      anyConfigured: async () => true,
      recordSeen: async () => undefined,
    });

    expect(result).toEqual({ ok: false, status: 401, reason: "unauthorized" });
  });

  it("accepts an arc:full token", async () => {
    const result = await checkAgentBearer(req("sk_live_runner"), {
      verify: async () => ({ ok: true, orgId: "org-1", workspaceId: "workspace-1", scopes: ["arc:full"] }),
      anyConfigured: async () => true,
      recordSeen: async () => undefined,
    });

    expect(result).toEqual({ ok: true, tokenSource: "database", orgId: "org-1", workspaceId: "workspace-1" });
  });

  it("accepts a legacy token whose scopes are null (unrestricted, pre-scoping)", async () => {
    const result = await checkAgentBearer(req("sk_live_legacy"), {
      verify: async () => ({ ok: true, orgId: "org-1", workspaceId: "workspace-1", scopes: null }),
      anyConfigured: async () => true,
      recordSeen: async () => undefined,
    });

    expect(result).toEqual({ ok: true, tokenSource: "database", orgId: "org-1", workspaceId: "workspace-1" });
  });

  it("does not throw while checking DB tokens when Supabase is not configured", async () => {
    await expect(checkAgentBearer(req("sk_live_unknown"), { recordSeen: async () => undefined })).resolves.toEqual({
      ok: false,
      status: 503,
      reason: "not_configured",
    });
  });
});

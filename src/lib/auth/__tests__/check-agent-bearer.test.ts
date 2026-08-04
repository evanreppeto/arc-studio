import { describe, expect, it, vi, beforeEach } from "vitest";
import { checkAgentBearer } from "../api-token";

function req(token?: string): Request {
  return new Request("https://x/api", { headers: token ? { authorization: `Bearer ${token}` } : {} });
}

describe("checkAgentBearer", () => {
  beforeEach(() => { delete process.env.ARC_AGENT_API_TOKEN; });

  it("accepts the env token (back-compat)", async () => {
    process.env.ARC_AGENT_API_TOKEN = "env-secret";
    const res = await checkAgentBearer(req("env-secret"));
    expect(res.ok).toBe(true);
  });

  it("accepts a DB token when env token does not match", async () => {
    process.env.ARC_AGENT_API_TOKEN = "env-secret";
    const verify = vi.fn().mockResolvedValue({ ok: true, workspaceId: "default" });
    const res = await checkAgentBearer(req("sk_live_db"), { verify, anyConfigured: async () => true });
    expect(res.ok).toBe(true);
    expect(verify).toHaveBeenCalledWith("sk_live_db");
  });

  it("401s on a bad token when something is configured", async () => {
    const res = await checkAgentBearer(req("nope"), { verify: async () => ({ ok: false, reason: "not_found" }), anyConfigured: async () => true });
    expect(res).toMatchObject({ ok: false, status: 401 });
  });

  it("503s when nothing is configured at all", async () => {
    const res = await checkAgentBearer(req("nope"), { verify: async () => ({ ok: false, reason: "not_found" }), anyConfigured: async () => false });
    expect(res).toMatchObject({ ok: false, status: 503 });
  });
});

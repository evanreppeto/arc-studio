import { afterEach, describe, expect, it, vi } from "vitest";

import { createArcClient } from "./arc-client";
import type { Config } from "./config";

const config: Config = {
  appApiBaseUrl: "https://app.example",
  arcAgentApiToken: "tok",
  webhookSecret: null,
  port: 8788,
  webhookPath: "/webhooks/growth-chat",
  maxConcurrentRuns: 4,
  maxConcurrentRunsPerWorkspace: 2,
  commit: null,
};

function stubFetch() {
  const fn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createArcClient tenant identity", () => {
  it("echoes the wake's workspace + org on every callback so the app scopes the write", async () => {
    const fetchMock = stubFetch();
    const client = createArcClient(config, { orgId: "org-1", workspaceId: "ws-1" });

    await client.postChatReply({ agentTaskId: "t1", body: "hi" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer tok");
    expect(headers["x-arc-workspace-id"]).toBe("ws-1");
    expect(headers["x-arc-org-id"]).toBe("org-1");
  });

  it("omits identity headers when a wake carries none (back-compat single-tenant)", async () => {
    const fetchMock = stubFetch();
    const client = createArcClient(config);

    await client.postChatReply({ agentTaskId: "t1", body: "hi" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["x-arc-workspace-id"]).toBeUndefined();
    expect(headers["x-arc-org-id"]).toBeUndefined();
  });
});

/**
 * 2026-08-04: an opportunity scan ran to completion, then failed to post its own
 * completion — one 5xx from the app, and the task stayed `queued` forever with
 * the work already done. The app verifies the runner's DB-issued token against
 * Supabase on every request, so a momentary blip there is a whole-run failure
 * unless the callback tolerates it.
 */
describe("apiPost resilience", () => {
  it("retries a 5xx and succeeds, instead of stranding the task", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ ok: false, message: "unavailable" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, status: "completed" }) });
    vi.stubGlobal("fetch", fetchMock);

    const client = createArcClient(config, { orgId: "org-1", workspaceId: "ws-1" });
    const result = await client.apiPost("/api/v1/arc/tasks/t1/complete", {});

    expect(result).toEqual({ ok: true, status: "completed" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting retries, surfacing the last status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({ ok: false }) });
    vi.stubGlobal("fetch", fetchMock);

    const client = createArcClient(config);

    await expect(client.apiPost("/api/v1/arc/tasks/t1/complete", {})).rejects.toThrow("502");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // A 401/409 is our own mistake; repeating it just makes the same wrong call
  // three times and delays the real error.
  it("does not retry a 4xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, json: async () => ({ ok: false, message: "bad token" }) });
    vi.stubGlobal("fetch", fetchMock);

    const client = createArcClient(config);

    await expect(client.apiPost("/api/v1/arc/tasks/t1/complete", {})).rejects.toThrow("401");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * The two 409s. `arcGuard` refuses a request with the same status code the claim
 * route uses for a genuine conflict, so the body's `status` is the only thing
 * that tells them apart — and getting it wrong dropped real work on prod under a
 * log line reading "skipping duplicate run" (BSR-695 follow-up).
 */
describe("claimTask tells a conflict apart from a refusal", () => {
  afterEach(() => vi.unstubAllGlobals());

  function respondWith(status: number, body: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body }),
    );
  }

  it("claims when the app says so", async () => {
    respondWith(201, { ok: true, status: "claimed" });
    await expect(createArcClient(config).claimTask("task-1")).resolves.toEqual({ claimed: true });
  });

  it("reports a real conflict as already-claimed — the only case a caller may skip", async () => {
    respondWith(409, { ok: false, status: "rejected", message: "Task is not claimable (status=running)." });
    const result = await createArcClient(config).claimTask("task-1");
    expect(result).toMatchObject({ claimed: false, reason: "already-claimed" });
  });

  it.each(["workspace_required", "workspace_mismatch"])(
    "reports a %s 409 as refused, NOT as already-claimed",
    async (guardStatus) => {
      respondWith(409, { ok: false, status: guardStatus, message: "No active workspace is available." });
      const result = await createArcClient(config).claimTask("task-1");
      expect(result).toMatchObject({ claimed: false, reason: "refused" });
    },
  );

  it("reports any other failure as refused, carrying the reason", async () => {
    respondWith(502, { ok: false, status: "failed", message: "Failed to claim task." });
    const result = await createArcClient(config).claimTask("task-1");
    expect(result).toMatchObject({ claimed: false, reason: "refused" });
    if (result.claimed === false) expect(result.detail).toContain("502");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/api-token", () => ({
  checkAgentBearer: vi.fn(async () => ({
    ok: true,
    tokenSource: "database",
    orgId: "org-2",
    workspaceId: "20000000-0000-4000-8000-000000000002",
  })),
}));
vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({
    orgId: "org-1",
    workspaceId: "10000000-0000-4000-8000-000000000001",
    workspaceKey: "default",
    role: "admin",
  })),
}));

const startVideo = vi.fn();
const pollVideo = vi.fn();
const storeGeneratedMedia = vi.hoisted(() =>
  vi.fn(async (objectPath: string) => {
    return `https://cdn.example/storage/v1/object/public/campaign-media/${objectPath}`;
  }),
);
vi.mock("@/lib/media", () => ({
  isMediaGenEnabled: () => process.env.ARC_MEDIA_ENABLED === "1",
  getMediaProvider: () => ({ startVideo, pollVideo }),
  getMediaProviderWithKey: () => ({ startVideo, pollVideo }),
}));
vi.mock("@/lib/media/enablement", () => ({
  MEDIA_CONNECTOR_KEY: "gemini-media",
  // byo bypasses metering so route tests exercise the route, not the ledger.
  resolveMediaGeneration: vi.fn(async () =>
    process.env.ARC_MEDIA_ENABLED === "1"
      ? { enabled: true, credential: "test-key", source: "byo", costTier: "byo_key" }
      : { enabled: false, reason: "Media generation is off for this workspace." },
  ),
}));
vi.mock("@/lib/billing/entitlements", () => ({
  checkUsageAllowed: async () => ({
    allowed: true, enforced: false, tier: "free", usedCents: 0, capCents: 1000, remainingCents: 1000, overCap: false,
  }),
  formatCentsUsd: (c: number) => `$${(c / 100).toFixed(0)}`,
  // Mirrors the real helper closely enough for the 402 assertions.
  usageBlockMessage: (g: { reason?: string | null; capCents: number }) =>
    g.reason === "trial_expired"
      ? "Your free trial has ended."
      : `This month's plan limit ($${(g.capCents / 100).toFixed(0)}) is reached.`,
}));
vi.mock("@/lib/media/storage", () => ({
  storeGeneratedMedia,
}));
vi.mock("@/lib/settings/store", () => ({
  getAppSettings: async () => ({ imageModel: "", videoModel: "", markDefaultRoute: "fast" }),
}));

import { POST } from "./route";
import { checkAgentBearer } from "@/lib/auth/api-token";

const bearerMock = vi.mocked(checkAgentBearer);

function req(authorization: string | undefined, body?: unknown) {
  return new Request("http://localhost/api/v1/arc/media/generate-video", {
    method: "POST",
    headers: { ...(authorization ? { authorization } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const env = {
  ARC_AGENT_API_TOKEN: process.env.ARC_AGENT_API_TOKEN,
  ARC_MEDIA_ENABLED: process.env.ARC_MEDIA_ENABLED,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};
function configure() {
  process.env.ARC_AGENT_API_TOKEN = "secret";
  process.env.ARC_MEDIA_ENABLED = "1";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
}

beforeEach(() => {
  bearerMock.mockReset();
  bearerMock.mockResolvedValue({
    ok: true,
    tokenSource: "database",
    orgId: "org-2",
    workspaceId: "20000000-0000-4000-8000-000000000002",
  });
  startVideo.mockReset();
  pollVideo.mockReset();
  storeGeneratedMedia.mockClear();
  startVideo.mockResolvedValue({ operationName: "op/123", model: "veo-2.0-generate-001", jobId: "j" });
});
afterEach(() => {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("POST /api/v1/arc/media/generate-video", () => {
  it("401 without a valid token, no start", async () => {
    process.env.ARC_AGENT_API_TOKEN = "secret";
    process.env.ARC_MEDIA_ENABLED = "1";
    bearerMock.mockResolvedValue({ ok: false, reason: "unauthorized", status: 401 });
    const res = await POST(req("Bearer wrong", { prompt: "x" }));
    expect(res.status).toBe(401);
    expect(startVideo).not.toHaveBeenCalled();
  });

  it("503 when the flag is off", async () => {
    configure();
    process.env.ARC_MEDIA_ENABLED = "0";
    const res = await POST(req("Bearer secret", { prompt: "x" }));
    expect(res.status).toBe(503);
    expect(startVideo).not.toHaveBeenCalled();
  });

  it("400 in start mode when prompt is missing", async () => {
    configure();
    const res = await POST(req("Bearer secret", {}));
    expect(res.status).toBe(400);
    expect(startVideo).not.toHaveBeenCalled();
  });

  it("201 running with operationName when starting", async () => {
    configure();
    const res = await POST(req("Bearer secret", { prompt: "BSR crew restoring a flooded basement" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({ status: "running", operationName: "op/123" });
    expect(startVideo).toHaveBeenCalledTimes(1);
  });

  it("200 running while the operation is still pending", async () => {
    configure();
    pollVideo.mockResolvedValue({ status: "running" });
    const res = await POST(req("Bearer secret", { operation_name: "op/123" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ status: "running" });
    expect(startVideo).not.toHaveBeenCalled();
  });

  it("201 done with provenance-tagged media when poll resolves", async () => {
    configure();
    pollVideo.mockResolvedValue({ status: "done", bytes: Buffer.from("x"), contentType: "video/mp4" });
    const res = await POST(req("Bearer secret", { operation_name: "op/123" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.status).toBe("done");
    expect(json.media).toMatchObject({
      kind: "video",
      url: expect.stringContaining("campaign-media/arc-generated/org-2/20000000-0000-4000-8000-000000000002/"),
      source: "ai_generated",
    });
    expect(json.objectPath).toMatch(/^arc-generated\/org-2\/20000000-0000-4000-8000-000000000002\//);
    expect(storeGeneratedMedia).toHaveBeenCalledWith(
      expect.stringMatching(/^arc-generated\/org-2\/20000000-0000-4000-8000-000000000002\/.+\.mp4$/),
      Buffer.from("x"),
      "video/mp4",
    );
  });
});

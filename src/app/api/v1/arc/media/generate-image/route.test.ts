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

const storeGeneratedImage = vi.hoisted(() =>
  vi.fn(async (objectPath: string) => {
    return `https://cdn.example/storage/v1/object/public/campaign-media/${objectPath}`;
  }),
);
const generateImage = vi.fn();
vi.mock("@/lib/media", () => ({
  isMediaGenEnabled: () => process.env.ARC_MEDIA_ENABLED === "1",
  getMediaProvider: () => ({ generateImage }),
  getMediaProviderWithKey: () => ({ generateImage }),
}));
vi.mock("@/lib/media/enablement", () => ({
  MEDIA_CONNECTOR_KEY: "gemini-media",
  // Enabled via the workspace's own key (byo bypasses metering) so route tests
  // exercise the route, not the metering ledger.
  resolveMediaGeneration: vi.fn(async () =>
    process.env.ARC_MEDIA_ENABLED === "1"
      ? { enabled: true, credential: "test-key", source: "byo", costTier: "byo_key" }
      : { enabled: false, reason: "Media generation is off for this workspace." },
  ),
}));

const checkUsageAllowed = vi.fn(async () => ({
  allowed: true, enforced: false, tier: "free", usedCents: 0, capCents: 1000, remainingCents: 1000, overCap: false,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  checkUsageAllowed: (...a: unknown[]) => checkUsageAllowed(...(a as [])),
  formatCentsUsd: (c: number) => `$${(c / 100).toFixed(0)}`,
  // Mirrors the real helper closely enough for the 402 assertions.
  usageBlockMessage: (g: { reason?: string | null; capCents: number }) =>
    g.reason === "trial_expired"
      ? "Your free trial has ended."
      : `This month's plan limit ($${(g.capCents / 100).toFixed(0)}) is reached.`,
}));
vi.mock("@/lib/media/storage", () => ({
  storeGeneratedImage,
}));
vi.mock("@/lib/settings/store", () => ({
  getAppSettings: async () => ({ imageModel: "", videoModel: "", markDefaultRoute: "fast" }),
}));

import { POST } from "./route";
import { checkAgentBearer } from "@/lib/auth/api-token";

const bearerMock = vi.mocked(checkAgentBearer);

function req(authorization: string | undefined, body?: unknown) {
  return new Request("http://localhost/api/v1/arc/media/generate-image", {
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
  generateImage.mockReset();
  storeGeneratedImage.mockClear();
  generateImage.mockResolvedValue({
    bytes: Buffer.from("x"),
    contentType: "image/png",
    model: "gemini-2.5-flash-image",
    jobId: "job_1",
  });
});
afterEach(() => {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("POST /api/v1/arc/media/generate-image", () => {
  it("401 without a valid token, no generation", async () => {
    process.env.ARC_AGENT_API_TOKEN = "secret";
    process.env.ARC_MEDIA_ENABLED = "1";
    bearerMock.mockResolvedValue({ ok: false, reason: "unauthorized", status: 401 });
    const res = await POST(req("Bearer wrong", { prompt: "x" }));
    expect(res.status).toBe(401);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("503 when the flag is off", async () => {
    configure();
    process.env.ARC_MEDIA_ENABLED = "0";
    const res = await POST(req("Bearer secret", { prompt: "x" }));
    expect(res.status).toBe(503);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("400 when prompt is missing", async () => {
    configure();
    const res = await POST(req("Bearer secret", {}));
    expect(res.status).toBe(400);
  });

  it("402 when the org is over its plan quota (enforcement armed)", async () => {
    configure();
    checkUsageAllowed.mockResolvedValueOnce({
      allowed: false, enforced: true, tier: "free", usedCents: 1200, capCents: 1000, remainingCents: 0, overCap: true,
    });
    const res = await POST(req("Bearer secret", { prompt: "x" }));
    expect(res.status).toBe(402);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("201 with provenance-tagged media on success", async () => {
    configure();
    const res = await POST(req("Bearer secret", { prompt: "abstract blue gradient", aspect_ratio: "9:16" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.media).toMatchObject({
      kind: "image",
      url: expect.stringContaining("campaign-media/arc-generated/org-2/20000000-0000-4000-8000-000000000002/"),
      source: "ai_generated",
      format: "9:16",
      model: "gemini-2.5-flash-image",
    });
    expect(typeof json.objectPath).toBe("string");
    expect(json.objectPath).toMatch(/^arc-generated\/org-2\/20000000-0000-4000-8000-000000000002\//);
    expect(storeGeneratedImage).toHaveBeenCalledWith(
      expect.stringMatching(/^arc-generated\/org-2\/20000000-0000-4000-8000-000000000002\/.+\.png$/),
      Buffer.from("x"),
      "image/png",
    );
    // The prompt is hardened before the provider sees it: caller intent + no-text guard.
    const call = generateImage.mock.calls[0][0];
    expect(call.aspectRatio).toBe("9:16");
    expect(call.prompt).toContain("abstract blue gradient");
    expect(call.prompt).toMatch(/do not render any text/i);
  });
});

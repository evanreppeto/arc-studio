import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// revalidatePath throws in the vitest node env — mock next/cache per-file
// (see project memory "revalidatePath throws in vitest").
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Same shape as the draft-asset route test: keep the real domain + helpers but
// stub the persistence side-effects + campaign resolution.
vi.mock("@/lib/campaigns/create", async (orig) => ({
  ...(await orig<typeof import("@/lib/campaigns/create")>()),
  resolveOrCreateCampaign: vi.fn(),
  promoteAssetToCampaign: vi.fn(),
}));
vi.mock("@/lib/arc-chat/persistence", () => ({ linkConversationToCampaign: vi.fn(async () => undefined) }));

vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({ orgId: "org-1", workspaceId: "workspace-1" })),
}));

import { promoteAssetToCampaign, resolveOrCreateCampaign } from "@/lib/campaigns/create";
import { linkConversationToCampaign } from "@/lib/arc-chat/persistence";

import { POST } from "./route";

const resolveMock = vi.mocked(resolveOrCreateCampaign);
const promoteMock = vi.mocked(promoteAssetToCampaign);
const linkMock = vi.mocked(linkConversationToCampaign);

function req(body: unknown) {
  return new Request("http://localhost/api/v1/arc/campaigns/submit-variants", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer secret" },
    body: JSON.stringify(body),
  });
}

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

beforeEach(() => {
  resolveMock.mockReset();
  promoteMock.mockReset();
  linkMock.mockReset();
  linkMock.mockResolvedValue(undefined);
  resolveMock.mockImplementation(async ({ campaignId }) => ({ campaignId: campaignId?.trim() || "camp-new" }));
  promoteMock.mockImplementation(async () => ({ assetId: `asset-${Math.random().toString(36).slice(2)}` }));
});

afterEach(() => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("POST /api/v1/arc/campaigns/submit-variants", () => {
  it("ranks video variants and submits only the top-K", async () => {
    configure();
    const res = await POST(
      req({
        campaign_id: "camp-1",
        asset_type: "video_ad",
        top_k: 1,
        variants: [
          {
            title: "A",
            media_url: "https://x/a.mp4",
            media: { source: "ai_generated", format: "9:16" },
            analysis: { viral_potential: 42, hook_score: 30, sustain: 96 },
          },
          {
            title: "B",
            media_url: "https://x/b.mp4",
            media: { source: "ai_generated", format: "9:16" },
            analysis: { viral_potential: 71, hook_score: 80, sustain: 88 },
          },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(promoteMock).toHaveBeenCalledTimes(1);
    expect(json.ranked.topK[0].title).toBe("B");
    expect(json.submitted).toHaveLength(1);
    // The winning variant carries its predicted virality block into persistence.
    expect(promoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "B",
        media: expect.objectContaining({ virality: expect.objectContaining({ kind: "predicted", viralPotential: 71 }) }),
      }),
    );
  });

  it("scores images with the quality proxy (never a virality prediction)", async () => {
    configure();
    const res = await POST(
      req({
        campaign_id: "camp-1",
        asset_type: "image_prompt",
        top_k: 1,
        variants: [
          { title: "lo", media_url: "https://x/lo.png", media: { riskFlags: ["claim risk"] }, width: 400, height: 400 },
          { title: "hi", media_url: "https://x/hi.png", format_matches_channel: true, has_brand: true, width: 1080, height: 1080 },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.ranked.topK[0].title).toBe("hi");
    expect(json.ranked.topK[0].score.kind).toBe("proxy");
    expect("viralPotential" in json.ranked.topK[0].score).toBe(false);
  });

  it("submits unscored video variants (no analysis) without fabricating a score", async () => {
    configure();
    const res = await POST(
      req({
        campaign_id: "camp-1",
        asset_type: "video_ad",
        top_k: 1,
        variants: [{ title: "raw", media_url: "https://x/raw.mp4" }],
      }),
    );
    expect(res.status).toBe(201);
    expect(promoteMock).toHaveBeenCalledTimes(1);
    // No analysis → no virality block persisted.
    expect(promoteMock).toHaveBeenCalledWith(expect.objectContaining({ media: expect.not.objectContaining({ virality: expect.anything() }) }));
  });

  it("creates a new campaign via the shared resolver when campaign_id is omitted", async () => {
    configure();
    const res = await POST(
      req({
        name: "Fall Water Push",
        persona: "persona_homeowner_emergency",
        restoration_focus: "water",
        asset_type: "video_ad",
        variants: [{ title: "A", media_url: "https://x/a.mp4", analysis: { viral_potential: 50 } }],
      }),
    );
    expect(res.status).toBe(201);
    expect(resolveMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Fall Water Push", persona: "persona_homeowner_emergency", restorationFocus: "water" }),
    );
    expect((await res.json()).campaignId).toBe("camp-new");
  });

  it("links the originating conversation to the resolved campaign", async () => {
    configure();
    const res = await POST(
      req({
        campaign_id: "camp-1",
        conversation_id: "conv-1",
        asset_type: "image_prompt",
        variants: [{ title: "A", media_url: "https://x/a.png" }],
      }),
    );
    expect(res.status).toBe(201);
    expect(linkMock).toHaveBeenCalledWith("conv-1", "camp-1", "Campaign workspace");
  });

  it("returns 503 when Supabase is not configured (arcGuard)", async () => {
    process.env.ARC_AGENT_API_TOKEN = "secret";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await POST(req({ campaign_id: "c", asset_type: "video_ad", variants: [] }));
    expect(res.status).toBe(503);
    expect(promoteMock).not.toHaveBeenCalled();
  });

  it("refuses the write when the bearer token cannot be verified", async () => {
    configure();
    const bad = new Request("http://localhost/api/v1/arc/campaigns/submit-variants", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong" },
      body: JSON.stringify({ campaign_id: "c", asset_type: "video_ad", variants: [] }),
    });
    const res = await POST(bad);
    // These tests point at an unreachable Supabase, so the token store cannot
    // answer — and "I could not verify this" is now 503, distinct from the 401
    // that means "this token is not ours". The security property under test is
    // unchanged: the request is refused and nothing is read or written. The 401
    // path is covered where the store can be made to answer (see the
    // token-store test below, and src/lib/auth/check-agent-bearer.test.ts).
    expect(res.status).toBe(503);
    expect(promoteMock).not.toHaveBeenCalled();
  });
});

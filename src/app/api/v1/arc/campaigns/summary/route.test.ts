import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/campaigns/create", () => ({ recordCampaignPackageSummary: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({ orgId: "org-1", workspaceId: "workspace-1" })),
}));

import { recordCampaignPackageSummary } from "@/lib/campaigns/create";

import { POST } from "./route";

const recordMock = vi.mocked(recordCampaignPackageSummary);
const CAMPAIGN = "7bef0d89-8729-43da-a920-d98e1c002dca";

function req(authorization: string | undefined, body?: unknown) {
  return new Request("http://localhost/api/v1/arc/campaigns/summary", {
    method: "POST",
    headers: { ...(authorization ? { authorization } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
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
  recordMock.mockReset();
  recordMock.mockResolvedValue(true);
});
afterEach(() => {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("POST /api/v1/arc/campaigns/summary", () => {
  it("401s without a valid token and never writes", async () => {
    // Token only: with Supabase configured, checkAgentBearer also tries a
    // database token source, which cannot resolve against a stub URL.
    process.env.ARC_AGENT_API_TOKEN = "secret";
    const res = await POST(req("Bearer wrong", { campaign_id: CAMPAIGN, objective: "x" }));
    expect(res.status).toBe(401);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("records all four fields without creating an asset", async () => {
    configure();
    const res = await POST(
      req("Bearer secret", {
        campaign_id: CAMPAIGN,
        objective: "Capture post-flood water-damage calls",
        audience_summary: "Cook County homeowners in the advisory footprint",
        handoff_note: "Built before the CRM import; no consented list yet.",
        considered_audiences: [{ label: "Past clients", reason: "Different angle", size_estimate: 60 }],
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "recorded", campaignId: CAMPAIGN });

    const passed = recordMock.mock.calls[0][0];
    expect(passed.objective).toBe("Capture post-flood water-damage calls");
    expect(passed.audienceSummary).toBe("Cook County homeowners in the advisory footprint");
    expect(passed.handoffNote).toBe("Built before the CRM import; no consented list yet.");
    // snake_case on the wire, camelCase in storage — unmapped, the size is lost.
    expect(passed.consideredAudiences).toEqual([
      { label: "Past clients", reason: "Different angle", sizeEstimate: 60 },
    ]);
    expect(passed.tenant).toEqual({ org_id: "org-1", workspace_id: "workspace-1" });
  });

  it("400s on a short id instead of updating nothing and reporting success", async () => {
    configure();
    // Arc reached for the 8-char prefix it had in conversation on its first
    // attempt at this. A 200 that matched no row would have looked like success.
    const res = await POST(req("Bearer secret", { campaign_id: "7bef0d89", objective: "x" }));
    expect(res.status).toBe(400);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("400s when campaign_id is missing", async () => {
    configure();
    expect((await POST(req("Bearer secret", { objective: "x" }))).status).toBe(400);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("400s when nothing was worth writing, rather than reporting a hollow success", async () => {
    configure();
    recordMock.mockResolvedValue(false);
    const res = await POST(req("Bearer secret", { campaign_id: CAMPAIGN, handoff_note: "   " }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("Nothing to record");
  });

  it("502s when the write throws", async () => {
    configure();
    recordMock.mockRejectedValue(new Error("db down"));
    expect((await POST(req("Bearer secret", { campaign_id: CAMPAIGN, objective: "x" }))).status).toBe(502);
  });

  it("passes only what was supplied, so an omitted field is left alone", async () => {
    configure();
    await POST(req("Bearer secret", { campaign_id: CAMPAIGN, handoff_note: "just the note" }));
    const passed = recordMock.mock.calls[0][0];
    expect(passed.handoffNote).toBe("just the note");
    expect(passed.objective).toBeUndefined();
    expect(passed.audienceSummary).toBeUndefined();
    expect(passed.consideredAudiences).toBeUndefined();
  });
});

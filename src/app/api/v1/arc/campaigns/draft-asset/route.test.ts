import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/campaigns/create", async (orig) => ({
  ...(await orig<typeof import("@/lib/campaigns/create")>()),
  resolveOrCreateCampaign: vi.fn(),
  promoteAssetToCampaign: vi.fn(),
  createCampaignFromOpportunity: vi.fn(),
  recordCampaignPackageSummary: vi.fn(),
}));
vi.mock("@/lib/opportunities/read-model", () => ({ getOpportunityForCampaign: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/personas/read-model", () => ({
  getOrgPersonaKeys: vi.fn(async () => [
    "persona_homeowner_emergency", "persona_homeowner_preventative", "persona_homeowner_rebuild",
    "persona_landlord", "persona_hoa_board", "persona_property_manager", "persona_insurance_agent",
    "persona_listing_agent", "persona_buyers_agent", "persona_plumbing_partner",
    "persona_hvac_roof_electrical_partner", "persona_gc_remodeler_partner",
  ]),
}));
vi.mock("@/lib/opportunities/persistence", () => ({ markOpportunityDrafted: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({
    orgId: "org-1",
    workspaceId: "workspace-1",
  })),
}));

vi.mock("@/lib/arc-chat/persistence", () => ({ linkConversationToCampaign: vi.fn(async () => undefined) }));
import { linkConversationToCampaign } from "@/lib/arc-chat/persistence";
const linkMock = vi.mocked(linkConversationToCampaign);

import {
  CampaignResolutionError,
  createCampaignFromOpportunity,
  promoteAssetToCampaign,
  recordCampaignPackageSummary,
  resolveOrCreateCampaign,
} from "@/lib/campaigns/create";
import { markOpportunityDrafted } from "@/lib/opportunities/persistence";
import { getOpportunityForCampaign } from "@/lib/opportunities/read-model";

import { POST } from "./route";

const resolveMock = vi.mocked(resolveOrCreateCampaign);
const promoteMock = vi.mocked(promoteAssetToCampaign);
const markDraftedMock = vi.mocked(markOpportunityDrafted);
const fromOppMock = vi.mocked(createCampaignFromOpportunity);
const getOppMock = vi.mocked(getOpportunityForCampaign);
const summaryMock = vi.mocked(recordCampaignPackageSummary);

function req(authorization: string | undefined, body?: unknown) {
  return new Request("http://localhost/api/v1/arc/campaigns/draft-asset", {
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
  resolveMock.mockReset();
  promoteMock.mockReset();
  markDraftedMock.mockReset();
  linkMock.mockReset();
  // Default: resolve to the existing campaign id when given, otherwise the shell id.
  resolveMock.mockImplementation(async ({ campaignId }) => ({ campaignId: campaignId?.trim() || "camp_1" }));
  promoteMock.mockResolvedValue({ assetId: "asset_1" });
  markDraftedMock.mockResolvedValue({ ok: true });
  linkMock.mockResolvedValue(undefined);
  fromOppMock.mockReset();
  getOppMock.mockReset();
  // Default: no such opportunity, so the shell path stays the default in the
  // tests written before opportunity-aware creation existed.
  getOppMock.mockResolvedValue(null);
  fromOppMock.mockResolvedValue({ campaignId: "camp_from_opp" });
  summaryMock.mockReset();
  summaryMock.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("POST /api/v1/arc/campaigns/draft-asset", () => {
  it("returns 401 without a valid token and never writes", async () => {
    process.env.ARC_AGENT_API_TOKEN = "secret";
    const res = await POST(req("Bearer wrong", { asset_type: "social_ad", title: "x" }));
    expect(res.status).toBe(401);
    expect(resolveMock).not.toHaveBeenCalled();
    expect(promoteMock).not.toHaveBeenCalled();
  });

  it("400s when asset_type or title is missing", async () => {
    configure();
    expect((await POST(req("Bearer secret", { title: "x" }))).status).toBe(400);
    expect((await POST(req("Bearer secret", { asset_type: "social_ad" }))).status).toBe(400);
    expect(promoteMock).not.toHaveBeenCalled();
  });

  it("400s when creating a new campaign without name/persona/restoration_focus", async () => {
    configure();
    resolveMock.mockRejectedValueOnce(new CampaignResolutionError("missing fields"));
    const res = await POST(req("Bearer secret", { asset_type: "social_ad", title: "Fall ad" }));
    expect(res.status).toBe(400);
    expect(promoteMock).not.toHaveBeenCalled();
  });

  it("creates a shell + asset and returns 201 with both ids", async () => {
    configure();
    const res = await POST(
      req("Bearer secret", {
        asset_type: "social_ad",
        title: "Fall ad",
        body: "Before winter…",
        name: "Fall Water Push",
        persona: "persona_homeowner_emergency",
        restoration_focus: "water",
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      ok: true,
      status: "created",
      campaignId: "camp_1",
      assetId: "asset_1",
    });
    expect(resolveMock).toHaveBeenCalledOnce();
    // The route forwards the raw inputs; theme derivation + enum normalization now
    // live inside resolveOrCreateCampaign (mocked here), not at the boundary.
    expect(resolveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Fall Water Push",
        persona: "persona_homeowner_emergency",
        restorationFocus: "water",
        tenant: { org_id: "org-1", workspace_id: "workspace-1" },
      }),
    );
    expect(promoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: "camp_1",
        assetType: "social_ad",
        title: "Fall ad",
        operator: "Arc",
        tenant: { org_id: "org-1", workspace_id: "workspace-1" },
      }),
    );
  });

  it("400s on an unknown asset_type instead of letting it 502 at Postgres", async () => {
    configure();
    const res = await POST(req("Bearer secret", { campaign_id: "camp_existing", asset_type: "banana", title: "x" }));
    expect(res.status).toBe(400);
    expect(promoteMock).not.toHaveBeenCalled();
  });

  it("normalizes a known asset_type alias (video_ad -> video_prompt) and persists the real enum value", async () => {
    configure();
    const res = await POST(req("Bearer secret", { campaign_id: "camp_existing", asset_type: "video_ad", title: "Clip" }));
    expect(res.status).toBe(201);
    expect(promoteMock).toHaveBeenCalledWith(expect.objectContaining({ assetType: "video_prompt" }));
  });

  it("accepts an unknown restoration_focus as a free-text theme (industry-neutral, no 400)", async () => {
    configure();
    const res = await POST(
      req("Bearer secret", { asset_type: "social_ad", title: "x", name: "N", persona: "persona_landlord", restoration_focus: "lava" }),
    );
    expect(res.status).toBe(201);
    expect(resolveMock).toHaveBeenCalledWith(expect.objectContaining({ restorationFocus: "lava" }));
  });

  it("400s on an unknown persona when creating a new campaign", async () => {
    configure();
    const res = await POST(
      req("Bearer secret", { asset_type: "social_ad", title: "x", name: "N", persona: "persona_alien", restoration_focus: "flood" }),
    );
    expect(res.status).toBe(400);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("forwards a free-text campaign_theme when creating a new campaign", async () => {
    configure();
    const res = await POST(
      req("Bearer secret", { asset_type: "social_ad", title: "x", name: "N", persona: "persona_landlord", campaign_theme: "Spring onboarding" }),
    );
    expect(res.status).toBe(201);
    expect(resolveMock).toHaveBeenCalledWith(expect.objectContaining({ campaignTheme: "Spring onboarding" }));
  });

  it("attaches to an existing campaign without creating a shell", async () => {
    configure();
    const res = await POST(req("Bearer secret", { campaign_id: "camp_existing", asset_type: "email", title: "Reminder" }));
    expect(res.status).toBe(201);
    expect(resolveMock).toHaveBeenCalledWith(expect.objectContaining({ campaignId: "camp_existing" }));
    expect(promoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: "camp_existing",
        assetType: "email",
        tenant: { org_id: "org-1", workspace_id: "workspace-1" },
      }),
    );
  });

  it("links the opportunity when opportunity_id is provided", async () => {
    configure();
    await POST(req("Bearer secret", { campaign_id: "camp_existing", asset_type: "email", title: "Re-engage", opportunity_id: "opp-1" }));
    expect(markOpportunityDrafted).toHaveBeenCalledWith("opp-1", "camp_existing", undefined, { orgId: "org-1" });
  });

  it("does not link an opportunity when opportunity_id is absent", async () => {
    configure();
    await POST(req("Bearer secret", { campaign_id: "camp_existing", asset_type: "email", title: "Plain" }));
    expect(markOpportunityDrafted).not.toHaveBeenCalled();
  });

  it("forwards media url, path, and generation provenance to persistence", async () => {
    configure();
    const res = await POST(
      req("Bearer secret", {
        campaign_id: "camp_existing",
        asset_type: "image_prompt",
        title: "Concept",
        media_url: "https://signed/img.png",
        media_path: "arc-generated/abc.png",
        media: { source: "ai_generated", model: "gemini-2.5-flash-image", jobId: "job_1", format: "1:1", riskFlags: ["claim risk"] },
      }),
    );
    expect(res.status).toBe(201);
    expect(promoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaUrl: "https://signed/img.png",
        mediaPath: "arc-generated/abc.png",
        media: expect.objectContaining({ source: "ai_generated", model: "gemini-2.5-flash-image", jobId: "job_1", riskFlags: ["claim risk"] }),
      }),
    );
  });

  it("calls linkConversationToCampaign with conversation_id and campaign_id when provided", async () => {
    configure();
    const res = await POST(
      req("Bearer secret", {
        campaign_id: "camp_existing",
        asset_type: "email",
        title: "Hi",
        conversation_id: "conv1",
      }),
    );
    expect(res.status).toBe(201);
    expect(linkMock).toHaveBeenCalledWith("conv1", "camp_existing", expect.any(String));
  });

  it("does not call linkConversationToCampaign when conversation_id is absent", async () => {
    configure();
    await POST(req("Bearer secret", { campaign_id: "camp_existing", asset_type: "email", title: "Plain" }));
    expect(linkMock).not.toHaveBeenCalled();
  });

  it("still returns 201 when linkConversationToCampaign throws (best-effort)", async () => {
    configure();
    linkMock.mockRejectedValue(new Error("boom"));
    const res = await POST(
      req("Bearer secret", {
        campaign_id: "camp_existing",
        asset_type: "email",
        title: "Hi",
        conversation_id: "conv1",
      }),
    );
    expect(res.status).toBe(201);
  });
});

/**
 * BSR-675 / BSR-677. Arc drafted a full package from opportunity 7865e1f7 in
 * chat and the campaign landed with `source_signal: {}`, `objective: null`,
 * `audience_summary: null`, while the opportunity stayed `pending` — so the next
 * scan would re-propose work that was already drafted, and nothing tied the
 * campaign to the signal that justified it.
 *
 * The operator's "Create campaign" button never had this problem, because it
 * goes through createCampaignFromOpportunity. These assert the Arc path now
 * takes the same route.
 */
describe("drafting from a known opportunity", () => {
  beforeEach(() => configure());

  const opp = {
    id: "opp_1",
    subjectType: "weather_event",
    subjectId: "urn:alert:1",
    title: "Flood Advisory — Cook, IL",
    summary: "Flood advisory across Cook County",
    confidence: 55,
    urgency: "low" as const,
    recommendedAction: "Launch a geo-targeted damage-response campaign",
    recommendedCampaignType: "storm_response",
    persona: "persona_homeowner_emergency",
    evidence: { area: "Cook, IL" },
    status: "pending",
    campaignId: null,
  };

  it("converts through the opportunity path, not the bare shell", async () => {
    getOppMock.mockResolvedValue(opp);
    const res = await POST(
      req("Bearer secret", {
        opportunity_id: "opp_1",
        name: "Flood response",
        persona: "persona_homeowner_emergency",
        campaign_theme: "Storm response",
        asset_type: "email",
        title: "Email draft",
      }),
    );
    expect(res.status).toBe(201);
    expect(fromOppMock).toHaveBeenCalledTimes(1);
    // The bare shell records no provenance — it must not be what runs here.
    expect(resolveMock).not.toHaveBeenCalled();
    const passed = fromOppMock.mock.calls[0][0];
    expect(passed.opportunity).toEqual(opp);
    expect(passed.objective).toBe(opp.recommendedAction);
  });

  it("carries Arc's own objective and audience when it supplies them", async () => {
    getOppMock.mockResolvedValue(opp);
    await POST(
      req("Bearer secret", {
        opportunity_id: "opp_1",
        name: "Flood response",
        persona: "persona_homeowner_emergency",
        asset_type: "email",
        title: "Email draft",
        objective: "Capture post-flood water-damage calls",
        audience_summary: "Cook County homeowners in the advisory footprint",
      }),
    );
    const passed = fromOppMock.mock.calls[0][0];
    expect(passed.objective).toBe("Capture post-flood water-damage calls");
    expect(passed.audienceSummary).toBe("Cook County homeowners in the advisory footprint");
  });

  it("attaches to the existing campaign rather than drafting a duplicate", async () => {
    getOppMock.mockResolvedValue({ ...opp, status: "drafted", campaignId: "camp_existing" });
    const res = await POST(
      req("Bearer secret", { opportunity_id: "opp_1", asset_type: "email", title: "Second asset" }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ campaignId: "camp_existing" });
    expect(fromOppMock).not.toHaveBeenCalled();
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("attaching to an explicit campaign_id never re-converts", async () => {
    // campaign_id wins: the caller already knows where the asset belongs.
    const res = await POST(
      req("Bearer secret", { campaign_id: "camp_9", opportunity_id: "opp_1", asset_type: "email", title: "X" }),
    );
    expect(res.status).toBe(201);
    expect(getOppMock).not.toHaveBeenCalled();
    expect(fromOppMock).not.toHaveBeenCalled();
    expect(resolveMock).toHaveBeenCalled();
  });

  it("falls back to the shell when the opportunity cannot be read", async () => {
    // A lookup failure must not lose the draft the operator asked for.
    getOppMock.mockRejectedValue(new Error("db down"));
    const res = await POST(
      req("Bearer secret", {
        opportunity_id: "opp_1",
        name: "Flood response",
        persona: "persona_homeowner_emergency",
        campaign_theme: "Storm response",
        asset_type: "email",
        title: "Email draft",
      }),
    );
    expect(res.status).toBe(201);
    expect(fromOppMock).not.toHaveBeenCalled();
    expect(resolveMock).toHaveBeenCalled();
  });
});

/**
 * BSR-677 part 2. `handoff_note` and `considered_audiences` are named parts of
 * the Campaign Package Builder and are rendered on the campaign page, and until
 * now no path on either side wrote them — the considered-audiences branch in the
 * detail view had never once had data. Arc produces both while drafting.
 */
describe("package summary write-back", () => {
  beforeEach(() => configure());

  it("records the handoff note and considered audiences", async () => {
    await POST(
      req("Bearer secret", {
        campaign_id: "camp_9",
        asset_type: "email",
        title: "Email",
        handoff_note: "Call within 24h; mention the Aug 1 advisory.",
        considered_audiences: [
          { label: "Property managers", reason: "No owned records to ground it", size_estimate: 120 },
          { label: "Past clients", reason: "No completed-job history yet" },
        ],
      }),
    );
    expect(summaryMock).toHaveBeenCalledTimes(1);
    const passed = summaryMock.mock.calls[0][0];
    expect(passed.campaignId).toBe("camp_9");
    expect(passed.handoffNote).toBe("Call within 24h; mention the Aug 1 advisory.");
    // snake_case on the wire, camelCase in storage — unmapped, the size is lost.
    expect(passed.consideredAudiences).toEqual([
      { label: "Property managers", reason: "No owned records to ground it", sizeEstimate: 120 },
      { label: "Past clients", reason: "No completed-job history yet", sizeEstimate: undefined },
    ]);
  });

  it("still creates the asset when the summary write fails", async () => {
    // The asset already exists by then; a summary hiccup must not 502 the draft.
    summaryMock.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(
      req("Bearer secret", { campaign_id: "camp_9", asset_type: "email", title: "Email", handoff_note: "x" }),
    );
    expect(res.status).toBe(201);
  });

  it("passes nothing through when neither field is supplied", async () => {
    await POST(req("Bearer secret", { campaign_id: "camp_9", asset_type: "email", title: "Email" }));
    const passed = summaryMock.mock.calls[0][0];
    expect(passed.handoffNote).toBeUndefined();
    expect(passed.consideredAudiences).toBeUndefined();
  });
});

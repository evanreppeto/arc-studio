import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock, type MockResponse } from "@/lib/repos/__tests__/test-helpers";

import { buildReasoning, getCampaignWorkspaceDetail, getCampaignWorkspaceList, listCampaignNames, selectIn } from "./read-model";

// buildReasoning only reads a handful of fields; cast minimal fixtures to the
// row shapes to keep the test focused on the distillation logic.
function campaign(reasoning: unknown, audit: unknown = {}) {
  return { reasoning_payload: reasoning, audit_payload: audit } as never;
}

function asset(toolSource: string | null, promptInputs: unknown = {}) {
  return { tool_source: toolSource, prompt_inputs: promptInputs } as never;
}

describe("buildReasoning", () => {
  it("distills why/action/flags/tools/prompt-inputs from Arc's payloads", () => {
    const result = buildReasoning(
      campaign(
        {
          why_arc_created_it: "Referral persona with water-loss signals.",
          recommended_action: "Approve the first-touch outreach asset.",
          guardrail_flags: ["Human review required", "Outbound locked until approved"],
        },
        { provider: "local_deterministic" },
      ),
      [
        asset("Arc Orchestrator", { persona: "persona_plumbing_partner", channel: "email", target_id: "x" }),
        asset("Arc Orchestrator"),
      ],
    );

    expect(result.whyBuilt).toContain("Referral persona");
    expect(result.recommendedAction).toContain("Approve");
    expect(result.guardrailFlags).toHaveLength(2);
    // tool_source dedupes; audit provider is humanized and included
    expect(result.toolsUsed).toEqual(["Arc Orchestrator", "Local Deterministic"]);
    // readable scalar prompt inputs only, *_id keys filtered out
    expect(result.promptInputs.map((p) => p.label)).toEqual(["Persona", "Channel"]);
  });

  it("falls back gracefully when nothing is recorded", () => {
    const result = buildReasoning(campaign({}, {}), [asset(null)]);
    expect(result.whyBuilt).toMatch(/not recorded reasoning/i);
    expect(result.guardrailFlags).toEqual([]);
    expect(result.toolsUsed).toEqual([]);
    expect(result.promptInputs).toEqual([]);
  });
});

describe("getCampaignWorkspaceDetail creative media", () => {
  it("renders a media_assets payload as a categorized, previewable asset", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: {
        data: {
          id: "camp-1",
          name: "Plumbing Partner",
          persona: "persona_plumbing_partner",
          restoration_focus: "water_backup",
          status: "pending_approval",
          company_id: null,
          contact_id: null,
          lead_id: null,
          owner: "Arc",
          objective: "Referral campaign",
          audience_summary: null,
          offer_summary: null,
          compliance_notes: null,
          launch_locked: true,
          source_signal: {},
          reasoning_payload: {},
          audit_payload: {},
          created_at: "2026-06-02T12:00:00.000Z",
          updated_at: "2026-06-02T12:00:00.000Z",
        },
        error: null,
      },
      campaign_assets: {
        data: [
          {
            id: "asset-img",
            campaign_id: "camp-1",
            asset_type: "image_prompt",
            channel: "image",
            title: "Hero image",
            status: "pending_owner_approval",
            tool_source: "Arc Orchestrator",
            prompt_input: null,
            prompt_inputs: {},
            draft_body: null,
            edited_body: null,
            approved_body: null,
            dispatch_locked: true,
            compliance_notes: null,
            reasoning_payload: {},
            audit_payload: { media_assets: [{ url: "https://cdn.example/hero.png", type: "image", title: "Hero" }] },
            created_at: "2026-06-02T12:00:00.000Z",
            updated_at: "2026-06-02T12:00:00.000Z",
          },
        ],
        error: null,
      },
    });

    const detail = await getCampaignWorkspaceDetail("camp-1", supabase, "Arc", "org-1");

    expect(detail.status).toBe("live");
    if (detail.status !== "live") return;

    const asset = detail.assets[0];
    expect(asset.category).toBe("media");
    expect(asset.media[0]).toMatchObject({ type: "image", url: "https://cdn.example/hero.png" });
    expect(detail.metrics.media).toBeGreaterThan(0);
    // 8, not 7, since BSR-743: the guardrail_findings read is org-scoped too. It
    // had been relying on its campaign_asset_id list already being this org's,
    // which is a property of the caller rather than of the query.
    expect(supabase.calls.filter((call) => call[0] === "eq" && call[1] === "org_id" && call[2] === "org-1")).toHaveLength(8);
  });

  it("turns structured candidate JSON into human-readable campaign copy", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: {
        data: {
          id: "camp-1",
          name: "Insurance Partner",
          persona: "persona_insurance_agent",
          restoration_focus: "water_damage",
          status: "pending_approval",
          company_id: null,
          contact_id: null,
          lead_id: null,
          owner: "Arc",
          objective: "Referral campaign",
          audience_summary: null,
          offer_summary: null,
          compliance_notes: null,
          launch_locked: true,
          source_signal: {},
          reasoning_payload: {},
          audit_payload: {},
          created_at: "2026-06-02T12:00:00.000Z",
          updated_at: "2026-06-02T12:00:00.000Z",
        },
        error: null,
      },
      campaign_assets: {
        data: [
          {
            id: "asset-candidates",
            campaign_id: "camp-1",
            asset_type: "partner_lead_list",
            channel: "review",
            title: "Insurance partner candidates",
            status: "pending_owner_approval",
            tool_source: "Arc",
            prompt_input: null,
            prompt_inputs: {},
            draft_body: JSON.stringify({
              bucket: "insurance_partner",
              candidate_count: 1,
              top_candidates: [
                {
                  company_id: "hidden-company-id",
                  lead_id: "hidden-lead-id",
                  name: "Lakeview Insurance",
                  score: 94,
                  website: "https://lakeviewins.com/",
                  phone: "773-871-8000",
                  confidence: "high",
                  notes: "Strong fit for homeowner and condo claim referral relationships in Chicago.",
                },
              ],
              dispatch_locked: true,
            }),
            edited_body: null,
            approved_body: null,
            dispatch_locked: true,
            compliance_notes: null,
            reasoning_payload: {},
            audit_payload: {},
            created_at: "2026-06-02T12:00:00.000Z",
            updated_at: "2026-06-02T12:00:00.000Z",
          },
        ],
        error: null,
      },
    });

    const detail = await getCampaignWorkspaceDetail("camp-1", supabase);

    expect(detail.status).toBe("live");
    if (detail.status !== "live") return;

    expect(detail.assets[0].body).toContain("Lakeview Insurance");
    expect(detail.assets[0].body).toContain("Score: 94");
    expect(detail.assets[0].body).toContain("Phone: 773-871-8000");
    expect(detail.assets[0].body).not.toContain("hidden-company-id");
    expect(detail.assets[0].body).not.toContain("hidden-lead-id");
  });
});

describe("getCampaignWorkspaceDetail media trust", () => {
  const baseCampaign = {
    id: "camp-1",
    name: "Water Loss Outreach",
    persona: "persona_plumbing_partner",
    restoration_focus: "water_backup",
    status: "pending_approval",
    company_id: null,
    contact_id: null,
    lead_id: null,
    owner: "Arc",
    objective: "Referral campaign",
    audience_summary: null,
    offer_summary: null,
    compliance_notes: null,
    launch_locked: true,
    source_signal: {},
    reasoning_payload: {},
    audit_payload: {},
    created_at: "2026-06-02T12:00:00.000Z",
    updated_at: "2026-06-02T12:00:00.000Z",
  };

  it("does not render an image URL scavenged from the email body as creative media", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: { data: baseCampaign, error: null },
      campaign_assets: {
        data: [
          {
            id: "asset-email",
            campaign_id: "camp-1",
            asset_type: "email",
            channel: "email",
            title: "Subject: Fast help for a water-loss claim",
            status: "pending_owner_approval",
            tool_source: "Arc",
            prompt_input: null,
            prompt_inputs: {},
            // Arc's prose mentions an illustrative image URL — this must NOT
            // become the email's hero creative.
            draft_body:
              "Hi Dana,\n\nHere's our crew on a recent job: https://example.com/crew-photo.jpg\n\nWould a quick call help?\n\nBest,\nBSR",
            edited_body: null,
            approved_body: null,
            dispatch_locked: true,
            compliance_notes: null,
            reasoning_payload: {},
            audit_payload: {},
            created_at: "2026-06-02T12:00:00.000Z",
            updated_at: "2026-06-02T12:00:00.000Z",
          },
        ],
        error: null,
      },
    });

    const detail = await getCampaignWorkspaceDetail("camp-1", supabase, "Arc", "org-1");

    expect(detail.status).toBe("live");
    if (detail.status !== "live") return;

    // The scavenged URL is "referenced", not creative — so it never renders as media.
    expect(detail.assets[0].media).toEqual([]);
  });

  it("tags structured creative media as attached so it renders as real creative", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: { data: baseCampaign, error: null },
      campaign_assets: {
        data: [
          {
            id: "asset-img",
            campaign_id: "camp-1",
            asset_type: "image_prompt",
            channel: "image",
            title: "Hero image",
            status: "pending_owner_approval",
            tool_source: "Arc Orchestrator",
            prompt_input: null,
            prompt_inputs: {},
            draft_body: null,
            edited_body: null,
            approved_body: null,
            dispatch_locked: true,
            compliance_notes: null,
            reasoning_payload: {},
            audit_payload: { media_assets: [{ url: "https://cdn.example/hero.png", type: "image", title: "Hero" }] },
            created_at: "2026-06-02T12:00:00.000Z",
            updated_at: "2026-06-02T12:00:00.000Z",
          },
        ],
        error: null,
      },
    });

    const detail = await getCampaignWorkspaceDetail("camp-1", supabase, "Arc", "org-1");

    expect(detail.status).toBe("live");
    if (detail.status !== "live") return;

    expect(detail.assets[0].media[0]).toMatchObject({
      url: "https://cdn.example/hero.png",
      origin: "attached",
    });
  });
});

const ROLLUP_CAMPAIGN = {
  id: "camp-1",
  name: "Spring Flood Recovery",
  persona: "persona_property_manager",
  restoration_focus: "water_backup",
  status: "pending_approval",
  company_id: null,
  contact_id: null,
  lead_id: null,
  owner: "Arc",
  objective: "Pre-approve vendor",
  audience_summary: null,
  offer_summary: null,
  compliance_notes: null,
  launch_locked: true,
  source_signal: {},
  reasoning_payload: {},
  audit_payload: {},
  created_at: "2026-06-02T12:00:00.000Z",
  updated_at: "2026-06-02T12:00:00.000Z",
};

function rollupAsset(id: string, assetType: string) {
  return {
    id,
    campaign_id: "camp-1",
    asset_type: assetType,
    channel: assetType,
    title: id,
    status: "pending_approval",
    tool_source: "creative_generator",
    prompt_input: null,
    prompt_inputs: {},
    draft_body: "Draft body",
    edited_body: null,
    approved_body: null,
    dispatch_locked: true,
    compliance_notes: null,
    reasoning_payload: {},
    audit_payload: {},
    created_at: "2026-06-02T12:00:00.000Z",
    updated_at: "2026-06-02T12:00:00.000Z",
  };
}

function rollupApproval(id: string, assetId: string, status: string) {
  return {
    id,
    campaign_id: "camp-1",
    campaign_asset_id: assetId,
    company_id: null,
    contact_id: null,
    lead_id: null,
    item_type: "email_campaign_asset",
    status,
    locked_until_approved: true,
    prompt_inputs: {},
    draft_output: "Draft body",
    edited_output: null,
    requested_by: "arc",
    submitted_at: "2026-06-02T12:00:00.000Z",
    risk_level: "low",
    compliance_notes: null,
    decision_notes: null,
    reasoning_payload: {},
    audit_payload: {},
    created_at: "2026-06-02T12:00:00.000Z",
    updated_at: "2026-06-02T12:00:00.000Z",
  };
}

// One approved asset, one with a real pending approval decision, and one with
// no approval item (Arc drafted it but never submitted it for a decision).
const ROLLUP_ASSETS = [
  rollupAsset("asset-email", "email"),
  rollupAsset("asset-landing", "landing_page"),
  rollupAsset("asset-draft", "sms"),
];

const ROLLUP_APPROVALS = [
  rollupApproval("appr-email", "asset-email", "approved"),
  rollupApproval("appr-landing", "asset-landing", "pending_approval"),
];

describe("getCampaignWorkspaceDetail rollup", () => {
  it("counts pending decisions, not pending pieces (no-approval assets are draft)", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: { data: ROLLUP_CAMPAIGN, error: null },
      campaign_assets: { data: ROLLUP_ASSETS, error: null },
      approval_items: { data: ROLLUP_APPROVALS, error: null },
    });

    const detail = await getCampaignWorkspaceDetail("camp-1", supabase);

    expect(detail.status).toBe("live");
    if (detail.status !== "live") return;

    const rollup = detail.campaign.rollup;
    expect(rollup.approved).toBe(1); // asset-email: approved approval wins over its pending asset row
    expect(rollup.pending).toBe(1); // asset-landing: a real pending approval decision
    expect(rollup.draft).toBe(1); // asset-draft: no approval item -> draft, NOT pending
    expect(rollup.total).toBe(3);
    expect(rollup.state).toBe("needs_review");
    expect(rollup.label).toBe("Needs your review · 1 pending");
  });
});

describe("getCampaignWorkspaceList rollup", () => {
  it("counts pending decisions on list items (no-approval assets are draft)", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: { data: [ROLLUP_CAMPAIGN], error: null },
      campaign_assets: { data: ROLLUP_ASSETS, error: null },
      approval_items: { data: ROLLUP_APPROVALS, error: null },
    });

    const list = await getCampaignWorkspaceList(supabase, "Arc", "org-1");

    expect(list.status).toBe("live");
    if (list.status !== "live") return;

    const item = list.campaigns.find((campaign) => campaign.id === "camp-1");
    expect(item?.rollup.approved).toBe(1); // approved approval wins over the asset's pending row
    expect(item?.rollup.pending).toBe(1); // one real pending decision
    expect(item?.rollup.draft).toBe(1); // no-approval asset -> draft
    expect(item?.rollup.total).toBe(3);
    expect(item?.rollup.state).toBe("needs_review");
    expect(supabase.calls.filter((call) => call[0] === "eq" && call[1] === "org_id" && call[2] === "org-1")).toHaveLength(4);
  });

  it("exposes the campaign package pieces needed by the library page", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: { data: [ROLLUP_CAMPAIGN], error: null },
      campaign_assets: {
        data: [
          {
            ...rollupAsset("asset-email", "email"),
            title: "Partner intro email",
            channel: "email",
            draft_body: "Subject: Fast help when a leak turns into a water-loss claim",
          },
          {
            ...rollupAsset("asset-image", "social_ad"),
            title: "Storm cleanup image",
            channel: "social_ad",
            draft_body: "",
            audit_payload: { media_assets: [{ url: "https://cdn.example/storm.png", type: "image", title: "Storm cleanup" }] },
          },
        ],
        error: null,
      },
      approval_items: { data: [], error: null },
    });

    const list = await getCampaignWorkspaceList(supabase, "Arc", "org-1");

    expect(list.status).toBe("live");
    if (list.status !== "live") return;

    expect(list.campaigns[0].contentPieces).toEqual([
      expect.objectContaining({
        title: "Partner intro email",
        kind: "Email",
        channel: "Email",
        // The STORED status, not a label: this field mirrors
        // CampaignWorkspaceAsset.status, which the detail view re-parses and
        // writes raw values back into. Labelling happens at render.
        status: "pending_approval",
        preview: "Subject: Fast help when a leak turns into a water-loss claim",
        media: [],
      }),
      expect.objectContaining({
        title: "Storm cleanup image",
        kind: "Social Ad",
        channel: "Social Ad",
        media: [expect.objectContaining({ url: "https://cdn.example/storm.png", type: "image" })],
      }),
    ]);
  });

  // The board renders these two as the row's cover image and its asset count.
  // They were computed here for a long time before anything consumed them.
  it("exposes a cover thumbnail and media count for the board row", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: { data: [ROLLUP_CAMPAIGN], error: null },
      campaign_assets: {
        data: [
          {
            ...rollupAsset("asset-video", "video"),
            audit_payload: {
              media_assets: [
                { url: "https://cdn.example/clip.mp4", type: "video", thumbnail_url: "https://cdn.example/poster.jpg" },
              ],
            },
          },
          {
            ...rollupAsset("asset-image", "social_ad"),
            audit_payload: { media_assets: [{ url: "https://cdn.example/hero.png", type: "image" }] },
          },
        ],
        error: null,
      },
      approval_items: { data: [], error: null },
    });

    const list = await getCampaignWorkspaceList(supabase, "Arc", "org-1");

    expect(list.status).toBe("live");
    if (list.status !== "live") return;

    // A real image outranks a video poster even when the video comes first.
    expect(list.campaigns[0].thumbnailUrl).toBe("https://cdn.example/hero.png");
    expect(list.campaigns[0].mediaCount).toBe(2);
  });

  it("never covers a row with a URL scavenged out of prose", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: { data: [ROLLUP_CAMPAIGN], error: null },
      campaign_assets: {
        data: [
          {
            ...rollupAsset("asset-email", "email"),
            // A bare image URL sitting in the draft copy is `referenced`, not
            // creative. Promoting one to the campaign's cover is precisely the
            // fabricated-image failure the origin split exists to prevent.
            draft_body: "See the example at https://untrusted.example/scraped.png for reference.",
            audit_payload: {},
          },
        ],
        error: null,
      },
      approval_items: { data: [], error: null },
    });

    const list = await getCampaignWorkspaceList(supabase, "Arc", "org-1");

    expect(list.status).toBe("live");
    if (list.status !== "live") return;

    expect(list.campaigns[0].thumbnailUrl).toBeNull();
    expect(list.campaigns[0].mediaCount).toBe(0);
  });
});

describe("listCampaignNames", () => {
  it("scopes the @-mention name list to the given org", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: { data: [{ id: "c-1", name: "Spring Promo" }], error: null },
    });

    const names = await listCampaignNames("org-1", supabase);

    expect(names).toEqual([{ id: "c-1", name: "Spring Promo", href: "/campaigns/c-1" }]);
    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
  });

  it("does not filter by org when no org id is given", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: { data: [], error: null },
    });

    await listCampaignNames(undefined, supabase);

    expect(supabase.calls.some((call) => call[0] === "eq" && call[1] === "org_id")).toBe(false);
  });
});

describe("getCampaignWorkspaceDetail guardrail + recommendation", () => {
  function mocks(overrides: { guardrail?: unknown; recommendations?: MockResponse } = {}) {
    return createSupabaseQueryMock({
      campaigns: {
        data: {
          id: "camp-1",
          name: "Storm push",
          persona: "persona_landlord",
          restoration_focus: "flood",
          status: "pending_approval",
          company_id: null,
          contact_id: null,
          lead_id: null,
          owner: "Arc",
          objective: "Storm campaign",
          audience_summary: null,
          offer_summary: null,
          compliance_notes: null,
          launch_locked: true,
          source_signal: {},
          reasoning_payload: {},
          audit_payload: {},
          created_at: "2026-07-16T12:00:00.000Z",
          updated_at: "2026-07-16T12:00:00.000Z",
        },
        error: null,
      },
      campaign_assets: {
        data: [
          {
            id: "asset-1",
            campaign_id: "camp-1",
            asset_type: "email",
            channel: "email",
            title: "Storm email",
            status: "needs_compliance",
            tool_source: "arc_saved",
            prompt_input: null,
            prompt_inputs: {},
            draft_body: "We guarantee your claim will be approved.",
            edited_body: null,
            approved_body: null,
            dispatch_locked: true,
            compliance_notes: "Blocked by guardrails: contains disallowed language.",
            reasoning_payload: {},
            audit_payload: {
              outbound_locked: true,
              guardrail: overrides.guardrail ?? {
                flags: ["Human review required", "Banned phrase detected"],
                blocked_phrases: ["we guarantee"],
              },
            },
            created_at: "2026-07-16T12:00:00.000Z",
            updated_at: "2026-07-16T12:00:00.000Z",
          },
        ],
        error: null,
      },
      approval_items: {
        data: [
          {
            id: "appr-1",
            campaign_id: "camp-1",
            campaign_asset_id: "asset-1",
            item_type: "campaign_asset",
            status: "needs_compliance",
            locked_until_approved: true,
            prompt_inputs: {},
            draft_output: null,
            edited_output: null,
            requested_by: "Arc",
            submitted_at: "2026-07-16T12:00:00.000Z",
            risk_level: "blocked",
            compliance_notes: "Blocked by guardrails: contains disallowed language.",
            decision_notes: null,
            reasoning_payload: {},
            audit_payload: {},
            created_at: "2026-07-16T12:00:00.000Z",
            updated_at: "2026-07-16T12:00:00.000Z",
          },
        ],
        error: null,
      },
      approval_recommendations: overrides.recommendations ?? {
        data: [
          {
            id: "rec-1",
            approval_item_id: "appr-1",
            agent: "draft-critic",
            recommendation: "request revision",
            rationale: "The payout promise is not supported by any workspace proof point.",
            risk_flags: ["claim_risk"],
            suggested_edits: "Drop the guarantee; state the documented response time instead.",
            created_at: "2026-07-16T12:05:00.000Z",
          },
        ],
        error: null,
      },
    });
  }

  it("carries the copy screen's verdict onto the deliverable", async () => {
    const detail = await getCampaignWorkspaceDetail("camp-1", mocks(), "Arc", "org-1");

    expect(detail.status).toBe("live");
    if (detail.status !== "live") return;
    const asset = detail.assets.find((a) => a.id === "asset-1");
    expect(asset?.blockedPhrases).toEqual(["we guarantee"]);
    expect(asset?.guardrailFlags).toContain("Banned phrase detected");
  });

  it("surfaces the agent's advisory recommendation on the deliverable", async () => {
    const detail = await getCampaignWorkspaceDetail("camp-1", mocks(), "Arc", "org-1");

    expect(detail.status).toBe("live");
    if (detail.status !== "live") return;
    const asset = detail.assets.find((a) => a.id === "asset-1");
    expect(asset?.recommendation).toMatchObject({
      agent: "draft-critic",
      verdict: "request revision",
      riskFlags: ["claim_risk"],
    });
    expect(asset?.recommendation?.suggestedEdits).toContain("Drop the guarantee");
  });

  it("still renders the campaign when the recommendations read fails", async () => {
    // Advisory data must never take down the page — e.g. the table not existing.
    const supabase = mocks({
      recommendations: { data: null, error: { message: 'relation "approval_recommendations" does not exist' } },
    });

    const detail = await getCampaignWorkspaceDetail("camp-1", supabase, "Arc", "org-1");

    expect(detail.status).toBe("live");
    if (detail.status !== "live") return;
    const asset = detail.assets.find((a) => a.id === "asset-1");
    // The deliverable still renders, just without the advisory block.
    expect(asset?.recommendation).toBeNull();
    expect(asset?.blockedPhrases).toEqual(["we guarantee"]);
  });

  it("leaves an unscreened, un-recommended asset with empty guardrail data", async () => {
    const detail = await getCampaignWorkspaceDetail(
      "camp-1",
      mocks({ guardrail: {}, recommendations: { data: [], error: null } }),
      "Arc",
      "org-1",
    );

    expect(detail.status).toBe("live");
    if (detail.status !== "live") return;
    const asset = detail.assets.find((a) => a.id === "asset-1");
    expect(asset?.blockedPhrases).toEqual([]);
    expect(asset?.guardrailFlags).toEqual([]);
    expect(asset?.recommendation).toBeNull();
  });
});

describe("getCampaignWorkspaceDetail claims-review state", () => {
  /** A recommendation row from a given agent, minimal but shaped like the real one. */
  function rec(agent: string) {
    return {
      id: `rec-${agent}`,
      approval_item_id: "appr-1",
      agent,
      recommendation: "request revision",
      rationale: "…",
      risk_flags: [],
      suggested_edits: null,
      created_at: "2026-07-16T12:05:00.000Z",
    };
  }

  function detailWith(recommendations: MockResponse) {
    return createSupabaseQueryMock({
      campaigns: {
        data: {
          id: "camp-1", name: "Storm push", persona: "persona_landlord", restoration_focus: "flood",
          status: "pending_approval", company_id: null, contact_id: null, lead_id: null, owner: "Arc",
          objective: null, audience_summary: null, offer_summary: null, compliance_notes: null,
          launch_locked: true, source_signal: {}, reasoning_payload: {}, audit_payload: {},
          created_at: "2026-07-16T12:00:00.000Z", updated_at: "2026-07-16T12:00:00.000Z",
        },
        error: null,
      },
      campaign_assets: {
        data: [
          {
            id: "asset-1", campaign_id: "camp-1", asset_type: "email", channel: "email",
            title: "Storm email", status: "pending_approval", tool_source: "arc_saved",
            prompt_input: null, prompt_inputs: {}, draft_body: "We respond in 60 minutes.",
            edited_body: null, approved_body: null, dispatch_locked: true, compliance_notes: null,
            reasoning_payload: {}, audit_payload: { outbound_locked: true },
            created_at: "2026-07-16T12:00:00.000Z", updated_at: "2026-07-16T12:00:00.000Z",
          },
        ],
        error: null,
      },
      approval_items: {
        data: [
          {
            id: "appr-1", campaign_id: "camp-1", campaign_asset_id: "asset-1",
            item_type: "campaign_asset", status: "pending_approval", locked_until_approved: true,
            prompt_inputs: {}, draft_output: null, edited_output: null, requested_by: "Arc",
            submitted_at: "2026-07-16T12:00:00.000Z", risk_level: "medium", compliance_notes: null,
            decision_notes: null, reasoning_payload: {}, audit_payload: {},
            created_at: "2026-07-16T12:00:00.000Z", updated_at: "2026-07-16T12:00:00.000Z",
          },
        ],
        error: null,
      },
      approval_recommendations: recommendations,
    });
  }

  async function assetFrom(recommendations: MockResponse) {
    const detail = await getCampaignWorkspaceDetail("camp-1", detailWith(recommendations), "Arc", "org-1");
    if (detail.status !== "live") throw new Error("expected a live detail");
    return detail.assets.find((a) => a.id === "asset-1")!;
  }

  it("is unreviewed until the critic has actually run", async () => {
    const asset = await assetFrom({ data: [], error: null });
    expect(asset.claimsReviewed).toBe(false);
  });

  it("is reviewed once draft-critic has weighed in", async () => {
    const asset = await assetFrom({ data: [rec("draft-critic")], error: null });
    expect(asset.claimsReviewed).toBe(true);
  });

  it("does NOT count Arc advising on its own work as an independent review", async () => {
    // recommend_on_approval writes as `arc`. Letting that flip the flag would mean
    // the drafting agent vouching for itself reads as a review it never got.
    const asset = await assetFrom({ data: [rec("arc")], error: null });
    expect(asset.claimsReviewed).toBe(false);
    expect(asset.recommendation?.agent).toBe("arc");
  });

  it("stays reviewed when Arc adds a newer note on top of the critic's", async () => {
    // pickRecommendation shows the newest row; claimsReviewed must not depend on
    // which one happens to be at the head.
    const asset = await assetFrom({ data: [rec("arc"), rec("draft-critic")], error: null });
    expect(asset.claimsReviewed).toBe(true);
  });

  it("stays unreviewed when the recommendations read fails, rather than claiming a review", async () => {
    const asset = await assetFrom({ data: null, error: { message: "boom" } });
    expect(asset.claimsReviewed).toBe(false);
  });
});

// BSR-639. Campaigns are workspace-owned (BSR-637), so a campaign must not be
// listed outside the workspace that owns it. Before this, `campaigns.workspace_id`
// existed, was nullable, and no read filtered on it — a campaign created in one
// workspace appeared in every workspace of the org.
describe("campaign reads are workspace-scoped", () => {
  function eqCalls(supabase: { calls: Array<[string, ...unknown[]]> }) {
    return supabase.calls.filter(([method]) => method === "eq").map(([, column, value]) => [column, value]);
  }

  it("filters listCampaignNames on the workspace as well as the org", async () => {
    const supabase = createSupabaseQueryMock({ campaigns: { data: [], error: null } });

    await listCampaignNames("org-1", supabase, "workspace-1");

    expect(eqCalls(supabase)).toEqual(
      expect.arrayContaining([
        ["org_id", "org-1"],
        ["workspace_id", "workspace-1"],
      ]),
    );
  });

  it("filters the campaign list on the workspace as well as the org", async () => {
    // A campaign must come back, or selectIn short-circuits on an empty id list
    // and never reaches the filter this test is about.
    const supabase = createSupabaseQueryMock({
      campaigns: { data: [{ id: "camp-1", name: "C", persona: "p", status: "draft" }], error: null },
      campaign_assets: { data: [], error: null },
      approval_items: { data: [], error: null },
    });

    await getCampaignWorkspaceList(supabase, "Arc", "org-1", "workspace-1");

    expect(eqCalls(supabase)).toEqual(
      expect.arrayContaining([
        ["org_id", "org-1"],
        ["workspace_id", "workspace-1"],
      ]),
    );
  });

  it("degrades to org-only scoping when no workspace is resolved, rather than returning nothing", async () => {
    // Real paths arrive without a workspace: the offline demo, open/operator auth
    // mode, and bearer tokens issued before workspace scoping. Those must keep
    // working — silently returning an empty list would read as data loss.
    const supabase = createSupabaseQueryMock({ campaigns: { data: [], error: null } });

    await listCampaignNames("org-1", supabase);

    expect(eqCalls(supabase)).toContainEqual(["org_id", "org-1"]);
    expect(eqCalls(supabase).some(([column]) => column === "workspace_id")).toBe(false);
  });
});

// BSR-711. Phase B narrows RLS to workspace membership, but every read model here
// runs on the service-role client, which bypasses RLS entirely — so this app-layer
// filter IS the boundary for these tables, not a belt-and-braces extra.
describe("adjacent campaign tables are workspace-filtered too", () => {
  function eqCalls(supabase: { calls: Array<[string, ...unknown[]]> }) {
    return supabase.calls.filter(([m]) => m === "eq").map(([, c, v]) => [c, v]);
  }

  it("filters the campaign-adjacent tables on workspace, not just campaigns", async () => {
    // A campaign must come back, or selectIn short-circuits on an empty id list
    // and never reaches the filter this test is about.
    const supabase = createSupabaseQueryMock({
      campaigns: { data: [{ id: "camp-1", name: "C", persona: "p", status: "draft" }], error: null },
      campaign_assets: { data: [], error: null },
      approval_items: { data: [], error: null },
    });

    await getCampaignWorkspaceList(supabase, "Arc", "org-1", "workspace-1");

    // campaign_assets / approval_items go through selectIn, which used to apply
    // org scope alone — the gap Phase B closes.
    const workspaceFilters = eqCalls(supabase).filter(([c]) => c === "workspace_id");
    expect(workspaceFilters.length).toBeGreaterThan(1);
    for (const [, value] of workspaceFilters) expect(value).toBe("workspace-1");
  });

  it("does NOT filter org-owned tables on a column they do not have", async () => {
    // companies/contacts/leads are org-owned by the BSR-637 boundary. Filtering
    // them on workspace_id would not error — it would return NOTHING, and a CRM
    // panel that silently empties is indistinguishable from data loss.
    const supabase = createSupabaseQueryMock({ companies: { data: [], error: null } });

    await selectIn(supabase, "companies", "id,name", "id", ["c1"], undefined, "org-1", "workspace-1");

    expect(eqCalls(supabase)).toContainEqual(["org_id", "org-1"]);
    expect(eqCalls(supabase).some(([c]) => c === "workspace_id")).toBe(false);
  });

  it("still filters a workspace-owned table when asked", async () => {
    const supabase = createSupabaseQueryMock({ campaign_assets: { data: [], error: null } });
    await selectIn(supabase, "campaign_assets", "id", "campaign_id", ["c1"], undefined, "org-1", "workspace-1");
    expect(eqCalls(supabase)).toContainEqual(["workspace_id", "workspace-1"]);
  });
});

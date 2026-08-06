import { afterEach, describe, expect, it, vi } from "vitest";

import { WORK_STATE_LABEL } from "@/domain";
import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { countActiveApprovals, listApprovalCards, listApprovalHistory } from "./read-model";

const approvalItemRow = {
  id: "10000000-0000-4000-8000-000000000001",
  campaign_id: "10000000-0000-4000-8000-000000000002",
  campaign_asset_id: "10000000-0000-4000-8000-000000000003",
  company_id: "10000000-0000-4000-8000-000000000004",
  contact_id: "10000000-0000-4000-8000-000000000005",
  lead_id: "10000000-0000-4000-8000-000000000006",
  item_type: "email_campaign_asset",
  status: "pending_owner_approval",
  prompt_inputs: {
    persona: "persona_plumbing_partner",
    channel: "email",
    tone: "professional",
    cta: "Set up referral handoff process",
  },
  draft_output: "Approval item draft output",
  edited_output: null,
  requested_by: "Arc Demo Orchestrator",
  locked_until_approved: true,
  submitted_at: "2026-05-29T18:02:38.000Z",
  risk_level: "medium",
  compliance_notes: "Review before outbound. Coverage-neutral. No guarantee language.",
  decision_notes: null,
  reasoning_payload: {
    recommended_action: "Approve if brand voice is acceptable.",
    source_data: {
      website: "https://example-plumbing.local",
    },
  },
  audit_payload: {
    created_by_agent_id: "10000000-0000-4000-8000-000000000007",
  },
  created_at: "2026-05-29T18:02:38.000Z",
  updated_at: "2026-05-29T18:02:38.000Z",
};

describe("listApprovalCards", () => {
  it("returns UI-ready approval cards with related campaign, asset, CRM, and agent output data", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: [approvalItemRow], error: null },
      campaigns: {
        data: [
          {
            id: approvalItemRow.campaign_id,
            name: "Plumbing Partner Outreach Demo",
            persona: "persona_plumbing_partner",
            status: "pending_approval",
            objective: "Create a referral relationship.",
            audience_summary: "Chicago plumbing operators",
            offer_summary: "Fast handoff",
            compliance_notes: "Coverage-neutral.",
          },
        ],
        error: null,
      },
      campaign_assets: {
        data: [
          {
            id: approvalItemRow.campaign_asset_id,
            title: "Initial plumbing partner referral email",
            asset_type: "email",
            channel: "email",
            status: "pending_approval",
            prompt_input: "Draft coverage-neutral first-touch copy.",
            prompt_inputs: {
              urgency: "medium",
              damage_classification: "water_backup",
            },
            draft_body: "Asset draft output",
            edited_body: null,
            approved_body: null,
            compliance_notes: "No claim promise.",
            reasoning_payload: {
              creative_assets: [
                {
                  title: "Plumbing partner display ad",
                  type: "image",
                  image_url: "https://cdn.example.test/plumbing-ad.png",
                  description: "Square ad concept for partner outreach.",
                },
                {
                  title: "Referral motion concept",
                  type: "video",
                  video_url: "https://cdn.example.test/plumbing-video.mp4",
                  thumbnail_url: "https://cdn.example.test/plumbing-video-poster.jpg",
                },
              ],
            },
          },
        ],
        error: null,
      },
      companies: {
        data: [
          {
            id: approvalItemRow.company_id,
            name: "Demo Plumbing Partner",
            persona: "persona_plumbing_partner",
            partner_tier: "A",
          },
        ],
        error: null,
      },
      contacts: {
        data: [
          {
            id: approvalItemRow.contact_id,
            full_name: "Jordan Demo",
            email: "jordan@example.test",
            phone: "312-555-0198",
            title: "Operations Manager",
          },
        ],
        error: null,
      },
      leads: {
        data: [
          {
            id: approvalItemRow.lead_id,
            source: "arc_demo",
            status: "needs_review",
            lead_score: 88,
            loss_summary: "Plumbing partner lead",
            metadata: {
              evidence_urls: ["https://maps.example.test/plumbing"],
            },
          },
        ],
        error: null,
      },
      agent_outputs: {
        data: [
          {
            id: "10000000-0000-4000-8000-000000000008",
            approval_item_id: approvalItemRow.id,
            output_type: "approval_card",
            title: "Review plumbing partner outreach draft",
            body: "Agent output body",
            risk_level: "medium",
            approval_status: "pending_owner_approval",
            structured_payload: {
              draft_output: {
                lead_list_type: "plumbing_sewer_drain_partner_recommendations",
                target_market: "Chicago partner candidates",
                target_zips_used: ["60614", "60618"],
                suggested_owner_action: "Approve enrichment only.",
                candidates: [
                  {
                    company_name: "Madden Sewer & Drain",
                    persona: "persona_plumbing_partner",
                    target_zips: ["60614"],
                    source_url: "https://www.maddensewer.net/service-area-plumbing",
                    evidence_summary: "North Side sewer and drain services.",
                    partner_score: 88,
                    score_factors: ["Sewer specialization", "North Side fit"],
                    recommended_next_action: "Approve enrichment before outreach.",
                  },
                  {
                    company_name: "Full Circle Plumbing",
                    persona: "persona_plumbing_partner",
                    target_zips: ["60618"],
                    source_url: "https://www.fullcircleplumbing.com/",
                    evidence_summary: "Sump pump and emergency plumbing relevance.",
                    partner_score: 81,
                    score_factors: ["Sump pump services"],
                    recommended_next_action: "Verify decision-maker.",
                  },
                ],
              },
            },
          },
        ],
        error: null,
      },
    });

    const cards = await listApprovalCards({ orgId: "org-1" }, supabase);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: approvalItemRow.id,
      title: "Review plumbing partner outreach draft",
      previewText: "2 partner candidates: Madden Sewer & Drain, Full Circle Plumbing",
      // `pending_owner_approval` and `pending_approval` collapse to one label:
      // to the person looking at it, both mean it is on their desk.
      statusLabel: WORK_STATE_LABEL.needs_you,
      riskLevel: "medium",
      persona: "persona_plumbing_partner",
      channel: "email",
      sourceAgent: "Arc Demo Orchestrator",
      campaign: {
        name: "Plumbing Partner Outreach Demo",
        objective: "Create a referral relationship.",
      },
      asset: {
        title: "Initial plumbing partner referral email",
        type: "email",
      },
      relatedRecords: {
        company: {
          label: "Demo Plumbing Partner",
          detail: "Tier A partner candidate",
        },
        contact: {
          label: "Jordan Demo",
          detail: "Operations Manager",
        },
        lead: {
          label: "arc_demo lead",
          detail: "needs_review, score 88",
        },
      },
      recommendedAction: "Approve if brand voice is acceptable.",
    });
    expect(cards[0].promptInput).toContain("Persona: persona_plumbing_partner");
    expect(cards[0].promptInput).toContain("Damage Classification: water_backup");
    expect(cards[0].draftOutput).toBe("Approval item draft output");
    expect(cards[0].structuredDraft).toMatchObject({
      kind: "partner_lead_list",
      leadListType: "plumbing_sewer_drain_partner_recommendations",
      targetZips: ["60614", "60618"],
      candidates: [
        {
          companyName: "Madden Sewer & Drain",
          partnerScore: 88,
          sourceUrl: "https://www.maddensewer.net/service-area-plumbing",
        },
        {
          companyName: "Full Circle Plumbing",
          partnerScore: 81,
          sourceUrl: "https://www.fullcircleplumbing.com/",
        },
      ],
    });
    expect(cards[0].complianceFlags).toEqual(
      expect.arrayContaining(["Coverage-neutral", "Human review required", "No guarantee language"]),
    );
    expect(cards[0].riskFlags).toEqual(
      expect.arrayContaining(["Medium risk", "Locked until approved", "Asset Pending Approval", "High-value lead"]),
    );
    expect(cards[0].evidence).toEqual(
      expect.arrayContaining([
        "https://maps.example.test/plumbing",
        "https://example-plumbing.local",
        "https://www.maddensewer.net/service-area-plumbing",
        "https://www.fullcircleplumbing.com/",
      ]),
    );
    expect(cards[0].creativeAssets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image",
          title: "Plumbing partner display ad",
          url: "https://cdn.example.test/plumbing-ad.png",
          description: "Square ad concept for partner outreach.",
        }),
        expect.objectContaining({
          type: "video",
          title: "Referral motion concept",
          url: "https://cdn.example.test/plumbing-video.mp4",
          thumbnailUrl: "https://cdn.example.test/plumbing-video-poster.jpg",
        }),
      ]),
    );
    expect(supabase.calls.filter((call) => call[0] === "eq" && call[1] === "org_id" && call[2] === "org-1")).toHaveLength(7);
  });

  it("prefers the copy screen's structured flags over flags inferred from prose", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: {
        data: [{ ...approvalItemRow, risk_level: "blocked", status: "needs_compliance" }],
        error: null,
      },
      campaign_assets: {
        data: [
          {
            id: approvalItemRow.campaign_asset_id,
            title: "Blocked email",
            asset_type: "email",
            channel: "email",
            status: "needs_compliance",
            prompt_input: null,
            prompt_inputs: {},
            draft_body: "We guarantee your claim will be approved.",
            edited_body: null,
            approved_body: null,
            // Prose the regex fallback would happily mine for reassuring flags.
            compliance_notes: "Coverage-neutral language required. No claim approval promises.",
            reasoning_payload: {},
            audit_payload: {
              outbound_locked: true,
              guardrail: {
                flags: ["Human review required", "Outbound locked until approved", "Banned phrase detected"],
                blocked_phrases: ["we guarantee", "claim will be approved"],
              },
            },
          },
        ],
        error: null,
      },
    });

    const cards = await listApprovalCards({}, supabase);

    // The screen found a banned phrase. The regex fallback cannot see that, and
    // would have reported "Coverage-neutral" — reassurance on blocked copy.
    expect(cards[0].complianceFlags).toContain("Banned phrase detected");
    expect(cards[0].complianceFlags).not.toContain("Coverage-neutral");
    expect(cards[0].riskFlags).toContain("Blocked risk");
  });

  it("queries active approval statuses by default", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: [], error: null },
    });

    await listApprovalCards({}, supabase);

    expect(supabase.calls).toContainEqual([
      "in",
      "status",
      ["needs_compliance", "pending_approval", "pending_owner_approval", "revision_requested"],
    ]);
    expect(supabase.calls).toContainEqual(["order", "submitted_at", { ascending: false }]);
    expect(supabase.calls).toContainEqual(["limit", 50]);
  });

  it("supports custom statuses and limits", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: [], error: null },
    });

    await listApprovalCards({ statuses: ["approved"], limit: 5 }, supabase);

    expect(supabase.calls).toContainEqual(["in", "status", ["approved"]]);
    expect(supabase.calls).toContainEqual(["limit", 5]);
  });

  it("turns generic structured draft JSON into readable approval sections", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: {
        data: [
          {
            ...approvalItemRow,
            campaign_asset_id: null,
            company_id: null,
            contact_id: null,
            lead_id: null,
            item_type: "ad",
            draft_output: JSON.stringify({
              headline: "Fast water-loss handoff",
              primary_text: "When your team stops the source, BSR can help document mitigation and rebuild next steps.",
              cta: "Become a Partner",
              guardrail_note: "No coverage promise.",
            }),
          },
        ],
        error: null,
      },
      campaigns: {
        data: [
          {
            id: approvalItemRow.campaign_id,
            name: "Plumbing Partner Outreach Demo",
            persona: "persona_plumbing_partner",
            status: "pending_approval",
            objective: "Create a referral relationship.",
            audience_summary: "Chicago plumbing operators",
            offer_summary: "Fast handoff",
            compliance_notes: "Coverage-neutral.",
          },
        ],
        error: null,
      },
      campaign_assets: { data: [], error: null },
      companies: { data: [], error: null },
      contacts: { data: [], error: null },
      leads: { data: [], error: null },
      agent_outputs: { data: [], error: null },
    });

    const cards = await listApprovalCards({}, supabase);

    expect(cards[0].previewText).toBe("Fast water-loss handoff");
    expect(cards[0].structuredDraft).toEqual(
      expect.objectContaining({
        kind: "structured_fields",
        title: "Fast water-loss handoff",
        summary: "Fast water-loss handoff",
        sections: expect.arrayContaining([
          { label: "Headline", value: "Fast water-loss handoff" },
          { label: "Primary Text", value: "When your team stops the source, BSR can help document mitigation and rebuild next steps." },
          { label: "Cta", value: "Become a Partner" },
        ]),
      }),
    );
  });

  it("throws when approval item lookup fails (cards)", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: null, error: { message: "db down" } },
    });

    await expect(listApprovalCards({}, supabase)).rejects.toThrow(/listApprovalCards failed: db down/);
  });

  it("throws when a related lookup fails", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: [approvalItemRow], error: null },
      campaigns: { data: null, error: { message: "campaign lookup unavailable" } },
    });

    await expect(listApprovalCards({}, supabase)).rejects.toThrow(/campaigns lookup failed/);
  });
});

describe("countActiveApprovals", () => {
  it("scopes the active-approval count to the given org", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: null, count: 4, error: null },
    });

    const count = await countActiveApprovals("org-1", supabase);

    expect(count).toBe(4);
    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
    expect(supabase.calls).toContainEqual([
      "in",
      "status",
      ["needs_compliance", "pending_approval", "pending_owner_approval", "revision_requested"],
    ]);
  });

  it("does not filter by org when no org id is given", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: null, count: 9, error: null },
    });

    const count = await countActiveApprovals(undefined, supabase);

    expect(count).toBe(9);
    expect(supabase.calls.some((call) => call[0] === "eq" && call[1] === "org_id")).toBe(false);
  });

  it("throws when the count query fails", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: null, count: null, error: { message: "db down" } },
    });

    await expect(countActiveApprovals("org-1", supabase)).rejects.toThrow(/countActiveApprovals failed: db down/);
  });
});

describe("listApprovalHistory", () => {
  it("scopes the decision ledger to the given org", async () => {
    const supabase = createSupabaseQueryMock({
      approval_decisions: { data: [], error: null },
    });

    await listApprovalHistory({ orgId: "org-1" }, supabase);

    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
  });

  it("does not filter by org when no org id is given", async () => {
    const supabase = createSupabaseQueryMock({
      approval_decisions: { data: [], error: null },
    });

    await listApprovalHistory({}, supabase);

    expect(supabase.calls.some((call) => call[0] === "eq" && call[1] === "org_id")).toBe(false);
  });
});

describe("listApprovalCards demo fallback", () => {
  const SUPABASE_ENV = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_MARKETING_SUPABASE_URL",
    "MARKETING_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "MARKETING_SUPABASE_SERVICE_ROLE_KEY",
  ];

  afterEach(() => vi.unstubAllEnvs());

  function unconfigureSupabase() {
    for (const key of SUPABASE_ENV) vi.stubEnv(key, "");
  }

  it("serves demo approval cards derived from demo campaigns when Supabase is unconfigured and demo mode is on", async () => {
    unconfigureSupabase();
    vi.stubEnv("ARC_DEMO_DATA", "1");

    const cards = await listApprovalCards({ limit: 5 });

    // A populated, consistent queue — this is what keeps the home hero count, the
    // "waiting on you" header, and the campaign rows all describing the same work.
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(5);
    for (const card of cards) {
      expect(card.title).toBeTruthy();
      expect(card.status).toBe("pending_approval");
      expect(card.campaign.name).toBeTruthy();
      expect(card.persona).toBeTruthy();
    }
  });

  it("returns an empty queue (no crash) when Supabase is unconfigured and demo mode is off", async () => {
    unconfigureSupabase();
    vi.stubEnv("ARC_DEMO_DATA", "0");

    await expect(listApprovalCards({ limit: 5 })).resolves.toEqual([]);
  });
});

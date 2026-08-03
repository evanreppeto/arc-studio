import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { addApprovalRecommendation, getApprovalForApi, listApprovalRecommendations, listApprovalsForApi } from "../approvals";

const APPROVAL_ID = "50000000-0000-4000-8000-000000000001";

function insertPayload(supabase: ReturnType<typeof createSupabaseQueryMock>) {
  const call = supabase.calls.find(([method]) => method === "insert");
  return call?.[1] as Record<string, unknown> | undefined;
}

describe("addApprovalRecommendation (safety)", () => {
  it("inserts ONLY into approval_recommendations and never touches the decision path", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: { id: APPROVAL_ID }, error: null },
      approval_recommendations: { data: { id: "rec-1" }, error: null },
    });

    const result = await addApprovalRecommendation(
      {
        approvalItemId: APPROVAL_ID,
        recommendation: "Tighten the CTA before approving.",
        rationale: "Compliance prefers explicit opt-out language.",
        riskFlags: ["copy_review"],
      },
      supabase,
      { orgId: "org-1", workspaceId: "workspace-1" },
    );

    expect(result).toMatchObject({ ok: true, recommendationId: "rec-1" });

    // The recommendation is written to its own ledger...
    expect(supabase.calls).toContainEqual(["from", "approval_recommendations"]);
    // ...and the human decision surfaces are NEVER written.
    expect(supabase.calls).not.toContainEqual(["from", "approval_decisions"]);
    // No status mutation anywhere: a recommendation never updates a row.
    expect(supabase.calls.filter(([m]) => m === "update")).toHaveLength(0);
    // Exactly one insert, and it is the recommendation.
    expect(supabase.calls.filter(([m]) => m === "insert")).toHaveLength(1);
    expect(insertPayload(supabase)).toMatchObject({ org_id: "org-1" });
    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
  });

  it("redacts secrets in the recommendation before storing", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: { id: APPROVAL_ID }, error: null },
      approval_recommendations: { data: { id: "rec-2" }, error: null },
    });

    await addApprovalRecommendation(
      {
        approvalItemId: APPROVAL_ID,
        recommendation: "Rotate the leaked key sk-ABCDEFGHIJKLMNOP before approving.",
        rationale: "Authorization: Bearer abcDEF123456 was pasted into the draft.",
      },
      supabase,
      { orgId: "org-1", workspaceId: "workspace-1" },
    );

    const payload = insertPayload(supabase);
    expect(payload?.recommendation).not.toContain("sk-ABCDEFGHIJKLMNOP");
    expect(String(payload?.recommendation)).toContain("[REDACTED]");
    expect(String(payload?.rationale)).not.toContain("abcDEF123456");
  });

  it("returns not_found when the approval item does not exist", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: null, error: null },
    });

    const result = await addApprovalRecommendation(
      { approvalItemId: "missing", recommendation: "hi" },
      supabase,
      { orgId: "org-1", workspaceId: "workspace-1" },
    );

    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    expect(supabase.calls.filter(([m]) => m === "insert")).toHaveLength(0);
  });
});

describe("listApprovalRecommendations", () => {
  it("maps rows newest-first to camelCase", async () => {
    const supabase = createSupabaseQueryMock({
      approval_recommendations: {
        data: [
          {
            id: "rec-1",
            agent: "arc",
            recommendation: "Tighten CTA",
            rationale: null,
            risk_flags: ["copy"],
            suggested_edits: null,
            metadata: {},
            created_at: "2026-06-09T12:00:00.000Z",
          },
        ],
        error: null,
      },
    });

    const recs = await listApprovalRecommendations(APPROVAL_ID, supabase, { orgId: "org-1", workspaceId: "workspace-1" });

    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ id: "rec-1", agent: "arc", riskFlags: ["copy"] });
    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
    expect(supabase.calls).toContainEqual(["order", "created_at", { ascending: false }]);
  });

  it("degrades to [] when the table is missing (pre-migration)", async () => {
    const supabase = createSupabaseQueryMock({
      approval_recommendations: { data: null, error: { message: 'relation "approval_recommendations" does not exist' } },
    });

    await expect(listApprovalRecommendations(APPROVAL_ID, supabase)).resolves.toEqual([]);
  });
});

describe("Arc approval reads", () => {
  it("passes org scope into approval list and detail reads", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: [], error: null },
    });

    await listApprovalsForApi({ limit: 10 }, supabase, { orgId: "org-1", workspaceId: "workspace-1" });

    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
    expect(supabase.calls).toContainEqual(["limit", 10]);
  });

  it("scopes detail reads and recommendation reads to the same org", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: {
        data: [
          {
            id: APPROVAL_ID,
            campaign_id: null,
            campaign_asset_id: null,
            company_id: null,
            contact_id: null,
            lead_id: null,
            item_type: "campaign_copy",
            status: "pending_approval",
            prompt_inputs: {},
            draft_output: "Draft",
            edited_output: null,
            requested_by: "Arc",
            locked_until_approved: true,
            submitted_at: "2026-06-19T12:00:00.000Z",
            risk_level: "medium",
            compliance_notes: null,
            decision_notes: null,
            reasoning_payload: {},
            audit_payload: {},
            created_at: "2026-06-19T12:00:00.000Z",
            updated_at: "2026-06-19T12:00:00.000Z",
          },
        ],
        error: null,
      },
      campaigns: { data: [], error: null },
      campaign_assets: { data: [], error: null },
      companies: { data: [], error: null },
      contacts: { data: [], error: null },
      leads: { data: [], error: null },
      agent_outputs: { data: [], error: null },
      approval_recommendations: { data: [], error: null },
    });

    const approval = await getApprovalForApi(APPROVAL_ID, supabase, { orgId: "org-1", workspaceId: "workspace-1" });

    expect(approval?.id).toBe(APPROVAL_ID);
    expect(supabase.calls.filter((call) => call[0] === "eq" && call[1] === "org_id" && call[2] === "org-1").length).toBeGreaterThanOrEqual(2);
  });
});

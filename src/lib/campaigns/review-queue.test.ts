import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { getWorkspaceReviewQueue } from "./read-model";

function campaign(id: string, name: string) {
  return { id, name, status: "draft", persona: "persona_new_lead", launch_locked: true, updated_at: "2026-08-04T00:00:00Z" };
}

function asset(id: string, campaignId: string, title: string) {
  return {
    id,
    campaign_id: campaignId,
    title,
    asset_type: "email",
    channel: "Email",
    status: "pending_approval",
    draft_body: "Call [24/7 line].",
    dispatch_locked: true,
    updated_at: "2026-08-04T00:00:00Z",
  };
}

describe("getWorkspaceReviewQueue", () => {
  it("collects undecided deliverables from every campaign, each tagged with where it lives", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: { data: [campaign("camp-1", "High-intent follow-up"), campaign("camp-2", "Win-back")], error: null },
      campaign_assets: { data: [asset("a-1", "camp-1", "Email"), asset("a-2", "camp-2", "SMS")], error: null },
      approval_items: { data: [], error: null },
      agent_outputs: { data: [], error: null },
      approval_recommendations: { data: [], error: null },
      guardrail_findings: { data: [], error: null },
    });

    const queue = await getWorkspaceReviewQueue(supabase, "Arc", "org-1", "ws-1");

    expect(queue.status).toBe("live");
    if (queue.status !== "live") return;
    expect(queue.entries).toHaveLength(2);
    expect(queue.entries.map((e) => [e.campaignName, e.asset.title])).toEqual([
      ["High-intent follow-up", "Email"],
      ["Win-back", "SMS"],
    ]);
  });

  it("carries the review, which is the whole reason this is not the list read", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: { data: [campaign("camp-1", "High-intent follow-up")], error: null },
      campaign_assets: { data: [asset("a-1", "camp-1", "Email")], error: null },
      approval_items: {
        data: [{ id: "item-1", campaign_id: "camp-1", campaign_asset_id: "a-1", status: "pending", risk_level: "medium" }],
        error: null,
      },
      agent_outputs: { data: [], error: null },
      approval_recommendations: {
        data: [
          {
            id: "rec-1",
            approval_item_id: "item-1",
            agent: "draft-critic",
            recommendation: "request revision",
            rationale: "The number is a placeholder.",
            risk_flags: ["unsupported_claim"],
            suggested_edits: "",
            created_at: "2026-08-04T00:00:00Z",
          },
        ],
        error: null,
      },
      guardrail_findings: {
        data: [
          {
            id: "find-1",
            campaign_asset_id: "a-1",
            severity: "blocker",
            status: "open",
            matched_text: "Call [24/7 line].",
            finding_message: "Still the placeholder.",
            created_at: "2026-08-04T00:00:00Z",
            fix_target: "[24/7 line]",
            fix_label: "The number to call",
            fix_kind: "phone",
          },
        ],
        error: null,
      },
    });

    const queue = await getWorkspaceReviewQueue(supabase, "Arc", "org-1", "ws-1");

    expect(queue.status).toBe("live");
    if (queue.status !== "live") return;
    const [entry] = queue.entries;
    expect(entry.asset.recommendation?.verdict).toBe("request revision");
    expect(entry.asset.findings[0]).toMatchObject({
      id: "find-1",
      fix: { target: "[24/7 line]", label: "The number to call", kind: "phone" },
    });
  });

  it("leaves out anything already decided", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: { data: [campaign("camp-1", "High-intent follow-up")], error: null },
      campaign_assets: {
        data: [asset("a-1", "camp-1", "Pending"), { ...asset("a-2", "camp-1", "Approved"), status: "approved" }],
        error: null,
      },
      approval_items: { data: [], error: null },
      agent_outputs: { data: [], error: null },
      approval_recommendations: { data: [], error: null },
      guardrail_findings: { data: [], error: null },
    });

    const queue = await getWorkspaceReviewQueue(supabase, "Arc", "org-1", "ws-1");
    expect(queue.status).toBe("live");
    if (queue.status !== "live") return;
    expect(queue.entries.map((e) => e.asset.title)).toEqual(["Pending"]);
  });

  it("still returns the queue when the review tables fail", async () => {
    // A missing critique must not take the queue down with it — an un-reviewed
    // deliverable still needs deciding, and that is the state the card is built
    // to name rather than hide.
    const supabase = createSupabaseQueryMock({
      campaigns: { data: [campaign("camp-1", "High-intent follow-up")], error: null },
      campaign_assets: { data: [asset("a-1", "camp-1", "Email")], error: null },
      approval_items: { data: [], error: null },
      agent_outputs: { data: [], error: null },
      approval_recommendations: { data: null, error: { message: "boom" } },
      guardrail_findings: { data: null, error: { message: "boom" } },
    });

    const queue = await getWorkspaceReviewQueue(supabase, "Arc", "org-1", "ws-1");
    expect(queue.status).toBe("live");
    if (queue.status !== "live") return;
    expect(queue.entries).toHaveLength(1);
    expect(queue.entries[0].asset.findings).toEqual([]);
  });

  it("says it could not find out, rather than reporting an empty queue", async () => {
    // "Nothing is waiting on you" and "we could not tell" are different answers,
    // and only one of them means the reviewer can stop.
    const supabase = createSupabaseQueryMock({
      campaigns: { data: null, error: { message: "connection refused" } },
    });

    const queue = await getWorkspaceReviewQueue(supabase, "Arc", "org-1", "ws-1");
    expect(queue.status).toBe("unavailable");
  });

  it("asks for nothing else when the workspace has no campaigns", async () => {
    const supabase = createSupabaseQueryMock({ campaigns: { data: [], error: null } });
    const queue = await getWorkspaceReviewQueue(supabase, "Arc", "org-1", "ws-1");
    expect(queue).toEqual({ status: "live", entries: [] });
    expect(supabase.calls.filter((c) => c[0] === "from").map((c) => c[1])).toEqual(["campaigns"]);
  });
});

import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { enqueueDispatchesForAssets, transitionDispatch } from "./persistence";

function findCalls(supabase: { calls: Array<[string, ...unknown[]]> }, method: string) {
  return supabase.calls.filter(([m]) => m === method).map(([, arg]) => arg as Record<string, unknown>);
}

const CAMPAIGN = { persona: "persona_homeowner_emergency", contact_id: null, company_id: null };
const EMAIL_ASSET = { id: "a1", channel: "email", title: "Welcome", approved_body: "Hi there", edited_body: null, draft_body: null };
const APPROVAL_A1 = { id: "ap1", campaign_asset_id: "a1", status: "approved" };
const CONTACT = { id: "ct1", persona: "persona_homeowner_emergency", status: "active", email: "lead@example.com", phone: "3125550100", full_name: "Lead One", company_id: null };

function emailCampaignMock(overrides: { contacts?: unknown[] } = {}) {
  return createSupabaseQueryMock({
    campaigns: { data: CAMPAIGN, error: null },
    campaign_assets: { data: [EMAIL_ASSET], error: null },
    approval_items: { data: [APPROVAL_A1], error: null },
    contacts: { data: overrides.contacts ?? [CONTACT], error: null },
    campaign_dispatches: { data: [], error: null },
    campaign_events: { data: null, error: null },
  });
}

describe("enqueueDispatchesForAssets (producer)", () => {
  it("fans an email deliverable out to one approval-linked queued row per resolved recipient", async () => {
    const supabase = emailCampaignMock();

    await enqueueDispatchesForAssets({ campaignId: "c1", assetIds: ["a1"], operator: "Operator", tenant: { org_id: "org-1", workspace_id: "workspace-1" } }, supabase);

    const inserts = findCalls(supabase, "insert");
    expect(inserts).toContainEqual(
      expect.objectContaining({
        campaign_id: "c1",
        campaign_asset_id: "a1",
        status: "queued",
        channel: "email",
        org_id: "org-1",
        contact_id: "ct1",
        approval_item_id: "ap1",
        idempotency_key: "c1:a1:email:ct1",
      }),
    );
    expect(inserts).toContainEqual(expect.objectContaining({ event_type: "dispatch_queued", org_id: "org-1" }));
    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
  });

  it("builds a to/subject/text payload from the approved asset body", async () => {
    const supabase = emailCampaignMock();
    await enqueueDispatchesForAssets({ campaignId: "c1", assetIds: ["a1"], operator: "Operator", tenant: { org_id: "org-1", workspace_id: "workspace-1" } }, supabase);

    const dispatch = findCalls(supabase, "insert").find((row) => row.campaign_asset_id === "a1");
    expect(dispatch?.payload).toMatchObject({ to: "lead@example.com", subject: "Welcome", text: "Hi there" });
  });

  it("suppresses opted-out contacts — no queued dispatch row, only the summary event", async () => {
    const supabase = emailCampaignMock({ contacts: [{ ...CONTACT, status: "do_not_contact" }] });
    await enqueueDispatchesForAssets({ campaignId: "c1", assetIds: ["a1"], operator: "Operator", tenant: { org_id: "org-1", workspace_id: "workspace-1" } }, supabase);

    const inserts = findCalls(supabase, "insert");
    expect(inserts.filter((row) => "campaign_asset_id" in row && row.status === "queued")).toHaveLength(0);
    expect(inserts).toContainEqual(expect.objectContaining({ event_type: "dispatch_queued" }));
  });

  it("does nothing for an empty asset list", async () => {
    const supabase = createSupabaseQueryMock({ campaign_dispatches: { data: [], error: null } });
    await enqueueDispatchesForAssets({ campaignId: "c1", assetIds: [], operator: "Operator", tenant: { org_id: "org-1", workspace_id: "workspace-1" } }, supabase);
    expect(findCalls(supabase, "insert")).toHaveLength(0);
  });

  it("schedules dispatches (status + scheduled_for + dispatch_scheduled event) when scheduledFor is given", async () => {
    const supabase = emailCampaignMock();

    await enqueueDispatchesForAssets(
      { campaignId: "c1", assetIds: ["a1"], operator: "Operator", scheduledFor: "2026-07-01T09:00:00.000Z", tenant: { org_id: "org-1", workspace_id: "workspace-1" } },
      supabase,
    );

    const inserts = findCalls(supabase, "insert");
    expect(inserts).toContainEqual(expect.objectContaining({ campaign_asset_id: "a1", status: "scheduled", scheduled_for: "2026-07-01T09:00:00.000Z" }));
    expect(inserts).toContainEqual(expect.objectContaining({ event_type: "dispatch_scheduled" }));
  });

  it("keeps non-addressable deliverables (SMS/social) as a single deliverable-level row", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: { data: CAMPAIGN, error: null },
      campaign_assets: {
        data: [EMAIL_ASSET, { id: "a2", channel: "sms", title: "Reminder", approved_body: "Ping", edited_body: null, draft_body: null }],
        error: null,
      },
      approval_items: { data: [APPROVAL_A1, { id: "ap2", campaign_asset_id: "a2", status: "approved" }], error: null },
      contacts: { data: [CONTACT], error: null },
      campaign_dispatches: { data: [], error: null },
      campaign_events: { data: null, error: null },
    });

    await enqueueDispatchesForAssets({ campaignId: "c1", assetIds: ["a1", "a2"], operator: "Operator", tenant: { org_id: "org-1", workspace_id: "workspace-1" } }, supabase);

    const inserts = findCalls(supabase, "insert");
    // a1 email → 1 recipient row + event; a2 sms → 1 deliverable-level row + event = 4 inserts
    expect(inserts).toHaveLength(4);
    expect(inserts).toContainEqual(expect.objectContaining({ campaign_asset_id: "a1", status: "queued", contact_id: "ct1" }));
    expect(inserts).toContainEqual(expect.objectContaining({ campaign_asset_id: "a2", status: "queued", contact_id: null }));
  });
});

describe("transitionDispatch", () => {
  it("marks a dispatch sent, stamps dispatched_at, and logs an event", async () => {
    const supabase = createSupabaseQueryMock({
      campaign_dispatches: { data: { id: "d1", campaign_id: "c1", status: "queued" }, error: null },
      campaign_events: { data: null, error: null },
    });

    await transitionDispatch({ dispatchId: "d1", to: "sent", operator: "Operator", tenant: { org_id: "org-1", workspace_id: "workspace-1" } }, supabase);

    const updates = findCalls(supabase, "update");
    expect(updates).toContainEqual(expect.objectContaining({ status: "sent" }));
    expect(updates.some((u) => "dispatched_at" in u)).toBe(true);
    expect(findCalls(supabase, "insert")).toContainEqual(expect.objectContaining({ event_type: "dispatch_sent", org_id: "org-1" }));
    expect(supabase.calls.filter((call) => call[0] === "eq" && call[1] === "org_id" && call[2] === "org-1")).toHaveLength(2);
  });

  it("rejects an unknown target status", async () => {
    const supabase = createSupabaseQueryMock({ campaign_dispatches: { data: { id: "d1", campaign_id: "c1", status: "queued" }, error: null } });
    await expect(
      transitionDispatch({ dispatchId: "d1", to: "bogus" as never, operator: "Operator" }, supabase),
    ).rejects.toThrow(/status/i);
  });

  it("does not emit an event when transitioning to scheduled", async () => {
    const supabase = createSupabaseQueryMock({
      campaign_dispatches: { data: { id: "d1", campaign_id: "c1", status: "queued" }, error: null },
      campaign_events: { data: null, error: null },
    });

    await transitionDispatch({ dispatchId: "d1", to: "scheduled", operator: "Operator", scheduledFor: "2026-07-01T00:00:00Z" }, supabase);

    // status update happens...
    expect(findCalls(supabase, "update")).toContainEqual(expect.objectContaining({ status: "scheduled" }));
    // ...but "scheduled" has no event mapping, so NO event insert
    expect(findCalls(supabase, "insert")).toHaveLength(0);
  });
});

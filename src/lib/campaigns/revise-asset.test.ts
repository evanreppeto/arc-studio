import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock, type MockSupabase } from "@/lib/repos/__tests__/test-helpers";

import { reviseCampaignAsset } from "./revise-asset";

type AssetRow = {
  id: string;
  campaign_id: string;
  asset_type: string;
  title: string;
  status: string;
  draft_body: string | null;
  edited_body: string | null;
  approved_body: string | null;
  audit_payload: Record<string, unknown>;
};

const ASSET: AssetRow = {
  id: "asset-1",
  campaign_id: "camp-1",
  asset_type: "sms",
  title: "Storm response SMS",
  status: "revision_requested",
  draft_body: "Water damage? Call [24/7 line] — crews out today.",
  edited_body: null,
  approved_body: null,
  audit_payload: {},
};

const REVISED = "Water damage? Call (773) 900-8407 — crews out today.";
const SCOPE = { orgId: "org-1", workspaceId: "ws-1" };

/**
 * campaign_assets is read and written several times: the scoped lookup, then
 * `editDraftAsset`'s update (which reads back org_id) and its workspace lookup,
 * then the status update. The mock replays this queue in order and reuses the
 * last entry, which is what the trailing update lands on.
 */
function mockClient(over: Partial<AssetRow> = {}, extra: Record<string, unknown> = {}): MockSupabase {
  return createSupabaseQueryMock({
    campaign_assets: [
      { data: { ...ASSET, ...over }, error: null },
      { data: { org_id: "org-1" }, error: null },
      { data: { workspace_id: "ws-1" }, error: null },
    ],
    approval_items: [{ data: { id: "ap-1" }, error: null }, { data: null, error: null }],
    campaign_events: { data: { id: "evt-1" }, error: null },
    business_profiles: { data: null, error: null },
    ...extra,
  });
}

/** Every update payload the call issued, so a write can be asserted by content. */
function updates(client: MockSupabase): Array<Record<string, unknown>> {
  return client.calls.filter((c) => c[0] === "update").map((c) => c[1] as Record<string, unknown>);
}

function writes(client: MockSupabase): string[] {
  return client.calls.filter((c) => c[0] === "update" || c[0] === "insert").map((c) => c[0] as string);
}

describe("reviseCampaignAsset", () => {
  it("writes the revised copy and sends the deliverable back for review", async () => {
    const client = mockClient();

    const result = await reviseCampaignAsset({ assetId: "asset-1", body: REVISED, ...SCOPE }, "Arc", client);

    expect(result).toMatchObject({ ok: true, assetId: "asset-1", campaignId: "camp-1", status: "pending_approval" });

    const edit = updates(client).find((u) => u.edited_body);
    expect(edit?.edited_body, "the revision has to land in the copy the review screen shows").toBe(REVISED);

    const reopen = updates(client).find((u) => u.status === "pending_approval");
    expect(reopen, "left revision_requested it reads as still waiting on Arc, forever").toBeTruthy();
  });

  it("never unlocks dispatch", async () => {
    // A revision is not an approval. Nothing here may touch the outbound gate.
    const client = mockClient();
    await reviseCampaignAsset({ assetId: "asset-1", body: REVISED, ...SCOPE }, "Arc", client);

    for (const update of updates(client)) {
      expect(update).not.toHaveProperty("dispatch_locked");
      expect(update).not.toHaveProperty("approved_body");
      expect(update).not.toHaveProperty("approved_at");
    }
  });

  it("refuses copy identical to what is already on the asset", async () => {
    // The BSR-759 failure in one line: a revision that changed nothing reported
    // success, and the task status agreed. Refusing is what makes "Arc revised
    // it" impossible to say over a row that never moved.
    const client = mockClient();

    const result = await reviseCampaignAsset(
      { assetId: "asset-1", body: ASSET.draft_body ?? "", ...SCOPE },
      "Arc",
      client,
    );

    expect(result).toEqual({ ok: false, reason: "unchanged" });
    expect(writes(client)).toEqual([]);
  });

  it("compares against the copy the operator is looking at, not the original draft", async () => {
    // edited_body wins over draft_body in the review screen. Comparing against
    // draft_body would call a resubmission of the current text a real change.
    const client = mockClient({ edited_body: REVISED });

    const result = await reviseCampaignAsset({ assetId: "asset-1", body: REVISED, ...SCOPE }, "Arc", client);

    expect(result).toEqual({ ok: false, reason: "unchanged" });
    expect(writes(client)).toEqual([]);
  });

  it("refuses to rewrite an asset the operator already approved", async () => {
    // Approval is against specific words. Editing them afterwards leaves an
    // approved asset nobody approved — a way around the gate, not a revision.
    const client = mockClient({ status: "approved", approved_body: "Approved copy." });

    const result = await reviseCampaignAsset({ assetId: "asset-1", body: REVISED, ...SCOPE }, "Arc", client);

    expect(result).toEqual({ ok: false, reason: "already_approved", status: "approved" });
    expect(writes(client)).toEqual([]);
  });

  it("refuses an asset that is not in this workspace", async () => {
    const client = createSupabaseQueryMock({ campaign_assets: { data: null, error: null } });

    const result = await reviseCampaignAsset({ assetId: "someone-elses", body: REVISED, ...SCOPE }, "Arc", client);

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(writes(client)).toEqual([]);
  });

  it("scopes the lookup by org AND workspace, because the asset id is model-supplied", async () => {
    const client = mockClient();
    await reviseCampaignAsset({ assetId: "asset-1", body: REVISED, ...SCOPE }, "Arc", client);

    const filters = client.calls.filter((c) => c[0] === "eq").map((c) => [c[1], c[2]]);
    expect(filters).toContainEqual(["org_id", "org-1"]);
    expect(filters).toContainEqual(["workspace_id", "ws-1"]);
  });

  it("writes nothing when there is no body and no title", async () => {
    const client = mockClient();
    const result = await reviseCampaignAsset({ assetId: "asset-1", ...SCOPE }, "Arc", client);

    expect(result).toEqual({ ok: false, reason: "nothing_to_write" });
    expect(client.calls).toEqual([]);
  });

  it("clears a guardrail flag the revision resolved", async () => {
    // Carrying the previous verdict forward would keep flagging copy for a phrase
    // that is no longer in it — the card would stay red over clean text.
    const client = mockClient({
      audit_payload: { guardrail: { flags: ["banned_phrase"], blocked_phrases: ["guaranteed"] }, outbound_locked: true },
    });

    await reviseCampaignAsset({ assetId: "asset-1", body: REVISED, ...SCOPE }, "Arc", client);

    const audit = updates(client).find((u) => u.audit_payload)?.audit_payload as Record<string, unknown>;
    expect(audit).toBeDefined();
    expect(audit).not.toHaveProperty("guardrail");
    expect(audit, "unrelated audit fields must survive the revision").toMatchObject({ outbound_locked: true });
  });

  it("screens the revised copy, so a revision cannot smuggle a banned phrase through", async () => {
    const client = mockClient(
      {},
      {
        business_profiles: {
          data: { status: "active", display_name: "Acme", banned_phrases: ["guaranteed"] },
          error: null,
        },
      },
    );

    const result = await reviseCampaignAsset(
      { assetId: "asset-1", body: "Guaranteed dry in 24 hours.", ...SCOPE },
      "Arc",
      client,
    );

    expect(result).toMatchObject({ ok: true, status: "needs_compliance", blockedPhrases: ["guaranteed"] });
    const flagged = updates(client).find((u) => u.status === "needs_compliance");
    expect(flagged, "blocked copy must not sit in the queue as an ordinary pending item").toBeTruthy();
  });
});

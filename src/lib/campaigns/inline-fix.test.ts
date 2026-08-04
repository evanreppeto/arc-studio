import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { applyFindingFix } from "./inline-fix";

const OPEN_FINDING = {
  id: "finding-1",
  campaign_asset_id: "asset-1",
  status: "open",
  fix_target: "[24/7 line]",
};

const ASSET = {
  id: "asset-1",
  campaign_id: "camp-1",
  draft_body: "Call [24/7 line] — answered any hour.",
  edited_body: null,
  approved_body: null,
};

/** The tables written to, in order. Ordering is the property that matters most
 *  here, so it gets its own reader. */
function writes(calls: Array<[string, ...unknown[]]>): string[] {
  return calls.filter((c) => c[0] === "update" || c[0] === "insert").map((c) => c[0]);
}

describe("applyFindingFix", () => {
  it("substitutes into the draft and closes the finding", async () => {
    const client = createSupabaseQueryMock({
      guardrail_findings: [{ data: OPEN_FINDING, error: null }, { data: null, error: null }],
      campaign_assets: [{ data: ASSET, error: null }, { data: { org_id: "org-1" }, error: null }],
      campaign_events: { data: { id: "evt-1" }, error: null },
    });

    const result = await applyFindingFix(
      { findingId: "finding-1", value: "(773) 900-8407", orgId: "org-1", workspaceId: "ws-1" },
      "Evan",
      client,
    );

    expect(result).toMatchObject({ ok: true, replaced: 1, campaignId: "camp-1", assetId: "asset-1" });

    const edit = client.calls.find((c) => c[0] === "update" && (c[1] as Record<string, unknown>).edited_body);
    expect((edit?.[1] as Record<string, unknown>).edited_body).toBe("Call (773) 900-8407 — answered any hour.");

    const resolve = client.calls.find((c) => c[0] === "update" && (c[1] as Record<string, unknown>).status === "resolved");
    expect(resolve, "the finding should stop being an open problem on the card").toBeTruthy();
  });

  it("edits the draft BEFORE closing the finding", async () => {
    // Ordering, not decoration. A finding marked resolved above a draft that
    // never changed is the worse of the two failure orders: the card would go
    // quiet about a placeholder that is still in the copy.
    const client = createSupabaseQueryMock({
      guardrail_findings: [{ data: OPEN_FINDING, error: null }, { data: null, error: null }],
      campaign_assets: [{ data: ASSET, error: null }, { data: { org_id: "org-1" }, error: null }],
      campaign_events: { data: { id: "evt-1" }, error: null },
    });

    await applyFindingFix({ findingId: "finding-1", value: "555-0100", orgId: "org-1", workspaceId: "ws-1" }, "Evan", client);

    const order = client.calls
      .filter((c) => c[0] === "update")
      .map((c) => ((c[1] as Record<string, unknown>).status === "resolved" ? "resolve" : "edit"));
    expect(order.indexOf("edit")).toBeLessThan(order.indexOf("resolve"));
    expect(writes(client.calls).length).toBeGreaterThan(0);
  });

  it("writes nothing when the placeholder is gone from the draft", async () => {
    // A revision landed between the review and the click.
    const client = createSupabaseQueryMock({
      guardrail_findings: [{ data: OPEN_FINDING, error: null }],
      campaign_assets: [{ data: { ...ASSET, draft_body: "Call (773) 900-8407 today." }, error: null }],
    });

    const result = await applyFindingFix({ findingId: "finding-1", value: "555", orgId: "org-1", workspaceId: "ws-1" }, "Evan", client);

    expect(result).toEqual({ ok: false, reason: "target_missing", target: "[24/7 line]" });
    expect(writes(client.calls), "a failed apply must leave the draft and the finding alone").toEqual([]);
  });

  it("edits the copy the operator is actually looking at", async () => {
    // edited_body wins over draft_body, matching the read model's precedence —
    // substituting into the original draft would silently revert an edit.
    const client = createSupabaseQueryMock({
      guardrail_findings: [{ data: OPEN_FINDING, error: null }, { data: null, error: null }],
      campaign_assets: [
        { data: { ...ASSET, edited_body: "Reworded. Call [24/7 line] any time." }, error: null },
        { data: { org_id: "org-1" }, error: null },
      ],
      campaign_events: { data: { id: "evt-1" }, error: null },
    });

    await applyFindingFix({ findingId: "finding-1", value: "555-0100", orgId: "org-1", workspaceId: "ws-1" }, "Evan", client);

    const edit = client.calls.find((c) => c[0] === "update" && (c[1] as Record<string, unknown>).edited_body);
    expect((edit?.[1] as Record<string, unknown>).edited_body).toBe("Reworded. Call 555-0100 any time.");
  });

  it("refuses a finding that carries no fix", async () => {
    const client = createSupabaseQueryMock({
      guardrail_findings: [{ data: { ...OPEN_FINDING, fix_target: null }, error: null }],
    });
    const result = await applyFindingFix({ findingId: "finding-1", value: "555", orgId: "org-1", workspaceId: "ws-1" }, "Evan", client);
    expect(result).toEqual({ ok: false, reason: "no_fix" });
    expect(writes(client.calls)).toEqual([]);
  });

  it("refuses a finding that is already settled", async () => {
    // Double-click, or two people in the queue at once. Re-applying would find
    // no placeholder and report target_missing, which is true but reads as a
    // bug rather than as "someone already did this".
    const client = createSupabaseQueryMock({
      guardrail_findings: [{ data: { ...OPEN_FINDING, status: "resolved" }, error: null }],
    });
    const result = await applyFindingFix({ findingId: "finding-1", value: "555", orgId: "org-1", workspaceId: "ws-1" }, "Evan", client);
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(writes(client.calls)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { ApprovalBlockedError, decideApprovalItem, decideAsset } from "./decisions";

function findCalls(supabase: { calls: Array<[string, ...unknown[]]> }, method: string) {
  return supabase.calls.filter(([m]) => m === method).map(([, arg]) => arg as Record<string, unknown>);
}

const itemRow = { id: "appr-1", status: "pending_owner_approval", campaign_id: "camp-1", campaign_asset_id: "asset-1" };

describe("decideApprovalItem", () => {
  it("approves without unlocking outbound", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: itemRow, error: null },
      approval_decisions: { data: null, error: null },
      campaign_assets: { data: null, error: null },
      campaigns: { data: null, error: null },
      campaign_events: { data: null, error: null },
    });

    const result = await decideApprovalItem(
      { approvalItemId: "appr-1", decision: "approved", operator: "Operator", tenant: { org_id: "org-1", workspace_id: "workspace-1" } },
      supabase,
    );
    expect(result).toEqual({ approvalItemId: "appr-1", decision: "approved", status: "approved" });

    const inserts = findCalls(supabase, "insert");
    const updates = findCalls(supabase, "update");

    expect(inserts).toContainEqual(expect.objectContaining({ decision: "approved", next_status: "approved", org_id: "org-1" }));
    expect(inserts).toContainEqual(expect.objectContaining({ event_type: "approval_decided", org_id: "org-1" }));
    // approval item + asset + campaign all move to approved; asset gets an approver stamp
    expect(updates).toContainEqual(expect.objectContaining({ status: "approved", approved_by: "Operator" }));
    expect(updates).toContainEqual(expect.objectContaining({ status: "approved" }));

    // the outbound-locked invariant: nothing unlocks dispatch / launch
    for (const arg of [...inserts, ...updates]) {
      expect(arg).not.toHaveProperty("dispatch_locked");
      expect(arg).not.toHaveProperty("launch_locked");
    }
    expect(supabase.calls.filter((call) => call[0] === "eq" && call[1] === "org_id" && call[2] === "org-1").length).toBeGreaterThanOrEqual(4);
  });

  it("archives with an 'archived' campaign event", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: itemRow, error: null },
    });

    await decideApprovalItem({ approvalItemId: "appr-1", decision: "archived", operator: "Operator", tenant: { org_id: "org-1", workspace_id: "workspace-1" } }, supabase);

    expect(findCalls(supabase, "insert")).toContainEqual(expect.objectContaining({ event_type: "archived", payload: expect.objectContaining({ decision: "archived" }) }));
  });

  it("throws when the approval item does not exist", async () => {
    const supabase = createSupabaseQueryMock({ approval_items: { data: null, error: null } });
    await expect(
      decideApprovalItem({ approvalItemId: "missing", decision: "declined", operator: "Operator" }, supabase),
    ).rejects.toThrow(/not found/i);
  });
});

/**
 * The gate the review surface had been asserting and nobody enforced.
 *
 * `review-summary.ts` calls them `blockers`, documents them as "Findings that
 * must be fixed before this can go out", and renders "N things to fix before
 * this can go out" in red on the card. Nothing consulted them — not the decision
 * path, not `launchCampaign`, not the send executor — so a deliverable with open
 * blockers approved in one click and went out. A flagged IMAGE, meanwhile, could
 * not be approved without saying how the flag was addressed, because the media
 * path runs `checkAssetApproval`. One review flow, two rules.
 *
 * These cover the boundaries that decide whether the gate is real: which rows
 * count, which decisions it applies to, and that it cannot be walked around.
 */
describe("decideAsset — the blocking-findings gate", () => {
  const openBlocker = { severity: "blocker", status: "open", finding_message: "Unverifiable 60-minute claim", matched_text: null };
  const noGuardrail = { data: { audit_payload: null }, error: null };

  function mock(findings: unknown[], guardrail: unknown = noGuardrail) {
    return createSupabaseQueryMock({
      guardrail_findings: { data: findings, error: null },
      // Two reads in order: the guardrail payload, then the decision's own write.
      campaign_assets: [guardrail, { data: null, error: null }],
      approval_items: { data: null, error: null },
      approval_decisions: { data: null, error: null },
      campaigns: { data: null, error: null },
      campaign_events: { data: null, error: null },
    } as never);
  }

  const approve = (supabase: unknown, acknowledgement?: string) =>
    decideAsset(
      {
        assetId: "asset-1",
        campaignId: "camp-1",
        decision: "approved",
        operator: "Operator",
        acknowledgement,
        tenant: { org_id: "org-1", workspace_id: "workspace-1" },
      },
      supabase as never,
    );

  it("refuses an approval when an open blocker has no acknowledgement", async () => {
    await expect(approve(mock([openBlocker]))).rejects.toThrow(/blocking finding/i);
  });

  it("names the blockers on the refusal, so the UI can show what to address", async () => {
    let caught: ApprovalBlockedError | null = null;
    try {
      await approve(mock([openBlocker]));
    } catch (error) {
      caught = error as ApprovalBlockedError;
    }
    expect(caught).toBeInstanceOf(ApprovalBlockedError);
    expect(caught?.reason).toBe("acknowledgement_required");
    expect(caught?.blockers).toEqual(["Unverifiable 60-minute claim"]);
  });

  it("lets the approval through once the reviewer says how it was addressed", async () => {
    await expect(approve(mock([openBlocker]), "Legal signed off on the 60-minute SLA.")).resolves.toBeDefined();
  });

  /** Clicking past it is the failure mode this exists to prevent. */
  it("does not accept a token acknowledgement", async () => {
    await expect(approve(mock([openBlocker]), "ok")).rejects.toThrow(/blocking finding/i);
  });

  it("ignores a finding that has already been resolved", async () => {
    await expect(approve(mock([{ ...openBlocker, status: "resolved" }]))).resolves.toBeDefined();
  });

  it("ignores a warning — only blockers gate", async () => {
    await expect(approve(mock([{ ...openBlocker, severity: "warning" }]))).resolves.toBeDefined();
  });

  /** review-summary.ts counts a banned phrase as a hard block; so does this. */
  it("counts a Brand Kit banned phrase as a blocker", async () => {
    const guardrail = { data: { audit_payload: { guardrail: { blocked_phrases: ["guaranteed"] } } }, error: null };
    await expect(approve(mock([], guardrail))).rejects.toThrow(/blocking finding/i);
  });

  /**
   * Declining or asking for a revision is how a reviewer ACTS on a blocker.
   * Gating those would push reviewers toward approving as the easier path, which
   * is the opposite of what the finding is for.
   */
  it("does not gate declining", async () => {
    await expect(
      decideAsset(
        {
          assetId: "asset-1",
          campaignId: "camp-1",
          decision: "declined",
          operator: "Operator",
          tenant: { org_id: "org-1", workspace_id: "workspace-1" },
        },
        mock([openBlocker]) as never,
      ),
    ).resolves.toBeDefined();
  });

  /**
   * The gate sits ahead of the approval-row branch on purpose: an asset with no
   * `approval_items` row takes the direct-write path below it, and that is
   * exactly the one that must not become a way around the gate.
   */
  it("gates the no-approval-row path too", async () => {
    await expect(approve(mock([openBlocker]))).rejects.toThrow(/blocking finding/i);
  });
});

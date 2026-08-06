import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock, type MockResponse } from "@/lib/repos/__tests__/test-helpers";

import { recordDraftReview, type DraftReviewFinding } from "../draft-review";

function finding(verdict: DraftReviewFinding["verdict"], claim = "We guarantee approval."): DraftReviewFinding {
  return { claim, verdict, note: "No proof point supports this." };
}

function mocks(approvalItem: MockResponse) {
  return createSupabaseQueryMock({
    approval_items: approvalItem,
    guardrail_findings: { data: null, error: null },
    approval_recommendations: { data: { id: "rec-1" }, error: null },
  });
}

const pendingItem = { data: { id: "appr-1", risk_level: "medium" }, error: null };

function inserts(supabase: ReturnType<typeof createSupabaseQueryMock>) {
  return supabase.calls.filter(([m]) => m === "insert").map(([, arg]) => arg);
}

describe("recordDraftReview", () => {
  it("records only problems as findings — a grounded claim is the absence of one", async () => {
    const supabase = mocks(pendingItem);

    const result = await recordDraftReview(
      {
        assetId: "asset-1",
        riskLevel: "medium",
        recommendation: "request revision",
        findings: [finding("grounded", "We serve the North Shore."), finding("unsupported")],
      },
      supabase,
      { orgId: "org-1", workspaceId: "ws-1" },
    );

    expect(result).toMatchObject({ ok: true, findingsRecorded: 1 });
    const findingRows = inserts(supabase).find((row) => Array.isArray(row)) as Array<Record<string, unknown>>;
    expect(findingRows).toHaveLength(1);
    expect(findingRows[0]).toMatchObject({
      scope: "generated_output",
      severity: "warning",
      status: "open",
      campaign_asset_id: "asset-1",
      approval_item_id: "appr-1",
    });
  });

  it("maps a fabricated claim to a blocker finding", async () => {
    const supabase = mocks(pendingItem);

    await recordDraftReview(
      { assetId: "asset-1", riskLevel: "high", recommendation: "decline", findings: [finding("fabricated")] },
      supabase,
      { orgId: "org-1", workspaceId: "ws-1" },
    );

    const findingRows = inserts(supabase).find((row) => Array.isArray(row)) as Array<Record<string, unknown>>;
    expect(findingRows[0]).toMatchObject({ severity: "blocker" });
  });

  it("writes the operator-facing summary as a draft-critic recommendation", async () => {
    const supabase = mocks(pendingItem);

    await recordDraftReview(
      {
        assetId: "asset-1",
        riskLevel: "high",
        recommendation: "request revision",
        rationale: "The payout promise has no proof point.",
        riskFlags: ["claim_risk"],
        suggestedEdits: "Drop the guarantee.",
        findings: [finding("fabricated")],
      },
      supabase,
      { orgId: "org-1", workspaceId: "ws-1" },
    );

    const rec = inserts(supabase).find(
      (row) => !Array.isArray(row) && (row as Record<string, unknown>).agent === "draft-critic",
    ) as Record<string, unknown>;
    expect(rec).toMatchObject({
      agent: "draft-critic",
      recommendation: "request revision",
      risk_flags: ["claim_risk"],
      approval_item_id: "appr-1",
    });
    expect(rec.metadata).toMatchObject({ claims_checked: 1, grounded: 0, problems: 1 });
  });

  it("raises risk_level from the critic's verdict", async () => {
    const supabase = mocks(pendingItem);

    const result = await recordDraftReview(
      { assetId: "asset-1", riskLevel: "high", recommendation: "decline", findings: [finding("fabricated")] },
      supabase,
      { orgId: "org-1", workspaceId: "ws-1" },
    );

    expect(result).toMatchObject({ ok: true, riskLevel: "high" });
    expect(supabase.calls).toContainEqual(["update", { risk_level: "high" }]);
  });

  it("cannot clear a banned-phrase block: an opinion must not override a fact", async () => {
    // The deterministic screen already matched the org's banned-phrase list.
    const supabase = mocks({ data: { id: "appr-1", risk_level: "blocked" }, error: null });

    const result = await recordDraftReview(
      // The critic saw nothing wrong — it must not be able to un-block this.
      { assetId: "asset-1", riskLevel: "low", recommendation: "approve", findings: [finding("grounded")] },
      supabase,
      { orgId: "org-1", workspaceId: "ws-1" },
    );

    expect(result).toMatchObject({ ok: true, riskLevel: "blocked" });
    expect(supabase.calls.some(([m]) => m === "update")).toBe(false);
  });

  it("never touches status, the decision ledger, or dispatch", async () => {
    const supabase = mocks(pendingItem);

    await recordDraftReview(
      { assetId: "asset-1", riskLevel: "high", recommendation: "decline", findings: [finding("fabricated")] },
      supabase,
      { orgId: "org-1", workspaceId: "ws-1" },
    );

    expect(supabase.calls).not.toContainEqual(["from", "approval_decisions"]);
    const updates = supabase.calls.filter(([m]) => m === "update").map(([, arg]) => arg as Record<string, unknown>);
    for (const update of updates) {
      expect(update).not.toHaveProperty("status");
      expect(update).not.toHaveProperty("dispatch_locked");
      expect(update).not.toHaveProperty("locked_until_approved");
    }
  });

  it("404s rather than inventing a gate when the asset has no approval item", async () => {
    const supabase = mocks({ data: null, error: null });

    const result = await recordDraftReview(
      { assetId: "ghost", riskLevel: "low", recommendation: "approve", findings: [] },
      supabase,
      { orgId: "org-1", workspaceId: "ws-1" },
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});

// BSR-653. guardrail_findings used to rely on being "scoped transitively" by its
// approval_item_id / campaign_asset_id FKs. That was never true — all four of its
// parent FKs are nullable, so a row could be written attached to nothing and
// belonging to no tenant. It carries its own org_id + workspace_id now.
describe("guardrail findings carry their own tenancy", () => {
  it("stamps the org and workspace on every finding row", async () => {
    const supabase = mocks(pendingItem);

    await recordDraftReview(
      { assetId: "asset-1", riskLevel: "high", recommendation: "decline", findings: [finding("fabricated")] },
      supabase,
      { orgId: "org-1", workspaceId: "ws-1" },
    );

    const findingRows = inserts(supabase).find((row) => Array.isArray(row)) as Array<Record<string, unknown>>;
    expect(findingRows[0]).toMatchObject({ org_id: "org-1", workspace_id: "ws-1" });
  });

  it("refuses to write a finding with no resolved scope, rather than an unplaceable row", async () => {
    // The columns are NOT NULL now, so this would fail at the database anyway.
    // Failing here names the actual problem instead of surfacing a constraint
    // violation three frames away.
    const supabase = mocks(pendingItem);

    await expect(
      recordDraftReview(
        { assetId: "asset-1", riskLevel: "high", recommendation: "decline", findings: [finding("fabricated")] },
        supabase,
      ),
    ).rejects.toThrow(/requires a resolved org and workspace/);
  });
});

describe("the one-value fix a finding can carry (BSR-743)", () => {
  it("records the target and label the critic named", async () => {
    const client = createSupabaseQueryMock({
      approval_items: [{ data: { id: "item-1", risk_level: "medium" }, error: null }, { data: null, error: null }],
      guardrail_findings: { data: null, error: null },
      approval_recommendations: { data: { id: "rec-1" }, error: null },
    });

    await recordDraftReview(
      {
        assetId: "asset-1",
        riskLevel: "high",
        recommendation: "request revision",
        findings: [
          {
            claim: "Call [24/7 line].",
            verdict: "unsupported",
            note: "Still the placeholder.",
            fix: { target: "[24/7 line]", label: "The number to call", kind: "phone" },
          },
        ],
      },
      client,
      { orgId: "org-1", workspaceId: "ws-1" },
    );

    const insert = client.calls.find((c) => c[0] === "insert");
    const rows = insert?.[1] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      fix_target: "[24/7 line]",
      fix_label: "The number to call",
      fix_kind: "phone",
    });
  });

  it("writes all three columns as null when there is no fix, never a half of one", async () => {
    // The database rejects a target with no label. A finding that arrived with
    // one half filled in must not take the whole review's findings down with it.
    const client = createSupabaseQueryMock({
      approval_items: [{ data: { id: "item-1", risk_level: "medium" }, error: null }, { data: null, error: null }],
      guardrail_findings: { data: null, error: null },
      approval_recommendations: { data: { id: "rec-1" }, error: null },
    });

    await recordDraftReview(
      {
        assetId: "asset-1",
        riskLevel: "medium",
        recommendation: "request revision",
        findings: [
          { claim: "Too strong.", verdict: "unsupported", note: "Judgement, not a blank." },
          {
            claim: "Half a fix.",
            verdict: "unsupported",
            note: "Target but no label.",
            fix: { target: "[x]", label: "   ", kind: "text" },
          },
        ],
      },
      client,
      { orgId: "org-1", workspaceId: "ws-1" },
    );

    const insert = client.calls.find((c) => c[0] === "insert");
    const rows = insert?.[1] as Array<Record<string, unknown>>;
    for (const row of rows) {
      expect(row).toMatchObject({ fix_target: null, fix_label: null, fix_kind: null });
    }
  });

  it("falls back to a plain text input rather than rejecting an unknown kind", async () => {
    const client = createSupabaseQueryMock({
      approval_items: [{ data: { id: "item-1", risk_level: "medium" }, error: null }, { data: null, error: null }],
      guardrail_findings: { data: null, error: null },
      approval_recommendations: { data: { id: "rec-1" }, error: null },
    });

    await recordDraftReview(
      {
        assetId: "asset-1",
        riskLevel: "medium",
        recommendation: "request revision",
        findings: [
          {
            claim: "Call [x].",
            verdict: "unsupported",
            note: "Placeholder.",
            // "sms" is not in the CHECK constraint; writing it would fail the insert.
            fix: { target: "[x]", label: "The number", kind: "sms" as never },
          },
        ],
      },
      client,
      { orgId: "org-1", workspaceId: "ws-1" },
    );

    const insert = client.calls.find((c) => c[0] === "insert");
    const rows = insert?.[1] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ fix_target: "[x]", fix_kind: "text" });
  });
});

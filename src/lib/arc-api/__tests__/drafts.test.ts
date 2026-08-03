import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { createApprovalDraft } from "../drafts";

function insertCalls(supabase: ReturnType<typeof createSupabaseQueryMock>) {
  return supabase.calls.filter(([method]) => method === "insert") as Array<[string, Record<string, unknown>]>;
}

describe("createApprovalDraft (safety)", () => {
  it("creates a pending_approval, locked approval item — never approved", async () => {
    const supabase = createSupabaseQueryMock({ approval_items: { data: { id: "ap-1" }, error: null } });

    const result = await createApprovalDraft(
      { itemType: "partner_outreach", draft: "Draft outreach copy", riskLevel: "low" },
      supabase,
      { orgId: "org-1", workspaceId: "workspace-1" },
    );

    expect(result).toMatchObject({ ok: true, approvalItemId: "ap-1", agentOutputId: null });
    const [, payload] = insertCalls(supabase)[0];
    expect(payload.status).toBe("pending_approval");
    expect(payload.locked_until_approved).toBe(true);
    expect(payload.approval_required).toBe(true);
    expect(payload.risk_level).toBe("low");
    expect(payload.org_id).toBe("org-1");
    // No decision ledger, no campaign launch/dispatch touched.
    expect(supabase.calls).not.toContainEqual(["from", "approval_decisions"]);
    expect(supabase.calls).not.toContainEqual(["from", "campaign_dispatches"]);
    expect(supabase.calls.filter(([m]) => m === "update")).toHaveLength(0);
  });

  it("forces an invalid/elevated risk level to a safe default and never trusts a status field", async () => {
    const supabase = createSupabaseQueryMock({ approval_items: { data: { id: "ap-2" }, error: null } });

    await createApprovalDraft({ itemType: "x", draft: "y", riskLevel: "totally-bogus" }, supabase, { orgId: "org-1", workspaceId: "workspace-1" });

    const [, payload] = insertCalls(supabase)[0];
    expect(payload.risk_level).toBe("medium");
    expect(payload.status).toBe("pending_approval");
  });

  it("links a pending_approval agent_output when a taskId is given", async () => {
    const supabase = createSupabaseQueryMock({
      approval_items: { data: { id: "ap-3" }, error: null },
      agent_outputs: { data: { id: "out-3" }, error: null },
    });

    const result = await createApprovalDraft(
      { itemType: "campaign_copy", draft: "body", taskId: "task-1" },
      supabase,
      { orgId: "org-1", workspaceId: "workspace-1" },
    );

    expect(result.agentOutputId).toBe("out-3");
    const outputInsert = insertCalls(supabase).find(([, p]) => "task_id" in p);
    expect(outputInsert?.[1].approval_status).toBe("pending_approval");
    expect(outputInsert?.[1].compliance_status).toBe("pending_approval");
    expect(outputInsert?.[1].org_id).toBe("org-1");
  });

  it("redacts secrets in the draft body before storing", async () => {
    const supabase = createSupabaseQueryMock({ approval_items: { data: { id: "ap-4" }, error: null } });

    await createApprovalDraft({ itemType: "x", draft: "key is sk-ABCDEFGHIJKLMNOP here" }, supabase, { orgId: "org-1", workspaceId: "workspace-1" });

    const [, payload] = insertCalls(supabase)[0];
    expect(String(payload.draft_output)).not.toContain("sk-ABCDEFGHIJKLMNOP");
    expect(String(payload.draft_output)).toContain("[REDACTED]");
  });
});

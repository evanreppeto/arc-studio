import { type SupabaseClient } from "@supabase/supabase-js";

import { redactDeep, redactSecrets } from "@/domain";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { workspaceScopeFields } from "@/lib/tenancy/write-scope";

/**
 * Lets Arc produce a REVIEW-READY draft that enters the human approval queue.
 *
 * SAFETY INVARIANTS (enforced here, not trusted from input):
 *  - The approval item is ALWAYS created `pending_approval`.
 *  - `locked_until_approved` and `approval_required` are ALWAYS true.
 *  - Any linked agent_output is `pending_approval` (never approved).
 *  - No approval_decisions row, no campaign launch/dispatch, ever.
 * Arc drafts; the human decides. Outbound stays locked.
 */

const RISK_LEVELS = new Set(["low", "medium", "high", "blocked"]);

export type CreateDraftInput = {
  itemType: string;
  draft: string;
  title?: string;
  summary?: string;
  riskLevel?: string;
  promptInputs?: Record<string, unknown>;
  agent?: string;
  campaignId?: string;
  campaignAssetId?: string;
  companyId?: string;
  contactId?: string;
  leadId?: string;
  /** When set, also records a linked agent_output on this task. */
  taskId?: string;
  metadata?: Record<string, unknown>;
};

export type CreateDraftResult = { ok: true; approvalItemId: string; agentOutputId: string | null };
export type ArcTenantScope = { orgId: string; workspaceId: string };

export async function createApprovalDraft(
  input: CreateDraftInput,
  client: SupabaseClient = getSupabaseAdminClient(),
  scope?: ArcTenantScope,
): Promise<CreateDraftResult> {
  const riskLevel = input.riskLevel && RISK_LEVELS.has(input.riskLevel) ? input.riskLevel : "medium";
  const draft = redactSecrets(input.draft);
  const promptInputs = redactDeep(input.promptInputs ?? {}) as Record<string, unknown>;
  const reasoningPayload = redactDeep({
    source: "arc_operations_api",
    summary: input.summary ? redactSecrets(input.summary) : null,
    ...(input.metadata ?? {}),
  }) as Record<string, unknown>;

  const { data: approval, error: approvalError } = await client
    .from("approval_items")
    .insert({
      ...workspaceScopeFields(scope),
      item_type: input.itemType,
      // Hardcoded safe state — Arc cannot create an approved/unlocked item.
      status: "pending_approval",
      approval_required: true,
      locked_until_approved: true,
      draft_output: draft,
      prompt_inputs: promptInputs,
      requested_by: input.agent ?? "arc",
      risk_level: riskLevel,
      reasoning_payload: reasoningPayload,
      campaign_id: input.campaignId ?? null,
      campaign_asset_id: input.campaignAssetId ?? null,
      company_id: input.companyId ?? null,
      contact_id: input.contactId ?? null,
      lead_id: input.leadId ?? null,
    })
    .select("id")
    .single();
  if (approvalError) {
    throw new Error(`createApprovalDraft approval insert failed: ${approvalError.message}`);
  }
  const approvalItemId = (approval as { id: string }).id;

  let agentOutputId: string | null = null;
  if (input.taskId) {
    const { data: output, error: outputError } = await client
      .from("agent_outputs")
      .insert({
        ...workspaceScopeFields(scope),
        task_id: input.taskId,
        approval_item_id: approvalItemId,
        output_type: input.itemType,
        title: input.title ? redactSecrets(input.title) : "Arc draft",
        body: draft,
        structured_payload: promptInputs,
        risk_level: riskLevel,
        // Locked behind review — never approved by the agent.
        compliance_status: "pending_approval",
        approval_status: "pending_approval",
      })
      .select("id")
      .single();
    if (outputError) {
      throw new Error(`createApprovalDraft output insert failed: ${outputError.message}`);
    }
    agentOutputId = (output as { id: string }).id;
  }

  return { ok: true, approvalItemId, agentOutputId };
}


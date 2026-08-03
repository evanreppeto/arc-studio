import { type SupabaseClient } from "@supabase/supabase-js";

import { getCurrentAgentTaskTenantFields } from "@/lib/agent-tasks/scope";
import { getSupabaseAdminClient } from "../supabase/server";
import { workspaceIdFields } from "@/lib/tenancy/resolve-workspace";

export const APPROVAL_DECISION_ACTIONS = ["approve", "reject", "revise", "archive"] as const;

export type ApprovalDecisionAction = (typeof APPROVAL_DECISION_ACTIONS)[number];

export type DecideApprovalItemInput = {
  approvalItemId: string;
  action: ApprovalDecisionAction;
  reviewer?: string;
  notes?: string;
  editedOutput?: string;
};

type ApprovalItemDecisionRow = {
  id: string;
  org_id: string;
  status: string;
  campaign_id: string | null;
  campaign_asset_id: string | null;
  draft_output: string | null;
  edited_output: string | null;
  item_type: string;
};

type CampaignAssetDecisionRow = {
  id: string;
  status: string;
  draft_body: string | null;
  edited_body: string | null;
  approved_body: string | null;
};

export async function decideApprovalItem(
  input: DecideApprovalItemInput,
  client: SupabaseClient = getSupabaseAdminClient(),
) {
  const approvalItemId = requireUuid(input.approvalItemId, "approvalItemId");
  const decision = mapActionToDecision(input.action);
  const reviewer = normalizeText(input.reviewer) ?? "Local Operator";
  const notes = normalizeText(input.notes);
  const editedOutput = normalizeText(input.editedOutput);
  const reviewedAt = new Date().toISOString();

  const item = await fetchApprovalItem(client, approvalItemId);
  const asset = item.campaign_asset_id ? await fetchCampaignAsset(client, item.campaign_asset_id) : null;
  const finalOutput = editedOutput ?? item.edited_output ?? asset?.edited_body ?? item.draft_output ?? asset?.draft_body ?? null;

  const { error: itemUpdateError } = await client
    .from("approval_items")
    .update({
      status: decision.nextStatus,
      reviewed_by: reviewer,
      reviewed_at: reviewedAt,
      decision_notes: notes,
      edited_output: editedOutput ?? item.edited_output,
      audit_payload: {
        decision_action: input.action,
        decided_by: reviewer,
        decided_at: reviewedAt,
        outbound_dispatch_allowed: false,
      },
    })
    .eq("id", approvalItemId);

  if (itemUpdateError) {
    throw new Error(`approval_items update failed: ${itemUpdateError.message}`);
  }

  // The decision inherits both from the item it decides — approval_items.org_id is
  // NOT NULL and its workspace_id landed in BSR-710. Unlike an ambient session
  // lookup this cannot misfile the row for a session-less caller.
  const { error: decisionError } = await client.from("approval_decisions").insert({
    org_id: item.org_id,
    ...(await workspaceIdFields(client, item.org_id, { approvalItemId })),
    approval_item_id: approvalItemId,
    decision: decision.decisionKind,
    decided_by: reviewer,
    decided_at: reviewedAt,
    decision_notes: notes,
    previous_status: item.status,
    next_status: decision.nextStatus,
    edited_output: editedOutput,
    metadata: {
      action: input.action,
      item_type: item.item_type,
      campaign_id: item.campaign_id,
      campaign_asset_id: item.campaign_asset_id,
      outbound_dispatch_allowed: false,
    },
  });

  if (decisionError) {
    throw new Error(`approval_decisions insert failed: ${decisionError.message}`);
  }

  if (item.campaign_asset_id) {
    await updateCampaignAssetAfterDecision({
      client,
      campaignAssetId: item.campaign_asset_id,
      action: input.action,
      nextStatus: decision.assetStatus,
      reviewer,
      reviewedAt,
      finalOutput,
      editedOutput,
      asset,
    });
  }

  if (item.campaign_id) {
    await updateCampaignAfterDecision({
      client,
      campaignId: item.campaign_id,
      orgId: item.org_id,
      action: input.action,
      nextStatus: decision.campaignStatus,
      approvalItemId,
      campaignAssetId: item.campaign_asset_id,
      reviewer,
      reviewedAt,
      notes,
    });
  }

  if (input.action === "revise") {
    await createRevisionTask({
      client,
      originalItem: item,
      reviewer,
      notes,
      reviewedAt,
    });
  }

  return {
    approvalItemId,
    previousStatus: item.status,
    nextStatus: decision.nextStatus,
    action: input.action,
  };
}

async function fetchApprovalItem(client: SupabaseClient, approvalItemId: string) {
  const { data, error } = await client
    .from("approval_items")
    .select("id,org_id,status,campaign_id,campaign_asset_id,draft_output,edited_output,item_type")
    .eq("id", approvalItemId)
    .maybeSingle<ApprovalItemDecisionRow>();

  if (error) {
    throw new Error(`approval_items lookup failed: ${error.message}`);
  }

  if (!data) {
    throw new Error("approval_items lookup failed: item not found");
  }

  return data;
}

async function fetchCampaignAsset(client: SupabaseClient, campaignAssetId: string) {
  const { data, error } = await client
    .from("campaign_assets")
    .select("id,status,draft_body,edited_body,approved_body")
    .eq("id", campaignAssetId)
    .maybeSingle<CampaignAssetDecisionRow>();

  if (error) {
    throw new Error(`campaign_assets lookup failed: ${error.message}`);
  }

  return data;
}

async function updateCampaignAssetAfterDecision(input: {
  client: SupabaseClient;
  campaignAssetId: string;
  action: ApprovalDecisionAction;
  nextStatus: string;
  reviewer: string;
  reviewedAt: string;
  finalOutput: string | null;
  editedOutput?: string | null;
  asset: CampaignAssetDecisionRow | null;
}) {
  const values: Record<string, unknown> = {
    status: input.nextStatus,
    edited_body: input.editedOutput ?? input.asset?.edited_body,
  };

  if (input.action === "approve") {
    values.approved_by = input.reviewer;
    values.approved_at = input.reviewedAt;
    values.approved_body = input.finalOutput;
    values.dispatch_locked = false;
  } else {
    values.dispatch_locked = true;
  }

  const { error } = await input.client.from("campaign_assets").update(values).eq("id", input.campaignAssetId);

  if (error) {
    throw new Error(`campaign_assets update failed: ${error.message}`);
  }
}

async function updateCampaignAfterDecision(input: {
  client: SupabaseClient;
  campaignId: string;
  orgId: string;
  action: ApprovalDecisionAction;
  nextStatus: string;
  approvalItemId: string;
  campaignAssetId: string | null;
  reviewer: string;
  reviewedAt: string;
  notes?: string;
}) {
  const { error: campaignError } = await input.client
    .from("campaigns")
    .update({
      status: input.nextStatus,
      launch_locked: true,
      approval_item_id: input.approvalItemId,
      audit_payload: {
        last_approval_action: input.action,
        last_approval_at: input.reviewedAt,
        last_approval_by: input.reviewer,
        outbound_dispatch_allowed: false,
      },
    })
    .eq("id", input.campaignId);

  if (campaignError) {
    throw new Error(`campaigns update failed: ${campaignError.message}`);
  }

  const { error: eventError } = await input.client.from("campaign_events").insert({
    // Inherited from the approval item, workspace included (BSR-710/720).
    org_id: input.orgId,
    ...(await workspaceIdFields(input.client, input.orgId, {
      approvalItemId: input.approvalItemId,
      campaignId: input.campaignId,
    })),
    campaign_id: input.campaignId,
    campaign_asset_id: input.campaignAssetId,
    approval_item_id: input.approvalItemId,
    event_type: "approval_decided",
    actor: input.reviewer,
    detail: `${input.action} recorded for approval item.`,
    payload: {
      action: input.action,
      next_status: input.nextStatus,
      notes: input.notes,
      outbound_dispatch_allowed: false,
    },
  });

  if (eventError) {
    throw new Error(`campaign_events insert failed: ${eventError.message}`);
  }
}

async function createRevisionTask(input: {
  client: SupabaseClient;
  originalItem: ApprovalItemDecisionRow;
  reviewer: string;
  notes?: string;
  reviewedAt: string;
}) {
  if (!input.originalItem.campaign_id) {
    return;
  }

  // Hoisted above the agents lookup: `key` is only unique per-org, so the
  // lookup must filter by org_id or it can return another tenant's agent.
  const tenant = await getCurrentAgentTaskTenantFields();

  const { data: agent, error: agentError } = await input.client
    .from("agents")
    .select("id")
    .eq("org_id", tenant.org_id)
    .eq("key", "arc-demo")
    .maybeSingle<{ id: string }>();

  if (agentError) {
    throw new Error(`agents lookup failed: ${agentError.message}`);
  }

  if (!agent) {
    return;
  }

  const { error } = await input.client.from("agent_tasks").insert({
    ...tenant,
    agent_id: agent.id,
    status: "queued",
    priority: "medium",
    objective: "Revise an approval item based on human review notes.",
    task_type: "approval_revision",
    source_type: "approval_item",
    source_id: input.originalItem.id,
    campaign_id: input.originalItem.campaign_id,
    approval_item_id: input.originalItem.id,
    metadata: {
      requested_by: input.reviewer,
      requested_at: input.reviewedAt,
      notes: input.notes,
      previous_status: input.originalItem.status,
    },
  });

  if (error) {
    throw new Error(`agent_tasks revision insert failed: ${error.message}`);
  }
}

function mapActionToDecision(action: ApprovalDecisionAction) {
  switch (action) {
    case "approve":
      return {
        decisionKind: "approved",
        nextStatus: "approved",
        assetStatus: "approved",
        campaignStatus: "approved",
      } as const;
    case "reject":
      return {
        decisionKind: "declined",
        nextStatus: "declined",
        assetStatus: "declined",
        campaignStatus: "blocked",
      } as const;
    case "revise":
      return {
        decisionKind: "revision_requested",
        nextStatus: "revision_requested",
        assetStatus: "revision_requested",
        campaignStatus: "pending_approval",
      } as const;
    case "archive":
      return {
        decisionKind: "archived",
        nextStatus: "archived",
        assetStatus: "archived",
        campaignStatus: "archived",
      } as const;
  }
}

function requireUuid(value: string, label: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a valid UUID.`);
  }

  return value;
}

function normalizeText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

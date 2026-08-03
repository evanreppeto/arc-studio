import { type SupabaseClient } from "@supabase/supabase-js";

import { type AgentTaskTenantFields } from "@/lib/agent-tasks/scope";
import { enqueueDispatchesForAssets } from "@/lib/dispatch/persistence";

import { getSupabaseAdminClient } from "../supabase/server";
import { workspaceScopeFields } from "@/lib/tenancy/write-scope";

export type LaunchCampaignInput = {
  campaignId: string;
  operator: string;
  /** Operator-configured agent display name, written into the handoff event detail. */
  agentName?: string;
  /** When set, deliverables are enqueued "scheduled" for this ISO time instead of "queued". */
  scheduledFor?: string;
  tenant?: AgentTaskTenantFields;
};

type ApprovalRow = { id: string; status: string; campaign_asset_id: string | null };

function isDecided(status: string) {
  return /approved|declined|archived|rejected/i.test(status);
}

/**
 * Deploy a campaign — a real backend state transition + handoff, not an in-app
 * send. Verifies every gating deliverable has been decided (nothing still
 * pending), unlocks the approved deliverables for dispatch, marks the campaign
 * live, and records a `campaign_launched` event that Arc/Arc consumes to
 * perform the actual sends/publishes. This module never sends anything itself.
 */
export async function launchCampaign(
  input: LaunchCampaignInput,
  client: SupabaseClient = getSupabaseAdminClient(),
) {
  const { campaignId, operator, agentName = "Arc", scheduledFor, tenant } = input;

  const { data: campaign, error: campaignError } = await applyOrgScope(
    client
      .from("campaigns")
      .select("id,launch_locked,status")
      .eq("id", campaignId),
    tenant,
  ).maybeSingle<{ id: string; launch_locked: boolean; status: string }>();
  assertOk("campaigns lookup", campaignError);
  if (!campaign) {
    throw new Error("Campaign not found.");
  }
  if (!campaign.launch_locked) {
    throw new Error("This campaign is already live.");
  }

  const { data: assetRows, error: assetsError } = await applyOrgScope(
    client
      .from("campaign_assets")
      .select("id")
      .eq("campaign_id", campaignId),
    tenant,
  );
  assertOk("campaign_assets lookup", assetsError);
  const assetIds = (assetRows ?? []).map((row) => row.id as string);

  // Gating approvals: those attached to the campaign or any of its deliverables.
  const { data: campaignApprovals, error: campaignApprovalsError } = await applyOrgScope(
    client
      .from("approval_items")
      .select("id,status,campaign_asset_id")
      .eq("campaign_id", campaignId),
    tenant,
  );
  assertOk("approval_items (campaign) lookup", campaignApprovalsError);

  let assetApprovals: ApprovalRow[] = [];
  if (assetIds.length > 0) {
    const { data, error } = await applyOrgScope(
      client
        .from("approval_items")
        .select("id,status,campaign_asset_id")
        .in("campaign_asset_id", assetIds),
      tenant,
    );
    assertOk("approval_items (asset) lookup", error);
    assetApprovals = (data ?? []) as ApprovalRow[];
  }

  const approvals = uniqueById([...((campaignApprovals ?? []) as ApprovalRow[]), ...assetApprovals]);
  if (approvals.length === 0) {
    throw new Error("No deliverables are ready to launch yet.");
  }

  const pending = approvals.filter((approval) => !isDecided(approval.status));
  if (pending.length > 0) {
    throw new Error(`Approve every piece before launching — ${pending.length} still pending.`);
  }

  const approvedAssetIds = approvals
    .filter((approval) => /approved/i.test(approval.status) && approval.campaign_asset_id)
    .map((approval) => approval.campaign_asset_id as string);

  if (approvedAssetIds.length === 0) {
    throw new Error("Nothing approved to launch — approve at least one deliverable first.");
  }

  // Unlock the approved deliverables for dispatch.
  const { error: unlockError } = await applyOrgScope(
    client
      .from("campaign_assets")
      .update({ dispatch_locked: false })
      .in("id", approvedAssetIds),
    tenant,
  );
  assertOk("campaign_assets unlock", unlockError);

  // Arc the campaign live.
  const { error: campaignUpdateError } = await applyOrgScope(
    client
      .from("campaigns")
      .update({ status: "active", launch_locked: false })
      .eq("id", campaignId),
    tenant,
  );
  assertOk("campaigns launch update", campaignUpdateError);

  // Open the Outbox: one queued dispatch per approved deliverable.
  await enqueueDispatchesForAssets({ campaignId, assetIds: approvedAssetIds, operator, scheduledFor, tenant }, client);

  // Record the handoff signal Arc/Arc consumes to do the actual sends.
  const { error: eventError } = await client.from("campaign_events").insert({
    ...workspaceScopeFields(tenant),
    campaign_id: campaignId,
    event_type: "campaign_launched",
    actor: operator,
    detail: scheduledFor
      ? `Campaign launched by ${operator}. ${approvedAssetIds.length} deliverable${approvedAssetIds.length === 1 ? "" : "s"} scheduled for ${scheduledFor}; handed off to ${agentName}.`
      : `Campaign launched by ${operator}. ${approvedAssetIds.length} deliverable${approvedAssetIds.length === 1 ? "" : "s"} unlocked for dispatch; handed off to ${agentName}.`,
    payload: { source: "campaigns_workspace", approved_assets: approvedAssetIds.length, handoff: "arc" },
  });
  assertOk("campaign_events insert", eventError);

  return { campaignId, launchedAssets: approvedAssetIds.length };
}

export type DeployAssetInput = {
  campaignId: string;
  assetId: string;
  operator: string;
  /** Operator-configured agent display name, written into the handoff event detail. */
  agentName?: string;
  /** When set, the deliverable is enqueued "scheduled" for this ISO time instead of "queued". */
  scheduledFor?: string;
  tenant?: AgentTaskTenantFields;
};

/**
 * Deploy a single approved deliverable ahead of the full campaign launch.
 * Verifies the piece is approved, unlocks just that piece for dispatch, and
 * records an `asset_deployed` handoff event for Arc/Arc. Leaves the
 * campaign's overall launch lock untouched — the campaign can still be in
 * review while individual pieces go live.
 */
export async function deployAsset(
  input: DeployAssetInput,
  client: SupabaseClient = getSupabaseAdminClient(),
) {
  const { campaignId, assetId, operator, agentName = "Arc", scheduledFor, tenant } = input;

  const { data: asset, error: assetError } = await applyOrgScope(
    client
      .from("campaign_assets")
      .select("id,status,dispatch_locked")
      .eq("id", assetId),
    tenant,
  ).maybeSingle<{ id: string; status: string; dispatch_locked: boolean }>();
  assertOk("campaign_assets lookup", assetError);
  if (!asset) {
    throw new Error("Deliverable not found.");
  }
  if (!asset.dispatch_locked) {
    throw new Error("This piece is already deployed.");
  }

  let approved = /approved/i.test(asset.status);
  if (!approved) {
    const { data: approval, error: approvalError } = await applyOrgScope(
      client
        .from("approval_items")
        .select("status")
        .eq("campaign_asset_id", assetId)
        .order("submitted_at", { ascending: false })
        .limit(1),
      tenant,
    ).maybeSingle<{ status: string }>();
    assertOk("approval_items (asset) lookup", approvalError);
    approved = approval ? /approved/i.test(approval.status) : false;
  }
  if (!approved) {
    throw new Error("Approve this piece before deploying it.");
  }

  const { error: unlockError } = await applyOrgScope(client.from("campaign_assets").update({ dispatch_locked: false }).eq("id", assetId), tenant);
  assertOk("campaign_assets unlock", unlockError);

  // Open the Outbox for this single deployed deliverable.
  await enqueueDispatchesForAssets({ campaignId, assetIds: [assetId], operator, scheduledFor, tenant }, client);

  const { error: eventError } = await client.from("campaign_events").insert({
    ...workspaceScopeFields(tenant),
    campaign_id: campaignId || null,
    campaign_asset_id: assetId,
    event_type: "asset_deployed",
    actor: operator,
    detail: scheduledFor
      ? `Deliverable scheduled for ${scheduledFor} by ${operator}; handed off to ${agentName}.`
      : `Deliverable deployed by ${operator}; handed off to ${agentName} for dispatch.`,
    payload: { source: "campaigns_workspace", handoff: "arc", single_asset: true },
  });
  assertOk("campaign_events insert", eventError);

  return { assetId };
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const byId = new Map<string, T>();
  for (const item of items) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

function assertOk(label: string, error: { message: string } | null) {
  if (error) {
    throw new Error(`${label} failed: ${error.message}`);
  }
}

function applyOrgScope<Query>(query: Query, tenant?: AgentTaskTenantFields): Query {
  if (!tenant) return query;
  return (query as { eq(column: string, value: string): Query }).eq("org_id", tenant.org_id);
}


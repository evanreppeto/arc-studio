import { type SupabaseClient } from "@supabase/supabase-js";

import { resolveCampaignAudience, type AudienceChannel, type AudienceContact } from "@/domain";
import { type AgentTaskTenantFields } from "@/lib/agent-tasks/scope";
import { loadSuppressedAddresses } from "@/lib/email-suppression/persistence";

import { DISPATCH_STATUS_ORDER, type DispatchStatus } from "./status";
import { workspaceScopeFields } from "@/lib/tenancy/write-scope";

const EVENT_FOR_STATUS: Partial<Record<DispatchStatus, string>> = {
  queued: "dispatch_queued",
  sent: "dispatch_sent",
  delivered: "dispatch_delivered",
  failed: "dispatch_failed",
  canceled: "dispatch_canceled",
};

function assertOk(label: string, error: { message: string } | null) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

export type EnqueueInput = { campaignId: string; assetIds: string[]; operator: string; scheduledFor?: string; tenant?: AgentTaskTenantFields };

/**
 * The dispatch producer (BSR-370). Called from the launch flow after assets are
 * unlocked. For each approved deliverable it creates `queued` `campaign_dispatches`
 * rows — the single reconciled dispatch table — linked to the deliverable's
 * approval item and, for addressable channels, resolved to one row per recipient
 * with a built payload. Idempotent: re-running never double-queues the same
 * (campaign × asset × channel × recipient). **It never sends** — a connector
 * (BSR-369) delivers `queued` rows, still gated per-send on approval.
 *
 * Grain: email deliverables fan out to one row per resolved recipient
 * (`contact_id` set, `payload{to,subject,html,text}`). Non-addressable deliverables
 * (printed pieces, social, etc.) stay a single deliverable-level row
 * (`contact_id` null) as before — a connector resolves their audience later.
 */
export async function enqueueDispatchesForAssets(input: EnqueueInput, client: SupabaseClient): Promise<void> {
  const { campaignId, assetIds, operator, scheduledFor, tenant } = input;
  if (assetIds.length === 0) return;

  const scheduled = Boolean(scheduledFor);
  const baseStatus: DispatchStatus = scheduled ? "scheduled" : "queued";

  const campaign = await loadCampaignTarget(client, campaignId, tenant);
  const assets = await loadApprovedAssets(client, assetIds, tenant);
  if (assets.length === 0) return;

  const approvalByAsset = await loadApprovalByAsset(client, assets.map((a) => a.id), tenant);
  const needsAudience = assets.some((a) => addressableChannel(a.channel) !== null);
  const contacts = needsAudience ? await loadCandidateContacts(client, campaign, tenant) : [];
  // Loaded once for the whole enqueue rather than per asset. Throws on a read
  // failure by design — an empty set would read as "nobody is suppressed" and
  // queue every opted-out address.
  const suppressedAddresses =
    needsAudience && tenant ? await loadSuppressedAddresses(tenant.org_id, client) : undefined;
  const existingKeys = await loadExistingKeys(client, campaignId, tenant);

  for (const asset of assets) {
    const approvalItemId = approvalByAsset.get(asset.id) ?? null;
    const channel = addressableChannel(asset.channel);

    if (channel) {
      const { recipients, summary } = resolveCampaignAudience(
        { persona: campaign.persona, contactId: campaign.contactId, companyId: campaign.companyId },
        contacts,
        channel,
        { suppressedAddresses },
      );
      for (const recipient of recipients) {
        const key = dispatchKey(campaignId, asset.id, channel, recipient.contactId);
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        await insertDispatchRow(client, {
          tenant,
          campaignId,
          asset,
          status: baseStatus,
          scheduledFor,
          approvalItemId,
          contactId: recipient.contactId,
          recipientSummary: recipient.fullName ?? recipient.address,
          idempotencyKey: key,
          payload: { ...buildEmailPayload(asset, recipient.address), source: "campaign_launch", deliverable: asset.title },
        });
      }
      await logAssetEnqueueEvent(client, { tenant, campaignId, asset, scheduled, scheduledFor, operator, detailExtra: summary });
    } else {
      const key = dispatchKey(campaignId, asset.id, asset.channel ?? "other", null);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      await insertDispatchRow(client, {
        tenant,
        campaignId,
        asset,
        status: baseStatus,
        scheduledFor,
        approvalItemId,
        contactId: null,
        recipientSummary: null,
        idempotencyKey: key,
        payload: { source: "campaign_launch", deliverable: asset.title },
      });
      await logAssetEnqueueEvent(client, { tenant, campaignId, asset, scheduled, scheduledFor, operator, detailExtra: null });
    }
  }
}

export type CampaignTarget = { persona: string; contactId: string | null; companyId: string | null };
export type AssetRow = { id: string; channel: string | null; title: string; approved_body: string | null; edited_body: string | null; draft_body: string | null };

// Addressable channels fan out per recipient. SMS/social/etc. resolve their
// audience in the channel connector (BSR-369); here they stay deliverable-level.
function addressableChannel(channel: string | null): AudienceChannel | null {
  return /email|mail/i.test(channel ?? "") ? "email" : null;
}

export async function loadCampaignTarget(client: SupabaseClient, campaignId: string, tenant?: AgentTaskTenantFields): Promise<CampaignTarget> {
  const { data, error } = await applyOrgScope(
    client.from("campaigns").select("persona,contact_id,company_id").eq("id", campaignId),
    tenant,
  ).maybeSingle<{ persona: string; contact_id: string | null; company_id: string | null }>();
  assertOk("campaigns lookup", error);
  if (!data || typeof data.persona !== "string") throw new Error("Campaign not found for dispatch.");
  return { persona: data.persona, contactId: data.contact_id ?? null, companyId: data.company_id ?? null };
}

async function loadApprovedAssets(client: SupabaseClient, assetIds: string[], tenant?: AgentTaskTenantFields): Promise<AssetRow[]> {
  const { data, error } = await applyOrgScope(
    client.from("campaign_assets").select("id,channel,title,approved_body,edited_body,draft_body").in("id", assetIds),
    tenant,
  );
  assertOk("campaign_assets lookup", error);
  return (data ?? []) as AssetRow[];
}

async function loadApprovalByAsset(client: SupabaseClient, assetIds: string[], tenant?: AgentTaskTenantFields): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (assetIds.length === 0) return map;
  const { data, error } = await applyOrgScope(
    client.from("approval_items").select("id,campaign_asset_id,status").in("campaign_asset_id", assetIds),
    tenant,
  );
  assertOk("approval_items lookup", error);
  for (const row of (data ?? []) as Array<{ id: string; campaign_asset_id: string | null; status: string }>) {
    if (row.campaign_asset_id && /approved/i.test(row.status) && !map.has(row.campaign_asset_id)) {
      map.set(row.campaign_asset_id, row.id);
    }
  }
  return map;
}

export async function loadCandidateContacts(client: SupabaseClient, campaign: CampaignTarget, tenant?: AgentTaskTenantFields): Promise<AudienceContact[]> {
  // email_unsubscribed_at is selected because the resolver now filters on it.
  // It was absent from this projection, which is why unsubscribed contacts were
  // enqueued as dispatches and only died one at a time at the send gate.
  let query = applyOrgScope(client.from("contacts").select("id,persona,status,email,phone,full_name,company_id,email_unsubscribed_at"), tenant);
  if (campaign.contactId) {
    query = query.eq("id", campaign.contactId);
  } else {
    query = query.eq("persona", campaign.persona);
    if (campaign.companyId) query = query.eq("company_id", campaign.companyId);
  }
  const { data, error } = await query;
  assertOk("contacts lookup", error);
  return ((data ?? []) as Array<{ id: string; persona: string; status: string; email: string | null; phone: string | null; full_name: string | null; company_id: string | null; email_unsubscribed_at: string | null }>).map((c) => ({
    id: c.id,
    persona: c.persona,
    status: c.status as AudienceContact["status"],
    email: c.email,
    phone: c.phone,
    fullName: c.full_name,
    companyId: c.company_id,
    emailUnsubscribedAt: c.email_unsubscribed_at,
  }));
}

async function loadExistingKeys(client: SupabaseClient, campaignId: string, tenant?: AgentTaskTenantFields): Promise<Set<string>> {
  const { data, error } = await applyOrgScope(
    client.from("campaign_dispatches").select("idempotency_key").eq("campaign_id", campaignId),
    tenant,
  );
  assertOk("campaign_dispatches keys lookup", error);
  const set = new Set<string>();
  for (const row of (data ?? []) as Array<{ idempotency_key: string | null }>) {
    if (row.idempotency_key) set.add(row.idempotency_key);
  }
  return set;
}

type InsertArgs = {
  tenant?: AgentTaskTenantFields;
  campaignId: string;
  asset: AssetRow;
  status: DispatchStatus;
  scheduledFor?: string;
  approvalItemId: string | null;
  contactId: string | null;
  recipientSummary: string | null;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

async function insertDispatchRow(client: SupabaseClient, args: InsertArgs): Promise<void> {
  const { error } = await client.from("campaign_dispatches").insert({
    ...workspaceScopeFields(args.tenant),
    campaign_id: args.campaignId,
    campaign_asset_id: args.asset.id,
    channel: args.asset.channel,
    status: args.status,
    ...(args.scheduledFor ? { scheduled_for: args.scheduledFor } : {}),
    approval_item_id: args.approvalItemId,
    contact_id: args.contactId,
    recipient_summary: args.recipientSummary,
    idempotency_key: args.idempotencyKey,
    payload: args.payload,
  });
  assertOk("campaign_dispatches insert", error);
}

async function logAssetEnqueueEvent(
  client: SupabaseClient,
  args: { tenant?: AgentTaskTenantFields; campaignId: string; asset: AssetRow; scheduled: boolean; scheduledFor?: string; operator: string; detailExtra: string | null },
): Promise<void> {
  const { tenant, campaignId, asset, scheduled, scheduledFor, operator, detailExtra } = args;
  const baseDetail = scheduled ? `Scheduled "${asset.title}" for ${scheduledFor}.` : `Queued "${asset.title}" for dispatch.`;
  const { error } = await client.from("campaign_events").insert({
    ...workspaceScopeFields(tenant),
    campaign_id: campaignId,
    campaign_asset_id: asset.id,
    event_type: scheduled ? "dispatch_scheduled" : "dispatch_queued",
    actor: operator,
    detail: detailExtra ? `${baseDetail} ${detailExtra}` : baseDetail,
    payload: { channel: asset.channel, ...(scheduled ? { scheduled_for: scheduledFor } : {}) },
  });
  assertOk("campaign_events insert", error);
}

export function buildEmailPayload(asset: AssetRow, address: string): { to: string; subject: string; html: string; text: string } {
  const text = asset.approved_body ?? asset.edited_body ?? asset.draft_body ?? "";
  const html = escapeHtml(text)
    .split(/\n{2,}/)
    // Bare URLs become real anchors: clickable in mail clients, and — the
    // load-bearing part — stampable by stampCampaignLinks, which rewrites
    // href attributes only. Without this, HTML variants shipped unstamped.
    .map((paragraph) => `<p>${linkifyUrls(paragraph).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  return { to: address, subject: asset.title, html: html || "<p></p>", text };
}

function linkifyUrls(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<]+/g, (url) => {
    const trailing = url.match(/[.,;:!?)]+$/)?.[0] ?? "";
    const core = trailing ? url.slice(0, -trailing.length) : url;
    return `<a href="${core}">${core}</a>${trailing}`;
  });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function dispatchKey(campaignId: string, assetId: string, channel: string, contactId: string | null): string {
  return [campaignId, assetId, channel, contactId ?? "deliverable"].join(":");
}

export type TransitionInput = {
  dispatchId: string;
  to: DispatchStatus;
  operator: string;
  note?: string;
  scheduledFor?: string;
  tenant?: AgentTaskTenantFields;
};

/** Move a dispatch to a new status, stamping timestamps and logging an event.
 *  Operator-driven — the app never performs a real send. */
export async function transitionDispatch(input: TransitionInput, client: SupabaseClient): Promise<void> {
  const { dispatchId, to, operator, note, scheduledFor, tenant } = input;
  if (!DISPATCH_STATUS_ORDER.includes(to)) {
    throw new Error(`Unknown dispatch status: ${to}`);
  }

  const { data: existing, error: lookupError } = await applyOrgScope(
    client
      .from("campaign_dispatches")
      .select("id,campaign_id,status")
      .eq("id", dispatchId),
    tenant,
  ).maybeSingle<{ id: string; campaign_id: string; status: string }>();
  assertOk("campaign_dispatches lookup", lookupError);
  if (!existing) throw new Error("Dispatch not found.");

  const patch: Record<string, unknown> = { status: to, updated_at: new Date().toISOString() };
  if (to === "sent" || to === "delivered") patch.dispatched_at = new Date().toISOString();
  if (to === "scheduled" && scheduledFor) patch.scheduled_for = scheduledFor;
  if (note) patch.result_note = note;

  const { error: updateError } = await applyOrgScope(client.from("campaign_dispatches").update(patch).eq("id", dispatchId), tenant);
  assertOk("campaign_dispatches update", updateError);

  const eventType = EVENT_FOR_STATUS[to];
  if (eventType) {
    const { error: eventError } = await client.from("campaign_events").insert({
      ...workspaceScopeFields(tenant),
      campaign_id: existing.campaign_id,
      event_type: eventType,
      actor: operator,
      detail: note ?? `Dispatch marked ${to} by ${operator}.`,
      payload: { dispatch_id: dispatchId, from: existing.status, to },
    });
    assertOk("campaign_events insert", eventError);
  }
}

function applyOrgScope<Query>(query: Query, tenant?: AgentTaskTenantFields): Query {
  if (!tenant) return query;
  return (query as { eq(column: string, value: string): Query }).eq("org_id", tenant.org_id);
}


import { type SupabaseClient } from "@supabase/supabase-js";

import { resolveCampaignAudience, stampCampaignLinks, type ResolvedRecipient } from "@/domain";
import { type AgentTaskTenantFields } from "@/lib/agent-tasks/scope";
import { buildEmailPayload, loadCampaignTarget, loadCandidateContacts } from "@/lib/dispatch/persistence";
import { workspaceScopeFields } from "@/lib/tenancy/write-scope";

/**
 * BYO send channel — the outbound half of "use your own tools, keep the
 * intelligence". A workspace that sends through its own ESP (their Mailchimp,
 * their Klaviyo, their own Resend account) exports the APPROVED content with
 * campaign attribution already stamped into every first-party link (utm +
 * bsg_at — the token resolveAttribution and the journey collector read back),
 * plus the resolved audience. When it goes out, "mark as sent" records the
 * same outbound_send engagement touches a native dispatch writes, so
 * journeys, performance, and exemplar selection keep learning even though the
 * app never touched the wire.
 *
 * The human gate is identical to the native path: only an asset carrying an
 * operator's approval signature (`approved_at`, written solely by
 * campaigns/decisions.ts) can be exported or marked sent. The app still never
 * sends anything here — the operator's own tool does, and the operator says so.
 */

type ExternalAssetRow = {
  id: string;
  campaign_id: string;
  org_id: string;
  channel: string | null;
  title: string;
  status: string;
  approved_at: string | null;
  approved_body: string | null;
  edited_body: string | null;
  draft_body: string | null;
};

export type ExternalSendPackage = {
  campaignId: string;
  assetId: string;
  title: string;
  channel: string;
  subject: string;
  /** Approved body as simple paragraph HTML, attribution-stamped. */
  html: string;
  /** Approved body as plain text, attribution-stamped. */
  text: string;
  recipients: ResolvedRecipient[];
  suppressedCount: number;
  /** "email,name,persona" rows for a paste-into-your-ESP audience list. */
  audienceCsv: string;
};

export type ExternalSendPackageResult = { ok: true; pkg: ExternalSendPackage } | { ok: false; error: string };

const NOT_APPROVED =
  "Only approved deliverables can be exported for an external send — the human approval gate applies no matter which tool sends.";

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function loadExternalAsset(
  client: SupabaseClient,
  input: { campaignId: string; assetId: string; tenant: AgentTaskTenantFields },
): Promise<{ ok: true; asset: ExternalAssetRow } | { ok: false; error: string }> {
  const { data, error } = await client
    .from("campaign_assets")
    .select("id,campaign_id,org_id,channel,title,status,approved_at,approved_body,edited_body,draft_body")
    .eq("id", input.assetId)
    .eq("campaign_id", input.campaignId)
    .eq("org_id", input.tenant.org_id)
    .maybeSingle<ExternalAssetRow>();
  if (error) return { ok: false, error: `campaign_assets lookup: ${error.message}` };
  if (!data) return { ok: false, error: "That deliverable isn't in this workspace." };
  if (!data.approved_at) return { ok: false, error: NOT_APPROVED };
  return { ok: true, asset: data };
}

export async function buildExternalSendPackage(
  input: { campaignId: string; assetId: string; tenant: AgentTaskTenantFields },
  client: SupabaseClient,
): Promise<ExternalSendPackageResult> {
  const loaded = await loadExternalAsset(client, input);
  if (!loaded.ok) return loaded;
  const asset = loaded.asset;

  // Same body conversion the native dispatch enqueue uses, then the same
  // attribution stamping the native send applies at execute time — an external
  // send and a native send produce byte-identical tracked content.
  const payload = buildEmailPayload(asset, "");
  const stamped = stampCampaignLinks(
    { html: payload.html, text: payload.text },
    { campaignId: asset.campaign_id, assetId: asset.id, channel: asset.channel },
  );

  const target = await loadCampaignTarget(client, input.campaignId, input.tenant);
  const contacts = await loadCandidateContacts(client, target, input.tenant);
  const audience = resolveCampaignAudience(target, contacts, "email");

  const audienceCsv = [
    "email,name,persona",
    ...audience.recipients.map((r) => [csvCell(r.address), csvCell(r.fullName ?? ""), csvCell(r.persona ?? "")].join(",")),
  ].join("\n");

  return {
    ok: true,
    pkg: {
      campaignId: asset.campaign_id,
      assetId: asset.id,
      title: asset.title,
      channel: asset.channel ?? "email",
      subject: payload.subject,
      html: stamped.html ?? payload.html,
      text: stamped.text ?? payload.text,
      recipients: audience.recipients,
      suppressedCount: audience.suppressed.length,
      audienceCsv,
    },
  };
}

export type RecordExternalSendResult = { ok: true; recipients: number } | { ok: false; error: string };

/**
 * The operator's declaration that the exported content went out through their
 * own tool. Writes one `outbound_send` engagement touch per resolved recipient
 * (idempotent per asset+contact via the (source_system, external_event_id)
 * unique index — marking twice cannot double-count) plus one campaign event
 * for the audit trail. Dispatch rows are untouched: the app performed no send
 * and invents no provider ids.
 */
export async function recordExternalSend(
  input: { campaignId: string; assetId: string; operator: string; tool?: string | null; tenant: AgentTaskTenantFields },
  client: SupabaseClient,
): Promise<RecordExternalSendResult> {
  const loaded = await loadExternalAsset(client, input);
  if (!loaded.ok) return loaded;
  const asset = loaded.asset;

  const target = await loadCampaignTarget(client, input.campaignId, input.tenant);
  const contacts = await loadCandidateContacts(client, target, input.tenant);
  const audience = resolveCampaignAudience(target, contacts, "email");
  if (audience.recipients.length === 0) {
    return { ok: false, error: "No sendable audience resolved for this campaign — nothing to record." };
  }

  const toolLabel = input.tool?.trim() || "an external tool";
  const occurredAt = new Date().toISOString();
  const rows = audience.recipients.map((recipient) => ({
    org_id: input.tenant.org_id,
    campaign_id: asset.campaign_id,
    campaign_asset_id: asset.id,
    contact_id: recipient.contactId,
    event_type: "outbound_send",
    channel: "email",
    direction: "outbound",
    source_system: "external",
    external_event_id: `ext-send:${asset.id}:${recipient.contactId}`,
    occurred_at: occurredAt,
    summary: `Campaign email sent via ${toolLabel} (recorded by ${input.operator}).`,
    metadata: { provider: "external", tool: input.tool?.trim() || null },
    reasoning_payload: {},
  }));

  const { error: engagementError } = await client
    .from("engagement_events")
    .upsert(rows, { onConflict: "source_system,external_event_id", ignoreDuplicates: true });
  if (engagementError) return { ok: false, error: `engagement_events insert: ${engagementError.message}` };

  const { error: eventError } = await client.from("campaign_events").insert({
    ...workspaceScopeFields(input.tenant),
    campaign_id: asset.campaign_id,
    // campaign_event_type is an ENUM on prod; "exported" is its value for
    // content leaving through a non-dispatch path. The detail line carries the
    // external-send story (tool + recipient count).
    event_type: "exported",
    actor: input.operator,
    detail: `"${asset.title}" marked sent via ${toolLabel} to ${audience.recipients.length} recipient(s).`,
    payload: { campaign_asset_id: asset.id, channel: "email", provider: "external", tool: input.tool?.trim() || null, recipients: audience.recipients.length },
  });
  if (eventError) return { ok: false, error: `campaign_events insert: ${eventError.message}` };

  return { ok: true, recipients: audience.recipients.length };
}

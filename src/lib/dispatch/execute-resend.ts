import { type SupabaseClient } from "@supabase/supabase-js";

import {
  buildListUnsubscribeHeaders,
  buildResendEmailPayload,
  buildUnsubscribeUrl,
  checkSenderIdentity,
  describeSenderIdentityProblem,
  stampCampaignLinks,
  wrapMarketingEmail,
  type ResendEmailPayload,
} from "@/domain";

import { checkUsageAllowed } from "@/lib/billing/entitlements";
import { recordConnectionUse } from "@/lib/connections/persistence";
import { sendResendEmail } from "@/lib/connections/resend-client";
import { readConnectorCredential } from "@/lib/connectors/credentials";

import { getUnsubscribeSecret, isContactSuppressed, loadWorkspaceEmailIdentity } from "./email-identity";
import { isLiveSendEnabled } from "./live-send";

// The ONLY place the app performs a real send. It operates on an already-queued
// (or operator-forced "send now" scheduled) approval-linked `campaign_dispatches`
// row — the single reconciled dispatch table (BSR-370, see
// docs/dispatch-reconciliation.md) — and refuses anything that isn't both pre-send
// and approved: the outbound-locked invariant ("the app never sends unapproved
// content"). Only ever reached from an explicit operator confirm in the Outbox.
// Idempotent: an already-sent row is never re-sent.

function assertOk(label: string, error: { message: string } | null) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

export type ExecuteResendResult = {
  ok: boolean;
  message: string;
  providerMessageId?: string;
};

export type ExecuteResendDeps = {
  /** Injected for tests; defaults to the real Resend HTTP client. */
  send?: (apiKey: string, payload: ResendEmailPayload) => Promise<{ id: string }>;
  /** Override the resolved key (tests). Wins over stored + env when provided. */
  apiKey?: string;
  /** Read a Vault secret by ref (tests); defaults to the real vault reader. */
  readCredential?: (ref: string) => Promise<string | null>;
};

type DispatchRow = {
  id: string;
  org_id: string;
  status: string;
  approval_item_id: string | null;
  channel: string | null;
  campaign_id: string | null;
  campaign_asset_id: string | null;
  contact_id: string | null;
  provider_message_id: string | null;
  payload: { to?: string | string[]; subject?: string; html?: string; text?: string } | null;
};

async function logCampaignEvent(
  client: SupabaseClient,
  orgId: string,
  campaignId: string | null,
  eventType: "dispatch_sent" | "dispatch_failed",
  actor: string,
  detail: string,
) {
  if (!campaignId) return;
  const { error } = await client.from("campaign_events").insert({
    org_id: orgId,
    campaign_id: campaignId,
    event_type: eventType,
    actor,
    detail,
    payload: { channel: "email", provider: "resend" },
  });
  assertOk("campaign_events insert", error);
}

export async function executeResendDispatch(
  input: { dispatchId: string; operator: string },
  client: SupabaseClient,
  deps: ExecuteResendDeps = {},
): Promise<ExecuteResendResult> {
  const { dispatchId, operator } = input;
  const send = deps.send ?? sendResendEmail;

  // Master kill-switch: nothing leaves the building unless live sending has been
  // deliberately armed. Checked before any read/write so a dark environment is
  // provably inert — every earlier gate (approval, connection toggle) still applies.
  if (!isLiveSendEnabled()) {
    return { ok: false, message: "Live sending is turned off. Set ARC_SEND_ENABLED=1 to arm real sends." };
  }

  const { data: dispatch, error: dispatchError } = await client
    .from("campaign_dispatches")
    .select("id,org_id,status,approval_item_id,channel,campaign_id,campaign_asset_id,contact_id,provider_message_id,payload")
    .eq("id", dispatchId)
    .maybeSingle<DispatchRow>();
  assertOk("campaign_dispatches lookup", dispatchError);

  if (!dispatch) return { ok: false, message: "Dispatch not found." };

  if (dispatch.status === "sent") {
    return {
      ok: true,
      message: "Already sent — no re-send.",
      providerMessageId: dispatch.provider_message_id ?? undefined,
    };
  }
  if (dispatch.status !== "queued" && dispatch.status !== "scheduled") {
    return { ok: false, message: `Dispatch is ${dispatch.status}; only queued or scheduled dispatches can be sent.` };
  }
  if (!dispatch.approval_item_id) {
    return { ok: false, message: "Dispatch is not linked to an approval, so it can't be sent." };
  }

  // A lapsed trial makes the workspace read-only: outbound stops. Checked on
  // `readOnly` only, NOT on being over the AI cap — an approved email costs no
  // model spend, so refusing to deliver already-approved work because the agent
  // used its allowance would punish the customer for the wrong thing.
  const gate = await checkUsageAllowed(dispatch.org_id, client);
  if (!gate.allowed && gate.reason === "trial_expired") {
    return {
      ok: false,
      message: "This workspace's free trial has ended, so outbound is paused. Add a plan to resume sending — nothing has been lost.",
    };
  }

  const { data: approval, error: approvalError } = await client
    .from("approval_items")
    .select("status")
    .eq("id", dispatch.approval_item_id)
    .maybeSingle<{ status: string }>();
  assertOk("approval_items lookup", approvalError);
  if (!approval || !/approved/i.test(approval.status)) {
    return { ok: false, message: "The linked approval isn't approved yet." };
  }

  // The approval ROW is not the lock, and until here nothing checked anything else.
  // Every gate in the chain decides "approved" from approval_items.status alone --
  // this one, launch.ts's deploy gate (which falls back to the row when the asset's
  // own status disagrees, then clears dispatch_locked), and the enqueue that builds
  // these dispatches. So one row reading `approved` unlocks the whole path to the
  // outside world, and `dispatch_locked` -- the flag the rest of the codebase treats
  // as the outbound lock, and that revisions.ts is careful to leave alone -- was
  // never consulted by the code that actually sends.
  //
  // Not hypothetical. Prod holds three approval_items marked `approved` whose assets
  // are still pending_approval, dispatch_locked = true, approved_at NULL: seeded
  // rows no operator ever decided on. They satisfy every check above. The one action
  // needed to send for the first time (ARC_SEND_ENABLED=1) is the same action that
  // would arm them.
  //
  // So require the asset to agree. approved_at/approved_by are written ONLY by
  // campaigns/decisions.ts when an operator approves, and cleared when a decision is
  // undone or a revision requested -- they are the human's signature, and a seed or a
  // stray `approved` row does not carry one. dispatch_locked = false additionally
  // means it was deployed, not merely approved.
  if (!dispatch.campaign_asset_id) {
    return { ok: false, message: "Dispatch isn't linked to a campaign asset, so its approval can't be verified." };
  }

  const { data: asset, error: assetError } = await client
    .from("campaign_assets")
    .select("status,dispatch_locked,approved_at")
    .eq("org_id", dispatch.org_id)
    .eq("id", dispatch.campaign_asset_id)
    .maybeSingle<{ status: string; dispatch_locked: boolean; approved_at: string | null }>();
  assertOk("campaign_assets lookup", assetError);
  if (!asset) {
    return { ok: false, message: "The dispatch's campaign asset no longer exists, so it can't be sent." };
  }
  if (!asset.approved_at) {
    return {
      ok: false,
      message:
        "No operator approval is recorded on this asset, so it can't be sent — the linked approval says approved, " +
        "but the asset itself was never approved by a human.",
    };
  }
  if (asset.dispatch_locked) {
    return { ok: false, message: "This asset is still locked for dispatch. Deploy it from the campaign first." };
  }

  // Scope the connection to THIS dispatch's org. On the RLS-bypassing admin
  // client an unscoped `.eq("provider","resend")` would (with >1 org) either
  // throw on multiple rows or grab another tenant's from-address/kill-switch.
  const { data: connection, error: connectionError } = await client
    .from("connections")
    .select("enabled,env_var,config,credential_ref")
    .eq("org_id", dispatch.org_id)
    .eq("provider", "resend")
    .maybeSingle<{
      enabled: boolean;
      env_var: string | null;
      config: Record<string, unknown> | null;
      credential_ref: string | null;
    }>();
  assertOk("connections lookup", connectionError);
  if (!connection?.enabled) {
    return { ok: false, message: "Resend is connected but disabled. Enable it in Settings → Connections." };
  }

  // Prefer this workspace's own Resend key (Vault secret referenced by the row)
  // over the shared deployment env var. A test override wins over both.
  const readCredential = deps.readCredential ?? ((ref: string) => readConnectorCredential(client, ref));
  const storedKey = connection.credential_ref ? await readCredential(connection.credential_ref).catch(() => null) : null;
  const apiKey = deps.apiKey || storedKey || process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, message: "Resend isn't configured (no workspace key stored and RESEND_API_KEY is missing)." };
  }

  const config = connection.config ?? {};
  const from = (typeof config.fromEmail === "string" && config.fromEmail) || process.env.RESEND_FROM;
  if (!from) {
    return { ok: false, message: "No from-address configured for Resend (set config.fromEmail or RESEND_FROM)." };
  }

  // Attribution capture: tag first-party links in the body so a recipient's
  // click-through carries this campaign's identity (utm + bsg_at token), which
  // resolveAttribution reads back when the resulting lead is ingested. No-op when
  // the dispatch has no campaign (bare send) or the body has no taggable links.
  const stamped = dispatch.campaign_id
    ? stampCampaignLinks(
        { html: dispatch.payload?.html, text: dispatch.payload?.text },
        { campaignId: dispatch.campaign_id, assetId: dispatch.campaign_asset_id, channel: dispatch.channel },
      )
    : { html: dispatch.payload?.html ?? null, text: dispatch.payload?.text ?? null };

  // Consent, then compliance, then brand — in that order, because each is a
  // reason NOT to send and the cheapest refusal should come first.
  const suppression = await isContactSuppressed(dispatch.contact_id, client);
  if (suppression.suppressed) {
    await markFailed(client, dispatch.org_id, dispatchId, dispatch.campaign_id, operator, suppression.reason ?? "Recipient is suppressed.");
    return { ok: false, message: suppression.reason ?? "Recipient is suppressed." };
  }

  const { identity, brand } = await loadWorkspaceEmailIdentity(dispatch.org_id, client);
  const identityProblems = checkSenderIdentity(identity);
  if (identityProblems.length > 0) {
    // Refuse rather than send: a commercial email with no postal address or no
    // working unsubscribe is unlawful in the US, CA, EU and UK alike.
    const message = identityProblems.map(describeSenderIdentityProblem).join(" ");
    await markFailed(client, dispatch.org_id, dispatchId, dispatch.campaign_id, operator, message);
    return { ok: false, message };
  }

  const unsubscribeSecret = getUnsubscribeSecret();
  if (!unsubscribeSecret || !dispatch.contact_id) {
    const message = !dispatch.contact_id
      ? "This dispatch has no contact, so no unsubscribe link can be generated. Marketing email requires one."
      : "No unsubscribe signing secret is configured, so a working unsubscribe link can't be generated.";
    await markFailed(client, dispatch.org_id, dispatchId, dispatch.campaign_id, operator, message);
    return { ok: false, message };
  }

  const unsubscribeUrl = buildUnsubscribeUrl(
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://arc-studio.ai",
    { contactId: dispatch.contact_id, orgId: dispatch.org_id },
    unsubscribeSecret,
  );

  const wrapped = wrapMarketingEmail({
    html: stamped.html,
    text: stamped.text,
    identity: {
      senderName: identity.senderName ?? "",
      postalAddress: identity.postalAddress ?? "",
      permissionReminder: identity.permissionReminder,
    },
    brand,
    unsubscribeUrl,
  });

  let payload: ResendEmailPayload;
  try {
    payload = buildResendEmailPayload({
      from,
      to: dispatch.payload?.to ?? [],
      subject: dispatch.payload?.subject ?? "",
      html: wrapped.html ?? undefined,
      text: wrapped.text ?? undefined,
      headers: buildListUnsubscribeHeaders(unsubscribeUrl),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid email payload.";
    await markFailed(client, dispatch.org_id, dispatchId, dispatch.campaign_id, operator, message);
    return { ok: false, message };
  }

  let providerMessageId: string;
  try {
    const sent = await send(apiKey, payload);
    providerMessageId = sent.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Resend send failed.";
    await markFailed(client, dispatch.org_id, dispatchId, dispatch.campaign_id, operator, message);
    return { ok: false, message };
  }

  const { error: updateError } = await client
    .from("campaign_dispatches")
    .update({
      status: "sent",
      provider: "resend",
      provider_message_id: providerMessageId,
      dispatched_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", dispatchId);
  assertOk("campaign_dispatches sent update", updateError);

  await recordConnectionUse(client, dispatch.org_id, "resend");
  await logCampaignEvent(client, dispatch.org_id, dispatch.campaign_id, "dispatch_sent", operator, `Sent via Resend (${providerMessageId}).`);
  await recordOutboundTouch(client, dispatch, providerMessageId);

  return { ok: true, message: "Sent via Resend.", providerMessageId };
}

/**
 * Record the send as a durable attribution touch in engagement_events — the
 * "we contacted contact X for campaign Y on channel Z" signal the performance
 * read-models already read (campaign traffic, persona intelligence) and the raw
 * material for last-touch attribution on inbound leads. Best-effort: the send has
 * already succeeded, so a logging failure must never surface as a send failure,
 * and engagement_events is a tolerated-optional table.
 *
 * Best-effort means "never fails the send" — NOT "fails invisibly". This row is
 * the only fuel the journey/attribution layer ever gets, so a lost write means a
 * campaign that looks sent but is unattributable, with nothing anywhere to say
 * why. Both failure shapes are logged: postgrest returns `{ error }` rather than
 * rejecting, so the error check — not the catch — is what actually catches a
 * constraint violation (e.g. engagement_events_subject_check, which needs at
 * least one subject FK: a bare send with no campaign_id AND no contact_id).
 */
async function recordOutboundTouch(client: SupabaseClient, dispatch: DispatchRow, providerMessageId: string) {
  try {
    const { error } = await client.from("engagement_events").insert({
      org_id: dispatch.org_id,
      event_type: "outbound_send",
      direction: "outbound",
      channel: dispatch.channel ?? "email",
      source_system: "resend",
      external_event_id: providerMessageId,
      campaign_id: dispatch.campaign_id,
      campaign_asset_id: dispatch.campaign_asset_id,
      contact_id: dispatch.contact_id,
      summary: "Campaign email dispatched via Resend.",
      metadata: { provider: "resend" },
    });
    if (error) {
      console.warn(`[dispatch] engagement_events insert failed for dispatch ${dispatch.id} (${providerMessageId}): ${error.message}`);
    }
  } catch (err) {
    console.warn(`[dispatch] engagement_events insert threw for dispatch ${dispatch.id} (${providerMessageId}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function markFailed(
  client: SupabaseClient,
  orgId: string,
  dispatchId: string,
  campaignId: string | null,
  operator: string,
  message: string,
) {
  const { error } = await client
    .from("campaign_dispatches")
    .update({ status: "failed", last_error: message })
    .eq("org_id", orgId)
    .eq("id", dispatchId);
  assertOk("campaign_dispatches failed update", error);
  await logCampaignEvent(client, orgId, campaignId, "dispatch_failed", operator, message);
}

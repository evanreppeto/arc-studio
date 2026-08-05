import { createHmac, timingSafeEqual } from "node:crypto";

import { type SupabaseClient } from "@supabase/supabase-js";

import {
  dispatchStatusForResendEvent,
  engagementForResendEvent,
  suppressionForResendEvent,
  type ResendWebhookEvent,
} from "@/domain";
import { recordEmailSuppression } from "@/lib/email-suppression/persistence";

/**
 * The write side of the Resend engagement webhook: resolve the provider's
 * message id back to the dispatch it belongs to, record the engagement event
 * org-scoped, and advance the dispatch status (forward-only). Idempotent via
 * the partial unique index on engagement_events (source_system,
 * external_event_id) — svix redelivers, and a redelivery must not double-count
 * an open.
 */

/**
 * Verify a svix-style webhook signature (Resend signs with svix). The signed
 * content is `${id}.${timestamp}.${payload}`, HMAC-SHA256 keyed with the
 * base64-decoded secret (`whsec_` prefix stripped), compared against each
 * space-separated `v1,<base64>` candidate. Timestamps outside the tolerance
 * window are rejected to stop replays.
 */
export function verifySvixSignature(input: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  payload: string;
  nowMs?: number;
  toleranceSeconds?: number;
}): boolean {
  const { secret, id, timestamp, signature, payload } = input;
  if (!secret || !id || !timestamp || !signature) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const nowSeconds = (input.nowMs ?? Date.now()) / 1000;
  const tolerance = input.toleranceSeconds ?? 300;
  if (Math.abs(nowSeconds - timestampSeconds) > tolerance) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return false;

  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`, "utf8").digest();

  return signature.split(" ").some((candidate) => {
    const [version, value] = candidate.split(",");
    if (version !== "v1" || !value) return false;
    const provided = Buffer.from(value, "base64");
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
}

type DispatchRow = {
  id: string;
  org_id: string;
  status: string;
  campaign_id: string | null;
  campaign_asset_id: string | null;
  contact_id: string | null;
  payload: { to?: string | string[] } | null;
};

/** The address a dispatch actually mailed, for keying a suppression. */
function dispatchAddress(dispatch: DispatchRow): string | null {
  const to = dispatch.payload?.to;
  if (typeof to === "string") return to;
  if (Array.isArray(to) && typeof to[0] === "string") return to[0];
  return null;
}

export type RecordResendEventResult =
  | { ok: true; recorded: boolean; note: string }
  | { ok: false; error: string };

/**
 * Record one verified Resend event. `externalEventId` is the svix message id —
 * the redelivery-stable identity the dedupe index keys on.
 */
export async function recordResendWebhookEvent(
  input: { event: ResendWebhookEvent; externalEventId: string },
  client: SupabaseClient,
): Promise<RecordResendEventResult> {
  const { event, externalEventId } = input;

  const engagement = engagementForResendEvent(event);
  const nextStatus = dispatchStatusForResendEvent(event.type);
  const suppression = suppressionForResendEvent(event);
  if (!engagement && !nextStatus && !suppression) return { ok: true, recorded: false, note: `Ignored ${event.type}.` };

  const { data: dispatch, error: dispatchError } = await client
    .from("campaign_dispatches")
    .select("id,org_id,status,campaign_id,campaign_asset_id,contact_id,payload")
    .eq("provider_message_id", event.emailId)
    .maybeSingle<DispatchRow>();
  if (dispatchError) return { ok: false, error: `campaign_dispatches lookup: ${dispatchError.message}` };
  // Unknown message id: a send this app didn't make (manual Resend use, another
  // environment). Acknowledge so svix stops retrying — there is nothing to attach it to.
  if (!dispatch) return { ok: true, recorded: false, note: `No dispatch for message ${event.emailId}.` };

  if (engagement) {
    const occurredAt = event.createdAt && Number.isFinite(Date.parse(event.createdAt)) ? event.createdAt : new Date().toISOString();
    const { error: insertError } = await client.from("engagement_events").upsert(
      {
        org_id: dispatch.org_id,
        campaign_id: dispatch.campaign_id,
        campaign_asset_id: dispatch.campaign_asset_id,
        contact_id: dispatch.contact_id,
        event_type: engagement.eventType,
        channel: "email",
        direction: engagement.direction,
        source_system: "resend",
        external_event_id: externalEventId,
        occurred_at: occurredAt,
        summary: engagement.summary,
        metadata: { provider: "resend", resend_event: event.type, email_id: event.emailId, ...(event.clickedLink ? { link: event.clickedLink } : {}) },
        reasoning_payload: {},
      },
      { onConflict: "source_system,external_event_id", ignoreDuplicates: true },
    );
    if (insertError) return { ok: false, error: `engagement_events insert: ${insertError.message}` };
  }

  // Forward-only: delivery confirmation upgrades a sent row, a bounce fails it.
  // Never touch rows that haven't been sent (or were canceled) — a stray
  // provider event must not resurrect or regress dispatch state.
  if (nextStatus && dispatch.status === "sent") {
    const update =
      nextStatus === "failed"
        ? { status: nextStatus, last_error: "Bounced (Resend webhook)." }
        : { status: nextStatus };
    const { error: updateError } = await client
      .from("campaign_dispatches")
      .update(update)
      .eq("id", dispatch.id)
      .eq("org_id", dispatch.org_id)
      .eq("status", "sent");
    if (updateError) return { ok: false, error: `campaign_dispatches update: ${updateError.message}` };
  }

  // A hard bounce or a spam complaint must stop the NEXT campaign too, not just
  // fail this dispatch. Keyed by the address the provider reports, falling back
  // to what this dispatch mailed — the register is address-keyed precisely so a
  // provider event, which knows no contact id, can write to it.
  //
  // Runs after the engagement insert so a suppression failure can't cost us the
  // event record, and is idempotent so a svix redelivery is harmless.
  if (suppression) {
    const recorded = await recordEmailSuppression(
      {
        orgId: dispatch.org_id,
        address: event.recipient ?? dispatchAddress(dispatch),
        reason: suppression.reason,
        source: "resend",
        detail: suppression.detail,
        contactId: dispatch.contact_id,
      },
      client,
    );
    if (!recorded.ok) return { ok: false, error: recorded.error };
  }

  return { ok: true, recorded: Boolean(engagement), note: `Recorded ${event.type}.` };
}

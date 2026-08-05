/**
 * Pure logic for the Resend engagement webhook: event parsing and the mapping
 * from a provider event to the engagement row + dispatch transition the app
 * records. No I/O and no runtime-specific imports — signature verification
 * (node:crypto) lives in `src/lib/dispatch/resend-webhook.ts`.
 *
 * This is the INBOUND half of the send loop. `executeResendDispatch` records
 * `outbound_send` when an email leaves; without these events nothing ever
 * records that a recipient received, opened, or clicked it — the learning loop
 * (journeys, performance, exemplar selection) starves with zero inbound fuel.
 */

import { isPermanentBounce } from "./email-suppression";

/** The Resend event types the app understands (anything else is acknowledged and dropped). */
export const RESEND_EVENT_TYPES = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.opened",
  "email.clicked",
] as const;
export type ResendEventType = (typeof RESEND_EVENT_TYPES)[number];

export type ResendWebhookEvent = {
  type: ResendEventType;
  /** Resend's message id — matches `campaign_dispatches.provider_message_id`. */
  emailId: string;
  /** Provider-side occurrence time (ISO); the write site falls back to now. */
  createdAt: string | null;
  /** First clicked link, when the event is email.clicked. */
  clickedLink: string | null;
  /**
   * First recipient address, when the provider sends one. This is the only key a
   * bounce or complaint gives us — the suppression register is address-keyed, and
   * without this a hard bounce could only ever suppress by contact id (BSR-482).
   */
  recipient: string | null;
  /**
   * Bounce classification: SES-style `Permanent` / `Transient` / `Undetermined`.
   * Only a permanent bounce earns a suppression — see `isPermanentBounce`.
   */
  bounceType: string | null;
};

/** Parse a Resend webhook body. Returns null for anything malformed or a type
 *  the app doesn't handle — the route acknowledges those without writing. */
export function parseResendWebhookEvent(value: unknown): ResendWebhookEvent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string" || !(RESEND_EVENT_TYPES as readonly string[]).includes(type)) return null;
  const data = record.data;
  if (!data || typeof data !== "object") return null;
  const dataRecord = data as Record<string, unknown>;
  const emailId = dataRecord.email_id;
  if (typeof emailId !== "string" || !emailId) return null;
  const createdAt = typeof record.created_at === "string" ? record.created_at : null;
  const click = dataRecord.click;
  const clickedLink =
    click && typeof click === "object" && typeof (click as Record<string, unknown>).link === "string"
      ? ((click as Record<string, unknown>).link as string)
      : null;
  // `to` is an array in Resend's payloads, but accept a bare string too — a
  // provider that "helpfully" collapses a single-recipient array is not worth a
  // silently dropped suppression.
  const to = dataRecord.to;
  const recipient =
    typeof to === "string" && to
      ? to
      : Array.isArray(to) && typeof to[0] === "string" && to[0]
        ? (to[0] as string)
        : null;
  const bounce = dataRecord.bounce;
  const bounceType =
    bounce && typeof bounce === "object" && typeof (bounce as Record<string, unknown>).type === "string"
      ? ((bounce as Record<string, unknown>).type as string)
      : null;
  return { type: type as ResendEventType, emailId, createdAt, clickedLink, recipient, bounceType };
}

export type ResendEngagementInput = {
  /** engagement_events.event_type — journey mapping keys off open/click substrings. */
  eventType: string;
  direction: "inbound" | "outbound";
  summary: string;
};

/**
 * The engagement row a provider event becomes, or null when the event should
 * not be recorded (`email.sent` duplicates the app's own `outbound_send`;
 * `delivery_delayed` is operational noise, visible in Resend's own dashboard).
 */
export function engagementForResendEvent(event: ResendWebhookEvent): ResendEngagementInput | null {
  switch (event.type) {
    case "email.delivered":
      return { eventType: "email_delivered", direction: "outbound", summary: "Email delivered to the recipient's mailbox." };
    case "email.opened":
      return { eventType: "email_open", direction: "inbound", summary: "Recipient opened the email." };
    case "email.clicked":
      return {
        eventType: "email_click",
        direction: "inbound",
        summary: event.clickedLink ? `Recipient clicked ${event.clickedLink}` : "Recipient clicked a link in the email.",
      };
    case "email.bounced":
      return { eventType: "email_bounced", direction: "outbound", summary: "Email bounced — the address did not accept it." };
    case "email.complained":
      return { eventType: "email_complained", direction: "inbound", summary: "Recipient marked the email as spam." };
    default:
      return null;
  }
}

/**
 * The dispatch status a provider event advances the row to, or null to leave it
 * alone. Forward-only: `sent → delivered` and `sent → failed` (bounce); opens
 * and clicks never touch dispatch state.
 */
export function dispatchStatusForResendEvent(type: ResendEventType): "delivered" | "failed" | null {
  if (type === "email.delivered") return "delivered";
  if (type === "email.bounced") return "failed";
  return null;
}

/**
 * Whether a provider event must add the recipient to the suppression register,
 * and under which reason.
 *
 * Until BSR-482 this returned nothing at all, because it did not exist: a spam
 * complaint recorded an engagement row and changed nothing else, so the same
 * address was mailed again by the next campaign. A complaint is the single
 * strongest deliverability signal there is — a handful of them is what gets a
 * sending domain blocked — and it was the one event we ignored hardest.
 *
 * Bounces suppress only when PERMANENT. A transient bounce is a full mailbox or
 * a greylisting hiccup, and suppressing on it would permanently drop a
 * reachable customer over one bad afternoon.
 */
export function suppressionForResendEvent(
  event: ResendWebhookEvent,
): { reason: "bounce" | "complaint"; detail: string } | null {
  if (event.type === "email.complained") {
    return { reason: "complaint", detail: "Recipient marked an email as spam (Resend webhook)." };
  }
  if (event.type === "email.bounced" && isPermanentBounce(event.bounceType)) {
    return {
      reason: "bounce",
      detail: `Permanent bounce reported by Resend${event.bounceType ? ` (${event.bounceType})` : ""}.`,
    };
  }
  return null;
}

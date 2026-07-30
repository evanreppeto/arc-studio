import { reasonIfUnavailable, unavailable } from "@/lib/observability/unavailable";
import { buildOutboxKpis } from "@/lib/dispatch/kpis";
import { getOutboxList } from "@/lib/dispatch/read-model";
import { type DispatchStatus, type DispatchView } from "@/lib/dispatch/status";
import { getEmailConnection } from "@/lib/connections/read-model";

import {
  OutboxBoard,
  type KpiVM,
  type OutboxCardVM,
  type OutboxChannel,
  type OutboxGroups,
} from "./_components/outbox-board";

export const metadata = { title: "Outbox — Arc Studio" };

function normChannel(channel: string): OutboxChannel {
  const c = (channel || "").toLowerCase();
  if (/sms|text/.test(c)) return "sms";
  if (/social|meta|instagram|facebook|linkedin|paid|ad\b/.test(c)) return "social";
  if (/email|mail/.test(c)) return "email";
  return "other";
}

const ACTION: Partial<Record<DispatchStatus, string>> = {
  queued: "Confirm send",
  scheduled: "Send now",
  sent: "Mark delivered",
  failed: "Retry",
};

// Where each operator action moves the dispatch. `queued`/`scheduled` are real
// sends (the operator confirms; executeResendDispatch delivers and flips the row
// to `sent`); the rest are after-the-fact lifecycle marks. `actionTo` is the
// target state either way.
const ACTION_TARGET: Partial<Record<DispatchStatus, DispatchStatus>> = {
  queued: "sent",
  scheduled: "sent",
  sent: "delivered",
  failed: "queued",
};

// Statuses whose operator action performs a real outbound send (a human confirm),
// not just a lifecycle status stamp.
const SEND_ACTIONS: ReadonlySet<DispatchStatus> = new Set<DispatchStatus>(["queued", "scheduled"]);

// A queued or scheduled send can still be pulled back before it leaves —
// transitioning it to `canceled` (a real, backed lifecycle move).
const CANCELABLE: ReadonlySet<DispatchStatus> = new Set<DispatchStatus>(["queued", "scheduled"]);

function noteTone(status: DispatchStatus): OutboxCardVM["noteTone"] {
  if (status === "failed") return "red";
  if (status === "sent" || status === "scheduled") return "warn";
  return "";
}

function toOutboxCard(d: DispatchView, sender: string | null): OutboxCardVM {
  const recipients = typeof d.audienceCount === "number" ? d.audienceCount.toLocaleString() : null;
  const when = d.dispatchedAt || d.scheduledFor;
  const meta = [recipients ? `${recipients} recipients` : null, when].filter(Boolean).join(" · ") || null;
  return {
    id: d.id,
    status: d.status,
    channel: normChannel(d.channel),
    title: d.deliverable,
    campaign: d.campaignName,
    recipient: d.preview?.to || d.recipientSummary,
    sender,
    subject: d.preview?.subject || d.deliverable,
    bodyPreview: d.preview?.text ?? null,
    sendTiming: d.scheduledFor || (d.status === "queued" ? "Send immediately after confirmation" : null),
    note: d.resultNote,
    noteTone: noteTone(d.status),
    href: d.campaignId ? `/campaigns/${d.campaignId}` : "/campaigns",
    meta,
    action: ACTION[d.status] ?? null,
    actionTo: ACTION_TARGET[d.status] ?? null,
    actionKind: SEND_ACTIONS.has(d.status) ? "send" : "transition",
    canCancel: CANCELABLE.has(d.status),
  };
}

export default async function OutboxPage() {
  const [outbox, emailConnection] = await Promise.all([
    getOutboxList().catch(unavailable("outbox.list")),
    // Correctly silent (BSR-546): the queue is the page. Without the email
    // connection the send controls disable and SAY they are unavailable, which
    // is the honest degraded state rather than a hidden one.
    getEmailConnection().catch(() => null),
  ]);
  const sender = emailConnection?.fromEmail || process.env.RESEND_FROM || null;
  // A failed read is NOT an empty send queue — the more dangerous direction
  // here, since "nothing waiting to send" reads as reassuring.
  const loadError = reasonIfUnavailable(outbox);
  const dispatches = outbox.status === "live" ? outbox.dispatches.map((dispatch) => toOutboxCard(dispatch, sender)) : [];

  // Priority-ordered send queue rather than one lane per lifecycle status: the
  // thing that needs a human (queued → confirmation) leads; scheduled sits next;
  // recent activity and failures follow. Each is channel-filterable client-side.
  const groups: OutboxGroups = {
    needsYou: dispatches.filter((d) => d.status === "queued"),
    scheduled: dispatches.filter((d) => d.status === "scheduled"),
    recent: dispatches.filter((d) => d.status === "sent" || d.status === "delivered"),
    failed: dispatches.filter((d) => d.status === "failed"),
  };

  const channelCounts = dispatches.reduce<Record<string, number>>((acc, c) => {
    acc[c.channel] = (acc[c.channel] ?? 0) + 1;
    return acc;
  }, {});

  // Tiles: value counts dispatches, reach goes in the sub. See lib/dispatch/kpis.
  const kpis: KpiVM[] = buildOutboxKpis(outbox.status === "live" ? outbox.dispatches : []);

  return <OutboxBoard loadError={loadError} groups={groups} kpis={kpis} channelCounts={channelCounts} />;
}

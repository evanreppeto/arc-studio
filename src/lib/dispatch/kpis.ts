import { WORK_STATE_LABEL } from "@/domain";

import { type DispatchStatus, type DispatchView } from "./status";

/**
 * The Outbox's four summary tiles.
 *
 * One rule, because this is the send surface and a mislabelled unit here is a
 * question about what just went out: **the value counts dispatches; reach lives in
 * the sub.**
 *
 * "Sent" used to break it — its value read a recipient sum while its sub said
 * "recorded dispatches", so prod showed `4,384 / recorded dispatches` for 2
 * dispatches to 4,384 people. Three tiles counted dispatches, one counted people,
 * and the odd one named itself after the unit it wasn't using. Against a 200-lead
 * CRM, "4,384 dispatches" is alarming rather than merely wrong.
 */

export type OutboxKpi = { value: string; label: string; sub: string; alert: boolean };

const recipients = (rows: DispatchView[], statuses: DispatchStatus[]): number =>
  rows.filter((d) => statuses.includes(d.status)).reduce((n, d) => n + (d.audienceCount ?? 0), 0);

const dispatches = (rows: DispatchView[], statuses: DispatchStatus[]): number =>
  rows.filter((d) => statuses.includes(d.status)).length;

/** Reach for a sub-line, or a plain-English absence — never a bare "0 recipients". */
const reachSub = (n: number, empty: string): string => (n > 0 ? `${n.toLocaleString()} recipients` : empty);

export function buildOutboxKpis(rows: DispatchView[]): OutboxKpi[] {
  const queued = dispatches(rows, ["queued"]);
  const failed = dispatches(rows, ["failed"]);
  return [
    {
      value: `${queued}`,
      // Was "Awaiting your confirm" — `confirm` used as a noun, and a fourth
      // wording for the state Home and Campaigns both call "Needs you" (BSR-656).
      label: WORK_STATE_LABEL.needs_you,
      sub: reachSub(recipients(rows, ["queued"]), "in the send queue"),
      // The only tile that should ever shout: it is the one with a human decision
      // still outstanding.
      alert: queued > 0,
    },
    {
      value: `${dispatches(rows, ["scheduled"])}`,
      label: "Scheduled",
      sub: dispatches(rows, ["scheduled"]) ? "in the send window" : "none scheduled",
      alert: false,
    },
    {
      // sent + delivered: everything that actually left, delivered included.
      value: `${dispatches(rows, ["sent", "delivered"])}`,
      label: "Sent",
      sub: reachSub(recipients(rows, ["sent", "delivered"]), "nothing sent yet"),
      alert: false,
    },
    {
      value: `${dispatches(rows, ["delivered"])}`,
      label: "Delivered",
      sub: failed ? `${failed} failed` : "no failures",
      alert: failed > 0,
    },
  ];
}

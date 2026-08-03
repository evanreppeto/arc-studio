"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { WORK_STATE_LABEL } from "@/domain";
import { type DispatchStatus } from "@/lib/dispatch/status";

import { sendDispatchAction, transitionDispatchAction } from "../actions";

export type OutboxChannel = "email" | "sms" | "social" | "other";

export type OutboxCardVM = {
  id: string;
  status: DispatchStatus;
  channel: OutboxChannel;
  title: string;
  campaign: string;
  recipient: string | null;
  sender: string | null;
  subject: string | null;
  bodyPreview: string | null;
  sendTiming: string | null;
  note: string | null;
  noteTone: "" | "warn" | "red";
  href: string;
  meta: string | null;
  action: string | null;
  actionTo: DispatchStatus | null;
  // "send" performs a real outbound send (human confirm); "transition" is a
  // lifecycle status mark.
  actionKind: "send" | "transition";
  // Queued/scheduled sends can be pulled back before they leave.
  canCancel: boolean;
};

// The priority-ordered send queue: what needs a human leads, then upcoming,
// recent, and failures. Empty non-hero groups simply don't render.
export type OutboxGroups = {
  needsYou: OutboxCardVM[];
  scheduled: OutboxCardVM[];
  recent: OutboxCardVM[];
  failed: OutboxCardVM[];
};

export type KpiVM = { value: string; label: string; sub: string; alert: boolean };

const CH_ICON: Record<OutboxChannel, React.ReactNode> = {
  email: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M4 7l8 6 8-6" /></svg>,
  sms: <svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-4 3z" /></svg>,
  social: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" /></svg>,
  other: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M4 7l8 6 8-6" /></svg>,
};

const CHANNELS: { key: string; label: string }[] = [
  { key: "all", label: "All channels" },
  { key: "email", label: "Email" },
  { key: "sms", label: "SMS" },
  { key: "social", label: "Social" },
];

export function OutboxBoard({
  loadError = null,
  groups,
  kpis,
  channelCounts,
}: {
  /** Why the read FAILED, vs returning nothing. Null when it succeeded. */
  loadError?: string | null;
  groups: OutboxGroups;
  kpis: KpiVM[];
  channelCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  // A real send is a two-step confirm: the first click arms this, the second sends.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const [, startTransition] = useTransition();

  function run(card: OutboxCardVM, kind: "send" | "transition", to: DispatchStatus | null) {
    if (busyId) return;
    if (kind === "transition" && !to) return;
    setBusyId(card.id);
    setFailed(null);
    startTransition(async () => {
      const res = kind === "send" ? await sendDispatchAction(card.id) : await transitionDispatchAction(card.id, to!);
      setBusyId(null);
      setConfirmId(null);
      if (!res.ok) {
        setFailed({ id: card.id, message: res.error });
        return;
      }
      router.refresh();
    });
  }

  const byChannel = (cards: OutboxCardVM[]) => (channel === "all" ? cards : cards.filter((c) => c.channel === channel));
  const view = useMemo(
    () => ({
      needsYou: byChannel(groups.needsYou),
      scheduled: byChannel(groups.scheduled),
      recent: byChannel(groups.recent),
      failed: byChannel(groups.failed),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, channel],
  );

  // Plain render helpers (no hooks) rather than nested components, so they close
  // over the send/cancel state without being re-created as components each render.
  const renderCard = (card: OutboxCardVM) => {
    const delivered = card.status === "delivered";
    const senderMissing = card.channel === "email" && !card.sender;
    return (
      <div className={`card${card.status === "failed" ? " is-failed" : ""}`} key={card.id}>
        <a className="clink" href={card.href}>
          <div className="crow">
            <span className={`chip-ch ch-${card.channel}`}>{CH_ICON[card.channel]}</span>
            <div style={{ minWidth: 0 }}>
              <div className="cdel">{card.title}</div>
              <div className="ccamp">{card.campaign}</div>
            </div>
            {delivered && (
              <span className="cbadge ok" aria-label="Delivered">
                <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>
              </span>
            )}
          </div>
          {card.meta && <div className="cmeta">{card.meta}</div>}
          {card.recipient && <div className="caudience"><span>To</span>{card.recipient}</div>}
          {card.note && <div className={`cnote${card.noteTone ? ` ${card.noteTone}` : ""}`}>{card.note}</div>}
        </a>
        {failed?.id === card.id && <div className="cnote red">{failed.message}</div>}
        {card.actionKind === "send" && confirmId === card.id ? (
          <div className="caconfirm">
            <div className="send-preview" role="group" aria-label={`Review ${card.title} before sending`}>
              <dl>
                <div><dt>From</dt><dd className={card.sender ? "" : "missing"}>{card.sender || "Sender not configured"}</dd></div>
                <div><dt>To</dt><dd>{card.recipient || "Audience resolves in the channel connector"}</dd></div>
                {card.channel === "email" && <div><dt>Subject</dt><dd>{card.subject || card.title}</dd></div>}
                <div><dt>When</dt><dd>{card.sendTiming || "Immediately after confirmation"}</dd></div>
              </dl>
              {card.bodyPreview ? <p>{card.bodyPreview}</p> : <p className="missing">Open the campaign to review the full approved content.</p>}
              <Link href={card.href}>Open approved campaign content →</Link>
            </div>
            <span className="cctext">Send this {card.channel === "sms" ? "text" : "email"} for real — there’s no undo.</span>
            <div className="ccbtns">
              <button type="button" className="cccancel" onClick={() => setConfirmId(null)} disabled={busyId !== null}>
                Keep in queue
              </button>
              <button type="button" className="caction danger" onClick={() => run(card, "send", card.actionTo)} disabled={busyId !== null || senderMissing}>
                {busyId === card.id ? "Sending…" : senderMissing ? "Configure sender first" : "Send for real"}
              </button>
            </div>
          </div>
        ) : (
          (card.action || card.canCancel) && (
            <div className="cactions">
              {card.canCancel && (
                <button
                  type="button"
                  className="ccancel"
                  onClick={() => run(card, "transition", "canceled")}
                  disabled={busyId !== null}
                >
                  {busyId === card.id ? "…" : "Cancel"}
                </button>
              )}
              {card.action && card.actionTo && (
                <button
                  type="button"
                  className={`caction${card.actionKind === "transition" ? " ghost" : ""}`}
                  onClick={() => (card.actionKind === "send" ? setConfirmId(card.id) : run(card, "transition", card.actionTo))}
                  disabled={busyId !== null}
                >
                  {busyId === card.id ? "Working…" : card.action}
                </button>
              )}
            </div>
          )
        )}
      </div>
    );
  };

  const renderSection = (label: string, cards: OutboxCardVM[], tone?: "red") => {
    if (cards.length === 0) return null;
    return (
      <section className={`oq-section${tone ? ` tone-${tone}` : ""}`} key={label}>
        <div className="oq-head">
          <span className="oq-label">{label}</span>
          <span className="oq-count">{cards.length}</span>
        </div>
        <div className="oq-cards">{cards.map(renderCard)}</div>
      </section>
    );
  };

  return (
    <div className="arc-outbox">
      {/* A failed read is NOT an empty result. Rendering them the same is how a
          live outage hid behind a normal-looking page (BSR-542). */}
      {loadError && (
        <div className="crm-error" role="alert" style={{ marginBottom: 16 }}>
          <span>
            <b>Couldn&rsquo;t load the send queue.</b> An empty queue here would mean nothing is waiting to send — don&rsquo;t read it that way until this clears.
            <div style={{ marginTop: 6, opacity: 0.75, fontFamily: "var(--mono, monospace)", fontSize: "0.85em" }}>{loadError}</div>
          </span>
        </div>
      )}
      <div className="ohead">
        <div className="otitle">
          <div>
            <h2 className="pt">Outbox</h2>
            <div className="psub">Review approved sends, then confirm exactly what goes out.</div>
          </div>
          <div style={{ display: "flex", gap: 9 }}>
            <button type="button" className="gbtn" onClick={() => router.refresh()}>
              <svg viewBox="0 0 24 24"><path d="M4 4v6h6M20 20v-6h-6" /><path d="M20 10a8 8 0 00-14-3M4 14a8 8 0 0014 3" /></svg>
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="okpis">
        {kpis.map((k, i) => (
          <div className={`kpi${k.alert ? " alert" : ""}`} key={i}>
            <div className="kv">{k.value}</div>
            <div className="kl">{k.label}</div>
            <div className="ks">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="tabbar">
        <div className="ofilters">
          {CHANNELS.map((c) => (
            <button key={c.key} type="button" className={`fchip${channel === c.key ? " on" : ""}`} onClick={() => setChannel(c.key)}>
              {c.label}
              {c.key !== "all" && <span className="fct">{channelCounts[c.key] ?? 0}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="oq">
        <section className="oq-section oq-hero">
          <div className="oq-head">
            <span className="oq-label">{WORK_STATE_LABEL.needs_you}</span>
            <span className="oq-count">{view.needsYou.length}</span>
          </div>
          {view.needsYou.length === 0 ? (
            <div className="oq-empty">
              <span className="oq-empty-ic"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg></span>
              <div>
                <b>You’re all caught up.</b>
                <span>Nothing is waiting for your confirmation. Approved sends will queue here.</span>
              </div>
            </div>
          ) : (
            <div className="oq-cards">{view.needsYou.map(renderCard)}</div>
          )}
        </section>

        {renderSection("Scheduled", view.scheduled)}
        {renderSection("Recently sent", view.recent)}
        {renderSection("Failed — needs attention", view.failed, "red")}
      </div>
    </div>
  );
}

"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  askArcToDraftFromOpportunityAction,
  dismissOpportunityAction,
  draftCampaignFromOpportunityAction,
  scanForOpportunitiesAction,
  snoozeOpportunityAction,
} from "../actions";
import { scanMessage } from "../scan-feedback";
import type { ScanStatusLine } from "../scan-status-copy";
import { DraftCampaignModal, type DraftMode } from "./draft-campaign-modal";
import { definitionText, DEFINITIONS, DISMISS_REASON_OPTIONS, type DismissReason } from "@/domain";
import { Define, HowThisWorks } from "../../_components/define";

/** `hint` carries the definition for a coined label (BSR-659). */
export type OppSignal = { label: string; value: string; hint?: string };
export type OppRouting = { step: string; note: string; done: boolean };

export type OpportunityVM = {
  id: string;
  name: string;
  /**
   * The distinguishing tail of the title — "Cook, IL / DuPage, IL +1 more" — when
   * `name` alone would not tell two cards apart. Null when a more specific field
   * (staleness) already carries it.
   */
  qualifier: string | null;
  title: string;
  confidence: number;
  urgencyTone: "red" | "amber" | "info";
  urgencyLabel: string;
  typeLabel: string;
  icon: "weather" | "comp" | "clock" | "user" | "repeat" | "news";
  sourceLabel: string;
  /**
   * How stale the subject is, e.g. "quiet 32d" — null when the signal isn't
   * inactivity-based. The list truncates long titles, so a named card's
   * "— quiet 32 days" tail falls off the end; staleness is the whole reason a
   * cold-lead card exists, so the row carries it as its own field rather than
   * hoping it survives the ellipsis.
   */
  staleLabel: string | null;
  summary: string;
  recommendedAction: string;
  persona: string;
  personaHref: string | null;
  recordHref: string | null;
  recordLabel: string | null;
  audienceNote: string;
  campaignTypes: string[];
  evidence: OppSignal[];
  routing: OppRouting[];
  /** Lifecycle: "pending" | "drafting" | "drafted" (open states the inbox lists). */
  status: string;
  /** Chip label when Arc has begun/finished drafting; null while pending. */
  statusLabel: string | null;
  /** Link to the linked campaign draft once one exists; null otherwise. */
  campaignHref: string | null;
  /** Pre-filled draft fields for the "Create campaign" confirm modal. */
  seed: { name: string; persona: string; campaignTheme: string };
};

const ICONS: Record<OpportunityVM["icon"], React.ReactNode> = {
  weather: (
    <svg viewBox="0 0 24 24"><path d="M6 14a4 4 0 010-8 5 5 0 019.6-1A4 4 0 0118 14z" /><path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2" /></svg>
  ),
  comp: <svg viewBox="0 0 24 24"><path d="M3 11l14-6v14L3 13z" /><path d="M7 13v4a2 2 0 004 0" /></svg>,
  clock: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>,
  user: <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.4" /><path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6" /></svg>,
  repeat: <svg viewBox="0 0 24 24"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" /></svg>,
  news: <svg viewBox="0 0 24 24"><path d="M4 5h13v14H4z" /><path d="M17 8h3v9a2 2 0 01-2 2h-1" /><path d="M7 8h7M7 11h7M7 14h5" /></svg>,
};

function ConfidenceFill({ pct }: { pct: number }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  return (
    <div className="ctrack">
      <div className="cfill" style={{ width: `${w}%` }} />
    </div>
  );
}

const scanBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "7px",
  height: "30px",
  padding: "0 12px",
  borderRadius: "8px",
  border: "1px solid var(--accent-border)",
  background: "var(--accent-soft)",
  color: "var(--accent-contrast)",
  fontSize: "11.5px",
  fontWeight: 600,
  cursor: "pointer",
};

// Runs cold-lead detection over the workspace CRM and refreshes the inbox with
// any new source-backed opportunities. Read-only — surfaces signals, drafts nothing.
function ScanButton({ subtle }: { subtle?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{ ...scanBtnStyle, opacity: pending ? 0.6 : 1, ...(subtle ? { height: "34px" } : {}) }}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4-4" />
      </svg>
      {pending ? "Scanning CRM…" : "Scan for opportunities"}
    </button>
  );
}

/**
 * What Arc's own background scan last did.
 *
 * Arc has scanned this workspace daily since 2026-08-01 and the product never
 * said so — the inbox offered a manual scan button and nothing else, so work
 * Arc did on its own read as work nobody did. Worse, every outcome looked
 * identical: on 2026-08-04 a scan ran, proposed nothing, failed to mark itself
 * complete, and the screen was indistinguishable from a healthy quiet day.
 */
function ScanStatus({ status }: { status?: ScanStatusLine | null }) {
  if (!status) return null;
  return (
    <div className={`scanstat ${status.tone}`} role="status">
      <span className="l">
        <i />
        {status.text}
      </span>
      {status.detail && <span className="d">{status.detail}</span>}
    </div>
  );
}

/** The scan form + its result line. Self-contained so both call sites report alike. */
function ScanForm({ subtle, status }: { subtle?: boolean; status?: ScanStatusLine | null }) {
  const [result, formAction] = useActionState(scanForOpportunitiesAction, null);
  return (
    <>
      <form action={formAction}>
        <ScanButton subtle={subtle} />
      </form>
      {/* The manual scan's own result supersedes the background one — it is
          newer, and it is what the operator just asked for. */}
      {result ? (
        <div className={`scanmsg${result.ok ? "" : " bad"}`} role="status">
          {scanMessage(result)}
        </div>
      ) : (
        <ScanStatus status={status} />
      )}
    </>
  );
}

/** Urgency ordering for the priority sort — high first, then medium, then low. */
const URGENCY_RANK: Record<OpportunityVM["urgencyTone"], number> = { red: 0, amber: 1, info: 2 };

type SortKey = "priority" | "newest";

/**
 * Rows rendered before the list offers "Show all". A busy workspace's detectors
 * produce hundreds of signals — mostly one high-volume kind — and an unbounded
 * list buries the rare, valuable ones (a weather alert, a competitor move) under
 * a wall of routine inactivity cards. The cap plus the type filters below are
 * what make the queue scannable; nothing is hidden that a click can't reach.
 */
const INITIAL_ROWS = 25;

export function OpportunityInbox({
  opps,
  personaOptions,
  selectedId,
  scanStatus,
}: {
  opps: OpportunityVM[];
  /** The org's own personas for the draft-campaign picker. */
  personaOptions?: { key: string; label: string }[];
  /** Opportunity selected by a contextual deep link from Home or Arc. */
  selectedId?: string;
  /** What Arc's last background scan did — null when there is no history. */
  scanStatus?: ScanStatusLine | null;
}) {
  // Selection is held by id, not list index: filtering, sorting and triage all
  // reorder the list, and an index would silently point at a different card.
  const [curId, setCurId] = useState<string | null>(selectedId ?? null);
  const [sort, setSort] = useState<SortKey>("priority");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [mode, setMode] = useState<DraftMode>("operator");
  const [notice, setNotice] = useState<string | null>(null);
  // Opportunities triaged away this session (dismissed/snoozed) — hidden
  // optimistically so the card leaves the inbox instantly, before the refetch.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const triageRef = useRef<HTMLDivElement>(null);

  /**
   * Close the triage menus on an outside click or Escape.
   *
   * This replaced a pair of click-catching scrim overlays. A scrim div is
   * invisible to a keyboard: there is no way to tab to it and Escape did
   * nothing, so a keyboard user who opened a menu was stuck with it open —
   * BSR-664's ratchet caught the second one being added here, which is the
   * ratchet working. Listening on the document covers both pointer and
   * keyboard, and matches what `FilterMenu`/`SortMenu` in crm-board.tsx do.
   *
   * (Prose here deliberately avoids naming the old markup literally: this
   * guard greps raw source and does not strip comments, unlike its sibling in
   * plumbing-vocabulary.test.ts, so a comment quoting a tag trips it.)
   */
  useEffect(() => {
    if (!snoozeOpen && !dismissOpen) return;
    const close = () => { setSnoozeOpen(false); setDismissOpen(false); };
    function onDown(e: MouseEvent) {
      if (triageRef.current && !triageRef.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [snoozeOpen, dismissOpen]);
  const [triaging, setTriaging] = useState(false);
  const router = useRouter();

  const visible = opps.filter((op) => !removed.has(op.id));

  // Type counts come from everything still open, not the current filter, so the
  // chips keep showing what else is in the queue while one type is selected.
  const typeCounts = new Map<string, number>();
  for (const op of visible) typeCounts.set(op.typeLabel, (typeCounts.get(op.typeLabel) ?? 0) + 1);
  const types = [...typeCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const filtered = typeFilter ? visible.filter((op) => op.typeLabel === typeFilter) : visible;
  // `opps` arrives newest-first from the server, and sort is stable, so "newest"
  // is the incoming order and the priority sort breaks ties by recency.
  const ordered =
    sort === "newest"
      ? filtered
      : [...filtered].sort(
          (a, b) => URGENCY_RANK[a.urgencyTone] - URGENCY_RANK[b.urgencyTone] || b.confidence - a.confidence,
        );

  // A new workspace lands here first, and the two-pane layout carries no page
  // title of its own — so the empty state was a floating sentence on a blank
  // screen. Name the page the way every other one does.
  if (visible.length === 0) {
    return (
      <div className="arc-opps" style={{ display: "block" }}>
        <div className="oempty">
          <h2 className="pt">Opportunities</h2>
          <div className="psub">
            No open opportunities yet. Arc scans your CRM for source-backed signals — quiet leads worth re-engaging,
            and more.
          </div>
          <ScanForm subtle status={scanStatus} />
        </div>
      </div>
    );
  }

  // The focused card, resolved by id against the current ordering. Falls back to
  // the head of the list when the selection has been filtered or triaged away.
  const o = ordered.find((op) => op.id === curId) ?? ordered[0] ?? visible[0];

  // Rows the list actually renders. The focused card is always among them, so a
  // deep link (or a selection made before collapsing) never highlights nothing.
  const capped = expanded ? ordered : ordered.slice(0, INITIAL_ROWS);
  const shown = capped.some((op) => op.id === o.id) ? capped : [o, ...capped];
  const hiddenCount = ordered.length - capped.length;

  // Triage the focused opportunity out of the inbox. Optimistic: advance to the
  // next card and hide this one now, then persist + refetch. On failure, restore
  // it and surface the error. Never sends or contacts anything.
  const triage = (kind: "dismiss" | "snooze", days?: number, reason?: DismissReason) => {
    if (triaging) return;
    const id = o.id;
    const at = ordered.findIndex((op) => op.id === id);
    setCurId(ordered[at + 1]?.id ?? ordered[at - 1]?.id ?? null);
    setTriaging(true);
    setSnoozeOpen(false);
    setDismissOpen(false);
    setNotice(null);
    setRemoved((prev) => new Set(prev).add(id));
    (kind === "dismiss" ? dismissOpportunityAction(id, reason ?? null) : snoozeOpportunityAction(id, days ?? 7)).then((res) => {
      setTriaging(false);
      if (!res.ok) {
        setRemoved((prev) => { const next = new Set(prev); next.delete(id); return next; });
        setCurId(id);
        setNotice(res.error);
        return;
      }
      if (res.persisted) router.refresh();
    });
  };

  // Convert this opportunity into an approval-gated campaign draft. When it
  // persists, jump into the new draft's detail page; offline it confirms the
  // draft was prepared without claiming a save. Failures surface in the modal.
  const handleDraft = async (
    value: { name: string; persona: string; campaignTheme: string },
  ): Promise<{ ok: boolean; error?: string }> => {
    setNotice(null);
    const action = mode === "arc" ? askArcToDraftFromOpportunityAction : draftCampaignFromOpportunityAction;
    const res = await action({ opportunityId: o.id, ...value });
    if (!res.ok) return { ok: false, error: res.error };
    if (res.persisted && res.href) {
      router.push(res.href);
      return { ok: true };
    }
    setNotice(
      mode === "arc"
        ? "Arc drafted the package. Connect a workspace to save and open it — nothing was sent."
        : "Draft prepared. Connect a workspace to save and open it — nothing was sent.",
    );
    return { ok: true };
  };

  // Real header stats for the inbox — how many need fast action and the average
  // confidence of the queue, from the opportunities already loaded.
  const highCount = visible.filter((o) => o.urgencyTone === "red").length;
  const avgConf = visible.length ? Math.round(visible.reduce((s, o) => s + o.confidence, 0) / visible.length) : 0;

  return (
    <div className="arc-opps">
      <aside className="olist">
        <div className="olisthd">
          <span className="h">OPEN OPPORTUNITIES</span>
          <span className="c">
            {typeFilter
              ? `${ordered.length} of ${visible.length}`
              : `${visible.length} open${highCount > 0 ? ` · ${highCount} high` : ""} · ${avgConf}% avg confidence`}
          </span>
        </div>
        <div style={{ padding: "2px 4px 12px" }}>
          <ScanForm status={scanStatus} />
        </div>

        {types.length > 1 && (
          <div className="ofilter" role="group" aria-label="Filter by signal type">
            <button
              type="button"
              className={`ochip${typeFilter === null ? " on" : ""}`}
              aria-pressed={typeFilter === null}
              onClick={() => setTypeFilter(null)}
            >
              All <span className="n">{visible.length}</span>
            </button>
            {types.map(([label, count]) => (
              <button
                key={label}
                type="button"
                className={`ochip${typeFilter === label ? " on" : ""}`}
                aria-pressed={typeFilter === label}
                onClick={() => setTypeFilter(typeFilter === label ? null : label)}
              >
                {label} <span className="n">{count}</span>
              </button>
            ))}
          </div>
        )}

        <div className="osort">
          <span className="l">Sort</span>
          <button
            type="button"
            className={`osortb${sort === "priority" ? " on" : ""}`}
            aria-pressed={sort === "priority"}
            onClick={() => setSort("priority")}
          >
            Priority
          </button>
          <button
            type="button"
            className={`osortb${sort === "newest" ? " on" : ""}`}
            aria-pressed={sort === "newest"}
            onClick={() => setSort("newest")}
          >
            Newest
          </button>
        </div>

        <div>
          {shown.map((it) => (
            <button
              key={it.id}
              type="button"
              className={`orow${it.id === o.id ? " on" : ""}`}
              onClick={() => {
                setCurId(it.id);
                setNotice(null);
              }}
            >
              <span className="ic">{ICONS[it.icon]}</span>
              <div style={{ minWidth: 0 }}>
                <div className="ot">
                  <span className="nm">{it.name}</span>
                  <span className="pct" title={`Confidence — ${definitionText("confidence")}`}>{it.confidence}%</span>
                </div>
                {it.qualifier && <div className="oq">{it.qualifier}</div>}
                <div className="om">
                  <span className="src">{it.sourceLabel}</span>
                  {it.staleLabel && <span className="stale">{it.staleLabel}</span>}
                  {it.statusLabel && <span className="ostat">{it.statusLabel}</span>}
                </div>
              </div>
            </button>
          ))}
          {hiddenCount > 0 && (
            <button type="button" className="omore" onClick={() => setExpanded(true)}>
              Show {hiddenCount} more
            </button>
          )}
        </div>
      </aside>

      <section className="odetail">
        <div className="inner fade" key={o.id}>
          <div className="metarow">
            <span className="tchip"><i />{o.typeLabel}</span>
            <span className={`upill ${o.urgencyTone}`} title={definitionText("urgency")}>{o.urgencyLabel} urgency</span>
            {o.statusLabel && <span className="sstat">{o.statusLabel}</span>}
            <span className="det">Found by Arc</span>
          </div>
          <h2 className="dttl">{o.title}</h2>

          <div className="opp-quick-actions" aria-label="Opportunity actions">
            {o.campaignHref ? (
              <Link className="btn gold" href={o.campaignHref}>Open campaign →</Link>
            ) : o.status === "drafting" ? (
              <button type="button" className="btn gold" disabled aria-disabled="true">
                Drafting…
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn gold"
                  onClick={() => {
                    setMode("arc");
                    setDraftOpen(true);
                  }}
                >
                  Draft with Arc
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  title="Creates an empty campaign from this opportunity for you to write yourself"
                  onClick={() => {
                    setMode("operator");
                    setDraftOpen(true);
                  }}
                >
                  Start one myself
                </button>
              </>
            )}
            {o.recordHref && <Link className="btn ghost" href={o.recordHref}>{o.recordLabel} →</Link>}
          </div>
          {notice && (
            <div className="opp-notice" role="status">
              <i />
              {notice}
            </div>
          )}

          <div className="dgrid">
            <div className="mainc">
              <div className="lab">Why Arc flagged this</div>
              <p className="summary">{o.summary}</p>

              {o.evidence.length > 0 && (
                <div className="blk">
                  <div className="lab">What Arc saw</div>
                  {/* A definition list, not numbered cards. These are parallel
                      facts, and the numbers claimed an order they never had —
                      while the card treatment gave each one a pointer cursor and
                      a hover nudge for a row that has never been clickable. */}
                  <dl className="evlist">
                    {o.evidence.map((e, i) => (
                      <div className="evitem" key={i}>
                        <dt title={e.hint}>{e.label}</dt>
                        <dd>{e.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              <div className="blk recpanel">
                <div className="rl">Recommended action</div>
                <div className="rtxt">{o.recommendedAction}</div>
                {o.campaignTypes.length > 0 && (
                  <>
                    <div className="sub">Suggested campaign type</div>
                    <div className="types">
                      {o.campaignTypes.map((t) => (
                        <span className="ty" key={t}>{t}</span>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {o.status !== "drafting" && (
                <div className="triage" ref={triageRef}>
                  <span className="triage-q">Not relevant right now?</span>
                  {/* Dismiss opens a reason picker rather than firing straight
                      away (BSR-686). Every item completes the dismissal in one
                      tap — the reason is the tap, not an extra step — and
                      "Just dismiss" keeps the no-reason path one tap deeper
                      rather than removing it. */}
                  <div className="triage-snooze">
                    <button
                      type="button"
                      className="triage-btn"
                      aria-haspopup="menu"
                      aria-expanded={dismissOpen}
                      onClick={() => { setDismissOpen((v) => !v); setSnoozeOpen(false); }}
                      disabled={triaging}
                    >
                      Dismiss ▾
                    </button>
                    {dismissOpen && (
                      <>
                        <div className="triage-menu triage-menu-wide" role="menu" aria-label="Dismiss because">
                          {DISMISS_REASON_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              role="menuitem"
                              onClick={() => triage("dismiss", undefined, opt.value)}
                            >
                              {opt.label}
                            </button>
                          ))}
                          <button type="button" role="menuitem" className="triage-menu-plain" onClick={() => triage("dismiss")}>
                            Just dismiss
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="triage-snooze">
                    <button
                      type="button"
                      className="triage-btn"
                      aria-haspopup="menu"
                      aria-expanded={snoozeOpen}
                      onClick={() => { setSnoozeOpen((v) => !v); setDismissOpen(false); }}
                      disabled={triaging}
                    >
                      Snooze ▾
                    </button>
                    {snoozeOpen && (
                      <>
                        <div className="triage-menu" role="menu" aria-label="Snooze for">
                          <button type="button" role="menuitem" onClick={() => triage("snooze", 1)}>1 day</button>
                          <button type="button" role="menuitem" onClick={() => triage("snooze", 3)}>3 days</button>
                          <button type="button" role="menuitem" onClick={() => triage("snooze", 7)}>1 week</button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="side">
              <div className="card">
                <div className="cl">Confidence<Define term="confidence" /></div>
                <div className="bignum">{o.confidence}%</div>
                <ConfidenceFill pct={o.confidence} />
                <div className="cnote">{DEFINITIONS.confidence.basedOn}</div>
              </div>

              {(o.persona || o.audienceNote) && (
                <div className="card">
                  <div className="cl">Who it targets</div>
                  {o.persona && (
                    <div className="audrow">
                      {o.personaHref ? (
                        <a className="ac" href={o.personaHref} title="View persona intelligence">{o.persona} ↗</a>
                      ) : (
                        <span className="ac">{o.persona}</span>
                      )}
                    </div>
                  )}
                  {o.audienceNote && <div className="audnote">{o.audienceNote}</div>}
                </div>
              )}

              <div className="card">
                <div className="cl">Who signs off</div>
                <div className="tl">
                  {o.routing.map((s, i) => (
                    <div className={`tlstep${s.done ? " done" : ""}`} key={i}>
                      <div className="ts">{s.step}</div>
                      <div className="tr">{s.note}</div>
                    </div>
                  ))}
                </div>
                <div className="locknote"><i />Nothing sends until you approve</div>
              </div>

              <HowThisWorks>
                <p>
                  Arc watches your records for things worth acting on — someone reading your pricing page again, a customer
                  who has gone quiet, a review worth asking for — and lists them here with the evidence it used.
                </p>
                <p>
                  <b>Confidence</b> is how sure Arc is that this is real. {DEFINITIONS.confidence.basedOn} Nothing here
                  contacts anyone: Arc can draft from an opportunity, but it waits for you.
                </p>
              </HowThisWorks>
            </div>
          </div>
        </div>
      </section>

      <DraftCampaignModal
        key={`${o.id}-${mode}-${draftOpen ? "open" : "closed"}`}
        open={draftOpen}
        onClose={() => setDraftOpen(false)}
        opp={o}
        mode={mode}
        personaOptions={personaOptions}
        onSubmit={handleDraft}
      />
    </div>
  );
}

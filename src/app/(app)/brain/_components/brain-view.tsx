"use client";

import { definitionText, WORK_STATE_LABEL } from "@/domain";

import { HowThisWorks } from "../../_components/define";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Modal } from "../../_components/modal";
import { archiveBrainNode, correctBrainFact, decideBrainNode, rebuildBrainMemoryAction, searchBrainFacts } from "../actions";
import { KnowledgeGraph, type GraphEdge, type GraphNode } from "./knowledge-graph";
import { KpiStrip } from "../../_components/kpi-strip";

export type FactVM = {
  id: string;
  kind: string;
  kindLabel: string;
  kindColor: string;
  label: string;
  summary: string;
  trustTier: string;
  confidence: number | null;
  source: string;
  learnedAt: string;
};

export type BrainStat = { label: string; value: number; sub: string; color: string };

export type BrainData = {
  stats: BrainStat[];
  coverageNote: string;
  facts: FactVM[];
  /** Whole-brain node total (exact count), so the capped facts page can say
   *  "showing N of TOTAL" instead of implying the page is the whole memory. */
  totalFacts: number;
  review: FactVM[];
  learned: FactVM[];
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
};

const IconResync = <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-6.2-8.6" /><path d="M21 4v5h-5" /></svg>;

// Ordered to lead with what Arc knows + governance; the graph visualization is a
// trust/debug view, so it's demoted to last (see docs — the Brain's value to a
// human is reviewing what Arc learned, not the graph eye-candy).
const TABS = [
  { key: "facts", label: "What Arc knows", icon: <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg> },
  { key: "review", label: WORK_STATE_LABEL.needs_you, icon: <svg viewBox="0 0 24 24"><path d="M9 11l3 3 8-8M4 12v7a1 1 0 001 1h14" /></svg> },
  { key: "learned", label: "Recently learned", icon: <svg viewBox="0 0 24 24"><path d="M12 8v4l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
  { key: "web", label: "Knowledge Web", icon: <svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.4" /><circle cx="18" cy="7" r="2.4" /><circle cx="12" cy="17" r="2.4" /><path d="M8 7l8 1M7.5 8l3.5 7M16.5 9l-3.5 6" /></svg> },
];

function tierClass(t: string): string {
  const s = t.toLowerCase();
  if (s === "trusted" || s === "core" || s === "proposed" || s === "observed") return s;
  return "observed";
}

/**
 * Trust tier as a label. The tier is its own axis — how far Arc trusts a fact —
 * but "proposed" is the same human moment as a draft waiting on you, and the
 * page said it three ways at once: the tile read "Awaiting review", the pill
 * read "proposed", and the tab read "Needs review" (BSR-656). The tier VALUE is
 * untouched; only its wording joins the shared vocabulary.
 */
/** The tier's definition, for the pill's tooltip — "trusted" and "watching" are
 *  invented words carrying a real rule about what Arc may write (BSR-659). */
function tierHint(t: string): string | undefined {
  const s = (t || "").toLowerCase();
  if (s === "trusted" || s === "core") return definitionText("trusted");
  if (s === "observed") return definitionText("watching");
  if (s === "proposed") return "Arc found this but has not been cleared to use it. It stays out of your copy until you approve it.";
  return undefined;
}

function tierLabel(t: string): string {
  const s = (t || "").toLowerCase();
  if (s === "proposed") return WORK_STATE_LABEL.needs_you;
  if (s === "trusted") return "Trusted";
  if (s === "core") return "Core";
  if (s === "observed") return "Watching";
  return t;
}

function Confidence({ value }: { value: number | null }) {
  if (value === null) return <span className="src">—</span>;
  return (
    <span className="conf">
      <span className="cbar"><i style={{ width: `${value}%` }} /></span>
      <span className="cn">{value}%</span>
    </span>
  );
}

export function BrainView({
  data,
  focusNodeId,
  loadErrors = [],
}: {
  data: BrainData;
  focusNodeId?: string | null;
  /** Reads that FAILED, as opposed to returning nothing. Empty means an empty
   *  Brain below is genuinely empty — the distinction this preserves. */
  loadErrors?: string[];
}) {
  const [tab, setTab] = useState("facts");
  const [rebuilding, startRebuild] = useTransition();
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);
  const rebuild = () =>
    startRebuild(async () => {
      setRebuildMsg(null);
      try {
        const r = await rebuildBrainMemoryAction();
        setRebuildMsg(r.message);
      } catch {
        // A timeout or transport error must never leave the button stuck on
        // "Refreshing…" — report it and let the operator retry.
        setRebuildMsg("Refresh didn’t complete (it may have timed out). Give it a moment and try again.");
      }
    });
  const [kind, setKind] = useState("all");
  // Client-side paging so a long fact list is clickable pages, not one endless
  // scroll. Reset-to-page-1 effect lives below, once `query` is declared.
  const FACTS_PER_PAGE = 25;
  const [page, setPage] = useState(1);
  // Whole-brain fact search. The loaded `data.facts` is only the 200 most-recently
  // updated nodes, so kind chips alone can't reach an older fact; this queries the
  // full memory server-side. `results === null` means "not searching" (show the
  // default page); a live query replaces the table with its matches.
  const [query, setQuery] = useState("");
  // Any change to the visible set (kind chip or search query) sends the pager back
  // to page 1 so the operator never lands on an empty/stale page. Done as a
  // render-time adjustment (React's "reset state when a value changes" pattern)
  // rather than an effect, which would cascade an extra render.
  const resetKey = `${kind}::${query}`;
  const [pageResetKey, setPageResetKey] = useState(resetKey);
  if (resetKey !== pageResetKey) {
    setPageResetKey(resetKey);
    setPage(1);
  }
  const [results, setResults] = useState<FactVM[] | null>(null);
  const [resultsCapped, setResultsCapped] = useState(false);
  const [searching, setSearching] = useState(false);
  // The review list is interactive (approve/reject the trust gate). Decided nodes
  // drop out immediately; a real write revalidates, offline it stays session-only.
  const [review, setReview] = useState(data.review);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Facts archived this session — hidden optimistically before the refetch.
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Debounced search: a trimmed query re-queries the whole brain ~250ms after the
  // last keystroke; clearing it returns to the default page. The token guards
  // against an earlier, slower response overwriting a newer one.
  const searchToken = useRef(0);
  useEffect(() => {
    const term = query.trim();
    const token = ++searchToken.current;
    const timer = setTimeout(async () => {
      if (token !== searchToken.current) return; // a newer query superseded this one
      if (!term) {
        setResults(null);
        setResultsCapped(false);
        setSearching(false);
        return;
      }
      setSearching(true);
      const res = await searchBrainFacts(term);
      if (token !== searchToken.current) return;
      if (res.ok) {
        setResults(res.facts);
        setResultsCapped(res.capped);
      } else {
        setResults([]);
        setError(res.error);
      }
      setSearching(false);
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  const kinds = useMemo(() => {
    const seen = new Map<string, { label: string; color: string }>();
    for (const f of data.facts) if (!seen.has(f.kind)) seen.set(f.kind, { label: f.kindLabel, color: f.kindColor });
    return [...seen.entries()].map(([k, v]) => ({ key: k, ...v }));
  }, [data.facts]);

  // The default page's live count (drives the tab badge + the "showing N of TOTAL"
  // note) — always the loaded page, never the search result set.
  const pageLive = data.facts.filter((f) => !archivedIds.has(f.id));
  const searchActive = results !== null;
  const baseFacts = (results ?? data.facts).filter((f) => !archivedIds.has(f.id));
  const visibleFacts = kind === "all" ? baseFacts : baseFacts.filter((f) => f.kind === kind);
  const counts: Record<string, number> = { facts: pageLive.length, review: review.length, learned: data.learned.length };

  // Paged slice of the visible facts. `safePage` guards against a stale page index
  // (e.g. a filter shrank the list below the current page) without needing an extra
  // render to clamp it.
  const totalPages = Math.max(1, Math.ceil(visibleFacts.length / FACTS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * FACTS_PER_PAGE;
  const pagedFacts = visibleFacts.slice(pageStart, pageStart + FACTS_PER_PAGE);

  // Honest status line under the facts toolbar: while searching, how many matched
  // (and whether the match set itself hit the cap); otherwise, when the loaded page
  // is only a slice of the whole brain, say so — the table is never silently a page
  // masquerading as the total.
  const factNote = searchActive
    ? searching
      ? "Searching Arc's memory…"
      : `${visibleFacts.length} ${visibleFacts.length === 1 ? "match" : "matches"} for “${query.trim()}”${resultsCapped ? " · showing the first 200, refine to narrow" : ""}`
    : data.totalFacts > pageLive.length
      ? `Showing the ${pageLive.length} most recently updated of ${data.totalFacts.toLocaleString()} facts — search to reach any of them.`
      : "";

  async function decide(nodeId: string, decision: "approve" | "reject") {
    setError(null);
    setPendingId(nodeId);
    const previous = review;
    setReview((prev) => prev.filter((f) => f.id !== nodeId));
    const res = await decideBrainNode(nodeId, decision);
    setPendingId(null);
    if (!res.ok) {
      setReview(previous);
      setError(res.error);
    }
  }

  // The fact being corrected, and the edits in flight. `null` closes the dialog.
  const [editing, setEditing] = useState<FactVM | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [saving, setSaving] = useState(false);
  // Corrections applied this session, so the row updates before the refetch.
  const [corrections, setCorrections] = useState<Record<string, { label: string; summary: string }>>({});

  function openCorrection(fact: FactVM) {
    setError(null);
    setEditing(fact);
    setEditLabel(fact.label);
    setEditSummary(fact.summary ?? "");
  }

  async function saveCorrection() {
    if (!editing) return;
    const label = editLabel.trim();
    if (!label) {
      setError("A fact needs a label.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await correctBrainFact(editing.id, { label, summary: editSummary });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setCorrections((prev) => ({ ...prev, [editing.id]: { label, summary: editSummary.trim() } }));
    setEditing(null);
  }

  async function archive(nodeId: string) {
    setError(null);
    setPendingId(nodeId);
    // Optimistically hide the fact; restore it if the write fails.
    setArchivedIds((prev) => new Set(prev).add(nodeId));
    const res = await archiveBrainNode(nodeId);
    setPendingId(null);
    if (!res.ok) {
      setArchivedIds((prev) => { const next = new Set(prev); next.delete(nodeId); return next; });
      setError(res.error);
    }
  }

  // Keep the header "Needs you" stat + coverage banner consistent with the
  // live review list (they're derived server-side from the proposed count).
  const stats = data.stats.map((s) => (s.label === WORK_STATE_LABEL.needs_you ? { ...s, value: review.length } : s));

  return (
    <div className={`arc-brain${tab === "web" ? " graph" : ""}`}>
      {/* Correcting a fact, not approving it: the trust tier is untouched, and
          the write re-embeds so the fix reaches Arc's recall on the next turn. */}
      <Modal
        open={editing !== null}
        onClose={() => !saving && setEditing(null)}
        title="Correct this fact"
        description="Arc will use the corrected wording from its next turn. The trust level is unchanged."
        footer={
          <>
            <button type="button" className="mbtn" disabled={saving} onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="button" className="mbtn primary" disabled={saving} onClick={saveCorrection}>
              {saving ? "Saving…" : "Save correction"}
            </button>
          </>
        }
      >
        <label className="fcorr-l" htmlFor="brain-correct-label">
          Label
          <input
            id="brain-correct-label"
            className="fcorr-i"
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            placeholder="Short name for this fact"
          />
        </label>
        <label className="fcorr-l" htmlFor="brain-correct-summary">
          The fact, in plain words
          <textarea
            id="brain-correct-summary"
            className="fcorr-i"
            rows={4}
            value={editSummary}
            onChange={(e) => setEditSummary(e.target.value)}
            placeholder="What Arc should believe about your business"
          />
          <small>This is what Arc recalls and quotes. Empty it to leave only the label.</small>
        </label>
      </Modal>

      {/* A failed read is NOT an empty Brain. Without this, a broken query looks
          identical to a workspace Arc hasn't learned anything about yet — the
          confusion that hid a live outage on /campaigns (BSR-542). */}
      {loadErrors.length > 0 && (
        <div className="crm-error" role="alert" style={{ marginBottom: 16 }}>
          <span>
            <b>Some of the Brain couldn&rsquo;t load.</b> What&rsquo;s missing below is a failed query, not an
            empty Brain. Reload, and if it persists check your workspace access.
            <div style={{ marginTop: 6, opacity: 0.75, fontFamily: "var(--mono, monospace)", fontSize: "0.85em" }}>
              {loadErrors.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          </span>
        </div>
      )}
      <div className="bhead">
        <div className="bh1row">
          <div>
            <h1 className="pt">Brain</h1>
            <div className="psub">Arc&rsquo;s memory — everything it knows about your business, and how it&rsquo;s connected.</div>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            {rebuildMsg ? <span style={{ fontSize: 12, opacity: 0.75 }}>{rebuildMsg}</span> : null}
            <button type="button" className="gbtn" onClick={rebuild} disabled={rebuilding}>
              {IconResync}
              {rebuilding ? "Refreshing…" : "Refresh memory"}
            </button>
          </span>
        </div>
        <KpiStrip
          className="bstats"
          items={stats.map((s) => ({
            label: s.label,
            value: s.value.toLocaleString(),
            sublabel: s.sub,
            // The per-stat colour override becomes a tone: gold when something
            // is waiting on you, green when Arc is cleared to use it.
            tone: s.color === "var(--warn-text)" ? ("attention" as const) : s.color === "var(--ok-text)" ? ("ok" as const) : undefined,
          }))}
        />
        {data.coverageNote && review.length > 0 && (
          <div className="covbanner">
            {IconResync}
            <span className="ct">{data.coverageNote}</span>
          </div>
        )}
        <HowThisWorks>
          <p>
            Everything Arc has learned about your business lives here — from your website, the documents you upload, and
            what it sees happening in your records. Each thing it learns is one line you can read and correct.
          </p>
          <p>
            <b>Trusted</b> facts are ones you approved, and Arc may state them in anything it writes. Anything it is only{" "}
            <b>watching</b> stays out of your copy until you say otherwise — so a wrong guess never reaches a customer.
          </p>
        </HowThisWorks>
      </div>

      <div className="btabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`btab${tab === t.key ? " on" : ""}`} onClick={() => setTab(t.key)}>
            {t.icon}
            {t.label}
            {t.key !== "facts" && counts[t.key] > 0 && <span className="cnt">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      <div className="bbody">
        {tab === "web" ? (
          data.graphNodes.length === 0 ? (
            <div className="scroll"><div className="inner"><div className="empty">No knowledge graph yet. Arc maps what it learns — facts and their connections — here.</div></div></div>
          ) : (
            <KnowledgeGraph nodes={data.graphNodes} edges={data.graphEdges} focusNodeId={focusNodeId} />
          )
        ) : (
          <div className="scroll">
          <div className="inner">
            {tab === "facts" && (
              <>
                <h3 className="sh">All facts</h3>
                <div className="facttools">
                  <div className="factsearch">
                    <svg viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search all facts…"
                      aria-label="Search Arc's memory"
                    />
                    {query && (
                      <button type="button" className="fs-clear" onClick={() => setQuery("")} aria-label="Clear search">
                        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    )}
                  </div>
                  {kinds.length > 1 && (
                    <div className="factbar">
                      <button type="button" className={`fchip${kind === "all" ? " on" : ""}`} onClick={() => setKind("all")}>All</button>
                      {kinds.map((k) => (
                        <button key={k.key} type="button" className={`fchip${kind === k.key ? " on" : ""}`} onClick={() => setKind(k.key)}>{k.label}</button>
                      ))}
                    </div>
                  )}
                </div>
                {factNote && <div className="factnote">{factNote}</div>}
                {visibleFacts.length === 0 ? (
                  <div className="empty">
                    {searchActive
                      ? searching
                        ? "Searching Arc's memory…"
                        : `No facts match “${query.trim()}”.`
                      : "No facts yet. Arc records what it learns about your business here."}
                  </div>
                ) : (
                  <div className="ftwrap">
                    <table className="ft">
                      <thead>
                        <tr><th>Kind</th><th>Fact</th><th>Trust</th><th>Confidence</th><th>Source</th><th aria-label="Actions" /></tr>
                      </thead>
                      <tbody>
                        {pagedFacts.map((f) => (
                          <tr key={f.id}>
                            <td><span className="kindchip"><span className="d" style={{ background: f.kindColor }} />{f.kindLabel}</span></td>
                            <td>
                              <div className="fact-label">{corrections[f.id]?.label ?? f.label}</div>
                              {(corrections[f.id]?.summary ?? f.summary) && (
                                <div className="fact-sum">{corrections[f.id]?.summary ?? f.summary}</div>
                              )}
                            </td>
                            <td><span className={`tier ${tierClass(f.trustTier)}`} title={tierHint(f.trustTier)}><span className="td" />{tierLabel(f.trustTier)}</span></td>
                            <td><Confidence value={f.confidence} /></td>
                            <td><span className="src">{f.source || "—"}</span></td>
                            <td className="factact">
                              <button
                                type="button"
                                className="farch"
                                disabled={pendingId === f.id}
                                onClick={() => openCorrection(f)}
                                title="Correct this fact"
                                aria-label={`Correct: ${f.label}`}
                              >
                                <svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" /></svg>
                              </button>
                              <button
                                type="button"
                                className="farch"
                                disabled={pendingId === f.id}
                                onClick={() => archive(f.id)}
                                title="Archive this fact"
                                aria-label={`Archive: ${f.label}`}
                              >
                                <svg viewBox="0 0 24 24"><path d="M4 7h16v3H4zM6 10h12v9H6zM10 13h4" /></svg>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {visibleFacts.length > FACTS_PER_PAGE && (
                  <div className="pager">
                    <span className="prange">
                      {pageStart + 1}–{Math.min(pageStart + FACTS_PER_PAGE, visibleFacts.length)} of {visibleFacts.length.toLocaleString()}
                    </span>
                    <div className="pnav">
                      <button type="button" className="pbtn" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                        <svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg>
                        Prev
                      </button>
                      <span className="pcur">Page {safePage} of {totalPages}</span>
                      <button type="button" className="pbtn" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                        Next
                        <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {tab === "review" && (
              <>
                <h3 className="sh">Waiting on your approval</h3>
                <p className="lead">Arc proposes brand facts, messaging angles, CTAs, proof points, and audience segments — but they stay <b>proposed</b> and out of all outbound copy until you approve them.</p>
                {error && (
                  <div className="crm-error" role="alert">
                    <span>{error}</span>
                    <button type="button" aria-label="Dismiss" onClick={() => setError(null)}>
                      <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </div>
                )}
                {review.length === 0 ? (
                  <div className="empty">Nothing waiting for review. Proposed facts appear here before they can be used.</div>
                ) : (
                  review.map((f) => (
                    <div className="qcard" key={f.id}>
                      <div className="qtop">
                        <span className="kindchip"><span className="d" style={{ background: f.kindColor }} />{f.kindLabel}</span>
                        <span className={`tier ${tierClass(f.trustTier)}`} title={tierHint(f.trustTier)}><span className="td" />{tierLabel(f.trustTier)}</span>
                        <Confidence value={f.confidence} />
                      </div>
                      <div className="qlabel">{f.label}</div>
                      {f.summary && <div className="qbody">{f.summary}</div>}
                      <div className="qmeta">
                        {f.source && <span>Source: {f.source}</span>}
                        <span>Approving moves it to trusted — usable in outbound copy.</span>
                      </div>
                      <div className="qactions">
                        <button type="button" className="qbtn approve" disabled={pendingId === f.id} onClick={() => decide(f.id, "approve")}>
                          <svg viewBox="0 0 24 24"><path d="M5 12l4 4L19 6" /></svg>
                          {pendingId === f.id ? "Saving…" : "Approve"}
                        </button>
                        <button type="button" className="qbtn reject" disabled={pendingId === f.id} onClick={() => decide(f.id, "reject")}>
                          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
                          Reject
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}

            {tab === "learned" && (
              <>
                <h3 className="sh">Recently learned</h3>
                {data.learned.length === 0 ? (
                  <div className="empty">Nothing learned yet. New facts show up here as Arc discovers them.</div>
                ) : (
                  <div className="tline">
                    {data.learned.map((f) => (
                      <div className="tlrow" key={f.id}>
                        <span className="tld" style={{ background: f.kindColor }} />
                        <div style={{ minWidth: 0 }}>
                          <div className="tll">{f.label}</div>
                          <div className="tlk">
                            <span className="kindchip"><span className="d" style={{ background: f.kindColor }} />{f.kindLabel}</span>
                            <span className={`tier ${tierClass(f.trustTier)}`} title={tierHint(f.trustTier)}><span className="td" />{tierLabel(f.trustTier)}</span>
                          </div>
                        </div>
                        <span className="tlt">{f.learnedAt}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ASSET_NOUN, CAMPAIGN_NOUN, countOf, WORK_STATE_LABEL, personaAccent,} from "@/domain";

import { createCampaign, loadReviewQueueAction, type NewCampaignInput } from "../actions";
import { applyFindingFixAction, decideCampaignAsset, requestCampaignRevision } from "../[campaignId]/actions";
import { ReviewQueue } from "../[campaignId]/_components/review-queue";
import { type ReviewQueueEntry } from "@/lib/campaigns/read-model";
import { constantAudience, nextActionFor, type SignalTiming } from "./board-derivations";
import { NewCampaignModal } from "./new-campaign-modal";
import { needsOperatorAttention, type CampaignDeskState, type CampaignTone } from "./tone";

export type { CampaignTone } from "./tone";

export type CampaignRow = {
  id: string;
  name: string;
  brief: string;
  tone: CampaignTone;
  statusLabel: string;
  next: string;
  nextTone: "" | "go" | "warn";
  /** Assets on this campaign with no decision recorded yet. */
  pendingCount: number;
  audience: string;
  dot: string;
  channels: string;
  updatedRel: string;
  updatedAbs: string;
  /** How much life is left in the signal this was built from — null for the
   *  campaigns that were not built from one, which is most of them. */
  timing: SignalTiming | null;
  href: string;
  /** Cover image for the row — first attached image, else a video poster.
   *  Null when the package has no visual creative. */
  thumbnailUrl: string | null;
  /** How many media assets the package carries, thumbnail included. */
  mediaCount: number;
};

const CampIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
    <path d="M4 5h16v6H4z" />
    <path d="M4 15h10v4H4z" />
  </svg>
);

// Tab labels and the status pills in the rows below them are the same words now
// (BSR-656) — the "Needs approval" tab used to sit above rows reading "In review".
const TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs", label: WORK_STATE_LABEL.needs_you },
  { key: "live", label: WORK_STATE_LABEL.sending },
  { key: "approved", label: WORK_STATE_LABEL.approved },
  { key: "draft", label: WORK_STATE_LABEL.draft },
  { key: "archived", label: WORK_STATE_LABEL.archived },
];

// The "Needs you" tab takes the whole row, not just its tone: a campaign earns
// that tab either by its own status or by holding an undecided asset. Every
// other tab is a plain tone match.
function inTab(row: CampaignDeskState, tab: string): boolean {
  if (tab === "all") return true;
  if (tab === "needs") return needsOperatorAttention(row);
  return row.tone === tab;
}

type SortKey = "recent" | "name" | "status";
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recently updated" },
  { key: "name", label: "Name (A–Z)" },
  { key: "status", label: "Status" },
];
// Status order surfaces what needs you first, then live work, then the rest.
const TONE_RANK: Record<CampaignTone, number> = { review: 0, revise: 1, live: 2, approved: 3, draft: 4, archived: 5 };

// --- Optimistic row for a just-created campaign (mirrors page.tsx derivations) ---
function personaLabelOf(persona: string): string {
  const s = (persona || "").replace(/^persona[\s_-]+/i, "").replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}
/** A campaign created seconds ago holds nothing: no assets, so nothing undecided
 *  and nothing in the roll-up. Arc drafts them after this row appears. */
const EMPTY_ROLLUP = { state: "empty" as const, label: "", approved: 0, pending: 0, changes: 0, draft: 0, total: 0 };

function buildOptimisticCampaign(id: string, v: NewCampaignInput): CampaignRow {
  const audience = personaLabelOf(v.persona);
  // Through the shared derivation rather than a hardcoded string, so this row
  // cannot drift from what the server would have said about the same campaign.
  const { next, nextTone } = nextActionFor("draft", 0, EMPTY_ROLLUP);
  return {
    id,
    name: v.name,
    brief: v.campaignTheme || "New campaign",
    tone: "draft",
    statusLabel: WORK_STATE_LABEL.draft,
    pendingCount: 0,
    next,
    nextTone,
    audience,
    dot: personaAccent(v.persona || audience),
    channels: "",
    updatedRel: "now",
    updatedAbs: "",
    timing: null,
    href: `/campaigns/${id}`,
    // A package created seconds ago carries no creative yet, same reasoning as
    // pendingCount above.
    thumbnailUrl: null,
    mediaCount: 0,
  };
}

/**
 * The row's cover: the package's own creative when it has some, the generic
 * campaign glyph when it doesn't. A campaign carrying three approved images
 * used to be indistinguishable from an empty one on this board.
 */
function CampaignAvatar({ thumbnailUrl, mediaCount }: { thumbnailUrl: string | null; mediaCount: number }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(thumbnailUrl) && !failed;
  return (
    <span className={`pav${showImage ? " hasthumb" : ""}`}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- user media URL; next/image would need per-host remotePatterns
        <img className="pavimg" src={thumbnailUrl as string} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        CampIcon
      )}
      {mediaCount > 1 && (
        <span className="pavn" title={`${mediaCount} creative assets`}>
          {mediaCount}
        </span>
      )}
    </span>
  );
}

const svgIcon = (d: string) => <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: d }} />;

export function CampaignsBoard({
  rows,
  arcNote,
  undecidedCount = 0,
  personaOptions,
  loadError = null,
}: {
  rows: CampaignRow[];
  arcNote: string;
  /** Deliverables with no decision recorded, across every campaign — the size of
   *  the queue the button below opens. A number, not a substring of arcNote. */
  undecidedCount?: number;
  /** The org's own personas for the New-campaign picker. */
  personaOptions?: { key: string; label: string }[];
  /**
   * Why the list is empty, when it is empty because the read FAILED rather than
   * because the workspace has no campaigns. Those two must never render the same
   * — an empty board that is actually a broken query is how a prod failure hid
   * behind a green guardrail (BSR-542).
   */
  loadError?: string | null;
}) {
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [sortOpen, setSortOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  // Draft rows created this session, shown until a real write revalidates.
  const [localRows, setLocalRows] = useState<CampaignRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // The review queue. Null until asked for — see loadReviewQueueAction for why
  // it is not loaded with the board. `queueScope` names the campaign it was
  // opened for, so the panel can say whose queue this is; null means the whole
  // workspace.
  const [queue, setQueue] = useState<ReviewQueueEntry[] | null>(null);
  const [queueScope, setQueueScope] = useState<string | null>(null);
  // Which row's button is spinning, so only that one shows "Loading…" — a shared
  // boolean would put it on the header button too.
  const [queueLoadingFor, setQueueLoadingFor] = useState<string | null>(null);

  const [queueError, setQueueError] = useState<string | null>(null);
  const [queuePending, startQueueTransition] = useTransition();

  /** Open the review queue, scoped to one campaign when given one. */
  async function openQueue(campaign?: { id: string; name: string }) {
    if (queueLoadingFor) return;
    setQueueLoadingFor(campaign?.id ?? "all");
    setQueueError(null);
    try {
      const res = await loadReviewQueueAction(campaign?.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.entries.length === 0) {
        // The count and the queue disagreeing means something was decided while
        // this page sat open. Say that, rather than opening an empty queue.
        setError("Everything here has been decided since this page loaded.");
        return;
      }
      setQueueScope(campaign?.name ?? null);
      setQueue(res.entries);
    } finally {
      setQueueLoadingFor(null);
    }
  }

  /** Drop a deliverable from the queue so the next one arrives, and put it back
   *  if the write failed. The queue advances by the list shrinking. */
  function settleQueueEntry(assetId: string, run: () => Promise<{ ok: boolean; error?: string }>) {
    const snapshot = queue;
    setQueue((current) => current?.filter((e) => e.asset.id !== assetId) ?? current);
    startQueueTransition(async () => {
      const res = await run();
      if (!res.ok) {
        setQueue(snapshot);
        setQueueError(res.error ?? "That did not save.");
      }
    });
  }

  const allRows = useMemo(() => [...localRows, ...rows], [localRows, rows]);

  // Each tab's badge is literally how many rows that tab shows — counted through
  // `inTab`, the same function that filters the table. A count derived any other
  // way is a second implementation of the rule, which is how "Needs you 0" came
  // to sit above three rows reading "Approve N assets".
  const counts = useMemo(
    () =>
      Object.fromEntries(
        TABS.map((t) => [t.key, allRows.filter((r) => inTab(r, t.key)).length]),
      ) as Record<string, number>,
    [allRows],
  );

  // Over ALL rows, not the visible ones: a column that appears and disappears as
  // you type in the filter box is worse than a redundant one.
  const sharedAudience = useMemo(() => constantAudience(allRows), [allRows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = allRows.filter((r) => {
      if (!inTab(r, tab)) return false;
      if (needle && !`${r.name} ${r.brief} ${r.audience}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    // "recent" keeps the server's updated-desc order (fresh local drafts already
    // lead); the others sort a copy so the source order stays intact.
    if (sort === "name") return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "status") return [...filtered].sort((a, b) => (TONE_RANK[a.tone] ?? 9) - (TONE_RANK[b.tone] ?? 9));
    return filtered;
  }, [allRows, tab, q, sort]);

  // Create a campaign: when it persists, jump into the new draft's detail page;
  // offline it drops in an optimistic draft row and stays on the board. Failures
  // surface an error and keep the modal open.
  const handleCreate = async (value: NewCampaignInput): Promise<{ ok: boolean; error?: string }> => {
    setError(null);
    const res = await createCampaign(value);
    if (!res.ok) {
      setError(res.error);
      return { ok: false, error: res.error };
    }
    if (res.persisted && res.href) {
      router.push(res.href);
      return { ok: true };
    }
    const tempId = `local-${crypto.randomUUID()}`;
    setLocalRows((prev) => [buildOptimisticCampaign(tempId, value), ...prev]);
    return { ok: true };
  };

  return (
    <div className="arc-grid arc-campaigns">
      <div className="chrow">
        <div>
          <h2 className="ct">Campaigns</h2>
          <div className="csub">
            {countOf(allRows.length, CAMPAIGN_NOUN)} drafted by Arc · nothing sends until you approve it
            {/* Said once, here, when it is the same for every row — see the
                Audience column's absence below. */}
            {sharedAudience && <> · all <span className="csub-em">{sharedAudience}</span></>}
          </div>
        </div>
        {/* Deciding is the job on this screen; Arc does the drafting. The gold
            went to "New campaign" — the rarest action here — while the review
            control was a ghost button in the footer, below a table that is
            `flex: 1` and so pushes it off the bottom of a short list. */}
        <div className="sp">
          {undecidedCount > 0 && (
            <button
              type="button"
              className="gbtn gold"
              onClick={() => openQueue()}
              disabled={queueLoadingFor !== null}
            >
              {svgIcon('<path d="M20 6L9 17l-5-5"/>')}
              {queueLoadingFor === "all" ? "Loading…" : `Review ${countOf(undecidedCount, ASSET_NOUN)}`}
            </button>
          )}
          <button
            type="button"
            className={undecidedCount > 0 ? "gbtn" : "gbtn gold"}
            onClick={() => setNewOpen(true)}
          >
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            New campaign
          </button>
        </div>
      </div>

      {error && (
        <div className="crm-error" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError(null)}>
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      )}

      <div className="subtabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`subtab${tab === t.key ? " on" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label} <span className="cnt">{counts[t.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="gtoolbar">
        <span className="tsearch">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter campaigns…"
            aria-label="Filter campaigns"
          />
        </span>
        <span className="gspacer" />
        <div className="sortwrap">
          <button
            type="button"
            className="fbtn"
            aria-haspopup="listbox"
            aria-expanded={sortOpen}
            onClick={() => setSortOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
            {SORT_OPTIONS.find((o) => o.key === sort)?.label} <span className="cv">▾</span>
          </button>
          {sortOpen && (
            <>
              <div className="sortscrim" onClick={() => setSortOpen(false)} />
              <div className="sortmenu" role="listbox" aria-label="Sort campaigns">
                {SORT_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    role="option"
                    aria-selected={sort === o.key}
                    className={`sortopt${sort === o.key ? " on" : ""}`}
                    onClick={() => { setSort(o.key); setSortOpen(false); }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="tablewrap">
        <table className="dt">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Status</th>
              <th>Next action</th>
              {!sharedAudience && <th>Audience</th>}
              <th>Channels</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr className="emptyrow">
                {/* "Couldn't load" and "nothing here yet" are different facts and
                    must read differently. Saying "No campaigns" over a failed
                    query tells an operator the workspace is empty when it isn't. */}
                <td colSpan={sharedAudience ? 5 : 6}>
                  {loadError ? (
                    <>
                      <strong>Couldn’t load campaigns.</strong> This is a failure, not an empty workspace — campaigns may exist.
                      <div style={{ marginTop: 6, opacity: 0.75, fontFamily: "var(--mono, monospace)", fontSize: "0.85em" }}>{loadError}</div>
                    </>
                  ) : allRows.length === 0 ? (
                    // A workspace with zero campaigns is a different fact from a
                    // filter hiding them. "No campaigns match this view" tells a
                    // brand-new owner to go hunting for a filter that isn't set,
                    // when what they actually need is to know where campaigns
                    // come from.
                    <>
                      <strong>No campaigns yet.</strong> Arc drafts these from opportunities it finds in your records
                      — nothing is sent until you approve it.
                      <div style={{ marginTop: 8 }}>
                        <Link className="cbtn" href="/opportunities">
                          See what Arc has found&nbsp;→
                        </Link>
                      </div>
                    </>
                  ) : (
                    "No campaigns match this view."
                  )}
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr
                  key={r.id}
                  className={r.id.startsWith("local-") ? "freshrow" : undefined}
                >
                  <td>
                    {r.id.startsWith("local-") ? <div className="pcell">
                      <CampaignAvatar thumbnailUrl={r.thumbnailUrl} mediaCount={r.mediaCount} />
                      <div style={{ minWidth: 0 }}>
                        <div className="pnm">{r.name}</div>
                        <div className="psub">{r.brief}</div>
                      </div>
                    </div> : <Link className="pcell campaign-link" href={r.href} aria-label={`Open ${r.name}`}>
                      <CampaignAvatar thumbnailUrl={r.thumbnailUrl} mediaCount={r.mediaCount} />
                      <div style={{ minWidth: 0 }}>
                        <div className="pnm">{r.name}</div>
                        {/* The only clock on this row used to be `updatedAt`,
                            which measures OUR activity — not how much life is
                            left in the opportunity the package was built for. */}
                        {r.timing && <span className={`sigchip ${r.timing.tone}`}>{r.timing.label}</span>}
                        <div className="psub">{r.brief}</div>
                      </div>
                    </Link>}
                  </td>
                  <td>
                    <span className={`pill ${r.tone}`}>
                      <span className="pd" />
                      {r.statusLabel}
                    </span>
                  </td>
                  {/* An instruction the operator can act on is a control, not a
                      label. This cell was a <span> styled in the accent colour at
                      weight 500 — indistinguishable from a link, and doing
                      nothing when clicked. */}
                  <td>
                    {r.pendingCount > 0 ? (
                      <button
                        type="button"
                        className="nxbtn"
                        onClick={() => openQueue({ id: r.id, name: r.name })}
                        disabled={queueLoadingFor !== null}
                      >
                        {queueLoadingFor === r.id ? "Loading…" : r.next}
                      </button>
                    ) : (
                      <span className={`nx${r.nextTone ? ` ${r.nextTone}` : ""}`}>{r.next}</span>
                    )}
                  </td>
                  {!sharedAudience && (
                    <td>
                      {r.audience ? (
                        <span className="chip persona">
                          <span className="pgd" style={{ background: r.dot }} />
                          {r.audience}
                        </span>
                      ) : (
                        <span className="nx">—</span>
                      )}
                    </td>
                  )}
                  <td>{r.channels ? <span className="chan">{r.channels}</span> : <span className="nx">—</span>}</td>
                  <td>
                    <span className="last">
                      <b>{r.updatedRel}</b>
                      {r.updatedAbs && <span>{r.updatedAbs}</span>}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="gfoot">
        <span className="arcnote">
          <i />
          {arcNote}
        </span>
        {/* The review control moved to the header — see the note there. Leaving a
            second copy down here would just be two buttons for one action. */}
        <div className="pager">
          <span className="pgnum">
            {visible.length === 0 ? "0 of 0" : `1–${visible.length} of ${visible.length}`}
          </span>
        </div>
      </div>

      {/* Mounted while `queue` is non-null, NOT while it has entries: draining the
          last one is the moment the reviewer has earned the "everything here has
          a decision" panel, and unmounting on empty would swallow it. */}
      {queue && (
        <ReviewQueue
          title={queueScope ?? "everything waiting on you"}
          closeLabel="Back to campaigns"
          queue={queue}
          pending={queuePending}
          error={queueError}
          onDecide={(asset, decision) => {
            const entry = queue.find((e) => e.asset.id === asset.id);
            if (!entry) return;
            settleQueueEntry(asset.id, () => decideCampaignAsset(entry.campaignId, asset.id, decision));
          }}
          onRevise={(asset, instruction) => {
            const entry = queue.find((e) => e.asset.id === asset.id);
            if (!entry) return;
            // A revision request leaves the piece undecided, so it stays in the
            // queue exactly as it does inside a campaign.
            startQueueTransition(async () => {
              const res = await requestCampaignRevision(entry.campaignId, asset.id, instruction);
              if (!res.ok) setQueueError(res.error);
            });
          }}
          onApplyFix={(asset, finding, value) => {
            const entry = queue.find((e) => e.asset.id === asset.id);
            if (!entry) return;
            startQueueTransition(async () => {
              const res = await applyFindingFixAction({ campaignId: entry.campaignId, findingId: finding.id, value });
              if (!res.ok) {
                setQueueError(res.error);
                return;
              }
              setQueue((current) =>
                current?.map((e) =>
                  e.asset.id === asset.id
                    ? { ...e, asset: { ...e.asset, findings: e.asset.findings.filter((f) => f.id !== finding.id) } }
                    : e,
                ) ?? current,
              );
            });
          }}
          // No editor on this screen. Editing hands off to the campaign that
          // owns the deliverable rather than growing a second one here.
          onEdit={(asset) => {
            const entry = queue.find((e) => e.asset.id === asset.id);
            setQueue(null);
            setQueueScope(null);
            if (entry) router.push(`/campaigns/${entry.campaignId}`);
          }}
          onClose={() => {
            setQueue(null);
            setQueueScope(null);
          }}
        />
      )}

      <NewCampaignModal
        key={newOpen ? "open" : "closed"}
        open={newOpen}
        personaOptions={personaOptions}
        onClose={() => setNewOpen(false)}
        onSubmit={handleCreate}
      />
    </div>
  );
}

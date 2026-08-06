"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ASSET_NOUN, countOf, WORK_STATE_LABEL, personaAccent,} from "@/domain";

import { createCampaign, loadReviewQueueAction, type NewCampaignInput } from "../actions";
import { applyFindingFixAction, decideCampaignAsset, editCampaignDraftAction, requestCampaignRevision } from "../[campaignId]/actions";
import { ReviewQueue } from "../[campaignId]/_components/review-queue";
import { type ReviewQueueEntry } from "@/lib/campaigns/read-model";
import { nextActionFor, type SignalTiming } from "./board-derivations";
import { NewCampaignModal } from "./new-campaign-modal";
import { needsOperatorAttention, type CampaignTone } from "./tone";
import { AppImage } from "../../_components/app-image";

export type { CampaignTone } from "./tone";

/** One deliverable, as the board shows it in an opened row. */
export type CampaignPiece = {
  id: string;
  title: string;
  /** e.g. "Email", "SMS" — what kind of thing this is. */
  kind: string;
  statusLabel: string;
  tone: CampaignTone;
  thumbnailUrl: string | null;
  /** No decision recorded — this is the work. */
  needsReview: boolean;
};

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
  /** What is in this campaign, in plain words: "An email and a text message". */
  contents: string;
  /**
   * The campaign's deliverables, for the opened row.
   *
   * The read-model has always built these — title, kind, status, media — and the
   * board rendered none of them, so the only way to find out what a campaign
   * actually contained was to leave the page.
   */
  pieces: CampaignPiece[];
  /** Holds nothing but generation prompts — grouped under "Creative from Studio". */
  creativeOnly: boolean;
};

const CampIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
    <path d="M4 5h16v6H4z" />
    <path d="M4 15h10v4H4z" />
  </svg>
);

// Tab labels and the status pills in the rows below them are the same words now
// (BSR-656) — the "Needs approval" tab used to sit above rows reading "In review".
// The "Needs you" tab takes the whole row, not just its tone: a campaign earns
// that tab either by its own status or by holding an undecided asset. Every
// other tab is a plain tone match.
// Status order surfaces what needs you first, then live work, then the rest.
const TONE_RANK: Record<CampaignTone, number> = { review: 0, revise: 1, live: 2, approved: 3, draft: 4, archived: 5 };

// --- Optimistic row for a just-created campaign (mirrors page.tsx derivations) ---
function personaLabelOf(persona: string): string {
  const s = (persona || "").replace(/^persona[\s_-]+/i, "").replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}
function buildOptimisticCampaign(id: string, v: NewCampaignInput): CampaignRow {
  const audience = personaLabelOf(v.persona);
  // Through the shared derivation rather than a hardcoded string, so this row
  // cannot drift from what the server would have said about the same campaign.
  // A campaign created seconds ago holds nothing — Arc drafts its deliverables
  // after this row appears.
  const { next, nextTone } = nextActionFor("draft", 0, { approved: 0, required: 0 });
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
    contents: "",
    pieces: [],
    // A campaign the operator just created by hand is outbound work by intent,
    // whatever ends up in it. It cannot be a Studio batch at zero assets.
    creativeOnly: false,
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
        <AppImage className="pavimg" src={thumbnailUrl as string} alt="" onError={() => setFailed(true)} />
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

/**
 * A campaign's deliverables, opened in place.
 *
 * Ordered undecided-first, because that is the order the operator works in — the
 * pieces asking for something come before the ones that have already been
 * settled. Decided pieces stay visible but recede: what a campaign already
 * approved is context for the decision, not the decision.
 */
function DeliverableStrip({
  pieces,
  onReview,
  reviewing,
}: {
  pieces: CampaignPiece[];
  /** Opens the review queue. Given an asset id, that asset is dealt first. */
  onReview: (focusAssetId?: string) => void;
  reviewing: boolean;
}) {
  const ordered = useMemo(
    () => [...pieces].sort((a, b) => Number(b.needsReview) - Number(a.needsReview)),
    [pieces],
  );
  const waiting = ordered.filter((p) => p.needsReview).length;

  return (
    <div className="dstrip">
      <div className="dgrid">
        {ordered.map((piece, i) => {
          const label = [piece.title, piece.kind].filter(Boolean).join(" · ");
          const body = (
            <>
              <span className="dthumb">
                {piece.thumbnailUrl ? (
                  <AppImage src={piece.thumbnailUrl} alt="" />
                ) : (
                  svgIcon('<path d="M4 5h16v14H4z"/><path d="M4 10h16M9 10v9"/>')
                )}
              </span>
              <div className="dmeta">
                <div className="dtitle">{piece.title}</div>
                {/* Absent when the title already IS the kind — see `pieceLabel`. */}
                {piece.kind && <div className="dkind">{piece.kind}</div>}
              </div>
              <span className={`pill ${piece.tone}`}>
                <span className="pd" />
                {piece.statusLabel}
              </span>
            </>
          );
          // Each card enters just behind the one before it. The delay is an
          // inline custom property rather than an nth-child ladder so it holds
          // for any number of assets.
          const style = { "--i": i } as CSSProperties;

          // An undecided asset is a thing you can act on, so it is a button and
          // it deals ITSELF first. Reviewing one specific piece used to mean
          // opening the whole queue and paging to it.
          return piece.needsReview ? (
            <button
              key={piece.id}
              type="button"
              className="dcard waiting"
              style={style}
              onClick={() => onReview(piece.id)}
              disabled={reviewing}
              aria-label={`Review ${label}`}
            >
              {body}
            </button>
          ) : (
            <div key={piece.id} className="dcard" style={style}>
              {body}
            </div>
          );
        })}
      </div>
      {/* `.gbtn`, not `.cbtn` — campaign.css scopes `.cbtn` under `.arc-campaign`
          (the detail route). This board's root is `.arc-campaigns`, which that
          selector does not match, so a `.cbtn` here renders as bare text with a
          full-size raw SVG beside it. */}
      {waiting > 0 && (
        <button type="button" className="gbtn dreview" onClick={() => onReview()} disabled={reviewing}>
          {svgIcon('<path d="M20 6L9 17l-5-5"/>')}
          {reviewing ? "Loading…" : `Review ${countOf(waiting, ASSET_NOUN)}`}
        </button>
      )}
    </div>
  );
}

export function CampaignsBoard({
  rows,
  undecidedCount = 0,
  personaOptions,
  loadError = null,
}: {
  rows: CampaignRow[];
  /** Deliverables with no decision recorded, across every campaign — the size of
   *  the queue the header button opens. */
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
  const [open, setOpen] = useState<string | null>(null);
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

  /**
   * Open the review queue, scoped to one campaign when given one, and dealing
   * `focusAssetId` first when the operator picked a specific asset.
   *
   * Reordering rather than filtering: they asked to start at that piece, not to
   * be shut off from the rest, so the queue still walks the whole set after it.
   */
  async function openQueue(campaign?: { id: string; name: string }, focusAssetId?: string) {
    if (queueLoadingFor) return;
    setQueueLoadingFor(campaign?.id ?? "all");
    setQueueError(null);
    try {
      const res = await loadReviewQueueAction(campaign?.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (focusAssetId) {
        const at = res.entries.findIndex((e) => e.asset.id === focusAssetId);
        if (at > 0) res.entries.unshift(...res.entries.splice(at, 1));
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



  // Ordered by what the operator has to do, then by recency. Sorting was a
  // dropdown nobody needed: "what needs me, newest first" is the only order this
  // page is ever read in.
  const visible = useMemo(
    () => [...allRows].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]),
    [allRows],
  );
  // Studio's generation batches are campaigns only because the campaign IS the
  // approval gate — Studio cannot attach creative anywhere else. On the live
  // workspace they were half of "Needs you", so a queue meant to show what needs
  // the operator's judgement was 50% image prompts. They get their own heading
  // rather than being hidden: they still need deciding, they are just not
  // outbound work. See `isCreativeOnlyCampaign`.
  const creativeRows = useMemo(() => visible.filter((r) => r.creativeOnly), [visible]);
  const campaignRows = useMemo(() => visible.filter((r) => !r.creativeOnly), [visible]);
  const waitingRows = useMemo(() => campaignRows.filter(needsOperatorAttention), [campaignRows]);
  const restRows = useMemo(() => campaignRows.filter((r) => !needsOperatorAttention(r)), [campaignRows]);

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

  function renderCards(rows: CampaignRow[]) {
    return rows.map((r) => {
            const isOpen = open === r.id;
            const local = r.id.startsWith("local-");
            return (
              <article
                key={r.id}
                className={`cmp-card${r.pendingCount > 0 ? " needsyou" : ""}${isOpen ? " open" : ""}${local ? " fresh" : ""}${r.pieces.length > 0 ? " openable" : ""}`}
                // Mouse convenience: anywhere that isn't already a control
                // toggles the card. A 900px-wide target beats a 90px text link,
                // and the real control below stays the keyboard/AT path.
                onClick={(e) => {
                  if (r.pieces.length === 0) return;
                  if ((e.target as HTMLElement).closest("a,button")) return;
                  setOpen((cur) => (cur === r.id ? null : r.id));
                }}
              >
                <div className="cmp-head">
                  <CampaignAvatar thumbnailUrl={r.thumbnailUrl} mediaCount={r.mediaCount} />

                  <div className="cmp-body">
                    {local ? (
                      <div className="cmp-name">{r.name}</div>
                    ) : (
                      <Link className="cmp-name" href={r.href}>
                        {r.name}
                      </Link>
                    )}
                    {/* The collapsed card carries what Arc made and nothing
                        else. Objective, audience, channels and the signal window
                        are real, and they are detail — they moved behind the
                        disclosure, where someone who wants them can ask. */}
                    {r.contents && <p className="cmp-what">{r.contents}</p>}
                  </div>

                  <div className="cmp-state">
                    <span className={`pill ${r.tone}`}>
                      <span className="pd" />
                      {r.statusLabel}
                    </span>
                    {/* A real button, not accent-coloured text. The one thing to
                        do on this card should look like a thing you press. */}
                    {r.pendingCount > 0 ? (
                      <button
                        type="button"
                        className="gbtn gold cmp-act"
                        onClick={() => openQueue({ id: r.id, name: r.name })}
                        disabled={queueLoadingFor !== null}
                      >
                        {queueLoadingFor === r.id ? "Loading…" : r.next}
                        <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                      </button>
                    ) : (
                      <span className="cmp-next">{r.next}</span>
                    )}
                  </div>
                </div>

                {r.pieces.length > 0 && (
                  <button
                    type="button"
                    className={`cmp-more${isOpen ? " on" : ""}`}
                    aria-expanded={isOpen}
                    onClick={() => setOpen((cur) => (cur === r.id ? null : r.id))}
                  >
                    <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
                    {isOpen ? "Hide" : `Show ${countOf(r.pieces.length, ASSET_NOUN)}`}
                  </button>
                )}

                {/* Always mounted, height animated by grid-template-rows — so it
                    collapses as smoothly as it opens. Conditional rendering gave
                    an entrance and no exit: the drawer just vanished. Images stay
                    `loading="lazy"`, so a closed drawer costs no fetches. */}
                {r.pieces.length > 0 && (
                  <div className="cmp-drawer" aria-hidden={!isOpen}>
                    <div className="cmp-drawer-in">
                      <div className="cmp-detail">
                        <p className="cmp-brief">{r.brief}</p>
                        <div className="cmp-meta">
                          {/* Persona identity comes from `personaAccent()`, per
                              DESIGN.md — the chip used to wear the gold tint,
                              which spent the one focal colour on a category that
                              carries no status meaning. */}
                          {r.audience && <span className="cmp-dot" style={{ background: r.dot }} />}
                          <span>{[r.audience, r.channels, r.updatedRel].filter(Boolean).join("  ·  ")}</span>
                          {/* Neutral, never red: red is for destructive controls,
                              and how much life is left in a signal is a fact. */}
                          {r.timing && <span className="cmp-window">{r.timing.label}</span>}
                        </div>
                      </div>
                      <DeliverableStrip
                        pieces={r.pieces}
                        reviewing={queueLoadingFor === r.id}
                        onReview={(assetId) => openQueue({ id: r.id, name: r.name }, assetId)}
                      />
                    </div>
                  </div>
                )}
              </article>
            );
    });
  }

  return (
    <div className="arc-grid arc-campaigns">
      <div className="chrow">
        <div>
          <h1 className="ct">Campaigns</h1>
          {/* The job, in one sentence. The old subhead counted our inventory
              ("4 campaigns drafted by Arc") — true, and not what the owner came
              to find out. */}
          <div className="csub">
            {undecidedCount > 0
              ? `Arc wrote ${countOf(undecidedCount, ASSET_NOUN)} for you to check. Nothing goes to customers until you approve it.`
              : "Nothing is waiting on you. Arc drafts new work here as it finds opportunities."}
          </div>
        </div>
        <div className="sp">
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

      <div className="cmp-list">
        {visible.length === 0 ? (
          <div className="cmp-empty">
            {/* "Couldn't load" and "nothing here yet" are different facts and must
                read differently. Saying "No campaigns" over a failed query tells
                an operator the workspace is empty when it isn't. */}
            {loadError ? (
              <>
                <strong>Couldn’t load campaigns.</strong> This is a failure, not an empty workspace — campaigns may exist.
                <div className="cmp-empty-detail">{loadError}</div>
              </>
            ) : allRows.length === 0 ? (
              // A workspace with zero campaigns is a different fact from a filter
              // hiding them. "No campaigns match this view" sends a brand-new
              // owner hunting for a filter that isn't set, when what they need is
              // to know where campaigns come from.
              <>
                <strong>No campaigns yet.</strong> Arc drafts these from opportunities it finds in your records
                — nothing is sent until you approve it.
                <div style={{ marginTop: 12 }}>
                  {/* `.gbtn`, not `.cbtn`: campaign.css scopes `.cbtn` under
                      `.arc-campaign` (the detail route), which does not match this
                      board — so the one call to action a brand-new workspace ever
                      sees rendered as bare unstyled text. */}
                  <Link className="gbtn gold" href="/opportunities">
                    See what Arc has found&nbsp;→
                  </Link>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <>
        {/* Two sections, not six tabs. "Needs you" and "Everything else" say
            what they hold; a tab row is a set of choices you have to understand
            before it tells you anything. */}
        {waitingRows.length > 0 && (
          <>
            <h3 className="cmp-sec">Needs you <span className="cmp-secn">{waitingRows.length}</span></h3>
            {renderCards(waitingRows)}
          </>
        )}
        {restRows.length > 0 && (
          <>
            <h3 className="cmp-sec">{waitingRows.length > 0 ? "Everything else" : "All campaigns"} <span className="cmp-secn">{restRows.length}</span></h3>
            {renderCards(restRows)}
          </>
        )}
        {/* Last, and named for what it is. These hold generated images and video
            waiting on a decision — real work, but not something that reaches a
            customer, so it does not belong in the outbound queue above. */}
        {creativeRows.length > 0 && (
          <>
            <h3 className="cmp-sec">Creative from Studio <span className="cmp-secn">{creativeRows.length}</span></h3>
            {renderCards(creativeRows)}
          </>
        )}
          </>
        )}
      </div>

      {/* The footer's tally said "2 campaigns need you · 6 assets undecided" —
          the same fact as the header sentence and the section counts, printed a
          third time. */}

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
          // Saves through `editCampaignDraftAction` — the same path the campaign
          // page's editor uses, which writes edited_body and never touches
          // dispatch_locked. The entry is patched in place so the new copy shows
          // without closing the queue and losing the operator's position.
          onSaveCopy={(asset, body) => {
            const entry = queue.find((e) => e.asset.id === asset.id);
            if (!entry) return;
            startQueueTransition(async () => {
              const res = await editCampaignDraftAction({ campaignId: entry.campaignId, assetId: asset.id, body });
              if (!res.ok) {
                setQueueError(res.error);
                return;
              }
              setQueue((current) =>
                current?.map((e) =>
                  e.asset.id === asset.id ? { ...e, asset: { ...e.asset, preview: body, body } } : e,
                ) ?? current,
              );
            });
          }}
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

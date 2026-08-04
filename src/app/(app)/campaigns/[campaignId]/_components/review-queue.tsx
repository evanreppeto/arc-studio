"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { type CampaignAssetFinding, type CampaignWorkspaceAsset, type ReviewQueueEntry } from "@/lib/campaigns/read-model";

import { OverlayPortal } from "../../../_components/overlay-portal";

import { DeliverableCopy, markId, ReviewBlock, statusMeta, svg } from "./deliverable-review";
import { isTypingTarget, keyToQueueAction, stepQueueIndex } from "./queue-keys";
import { summarizeReview } from "./review-summary";

/**
 * One deliverable at a time, with the keyboard.
 *
 * The list view answers "what is in this campaign?". This answers "what am I
 * deciding right now?" — and the difference matters most to someone working
 * through a queue rather than looking something up. Everything shown here is
 * the same renderer the list uses; only the density and the controls differ.
 *
 * Decided items leave the queue the moment the optimistic update lands, so the
 * next one slides into the current index on its own. That is the advance —
 * there is no separate "move on" step to get out of sync with the decision.
 */
export function ReviewQueue({
  title,
  queue,
  pending,
  error,
  onDecide,
  onRevise,
  onApplyFix,
  onEdit,
  onClose,
  closeLabel = "Back to the campaign",
}: {
  /** Names the queue itself — one campaign, or everything on your desk. The
   *  campaign each deliverable belongs to is carried per entry, because a
   *  cross-campaign queue moves between them as you work. */
  title: string;
  queue: ReviewQueueEntry[];
  pending: boolean;
  error: string | null;
  onDecide: (asset: CampaignWorkspaceAsset, decision: "approved" | "declined") => void;
  onRevise: (asset: CampaignWorkspaceAsset, instruction: string) => void;
  onApplyFix: (asset: CampaignWorkspaceAsset, finding: CampaignAssetFinding, value: string) => void;
  /** Editing is a different mode of work — it hands back to the list, which
   *  owns the editor, rather than growing a second one in here. */
  onEdit: (asset: CampaignWorkspaceAsset) => void;
  onClose: () => void;
  closeLabel?: string;
}) {
  const [index, setIndex] = useState(0);
  const [openFindings, setOpenFindings] = useState<Set<string>>(new Set());
  // Both keyed by deliverable, so moving through the queue does not need to
  // reset anything — a stale entry belongs to a piece that is not on screen.
  const [expandedCopy, setExpandedCopy] = useState<Set<string>>(new Set());
  const [revising, setRevising] = useState(false);
  const [reviseText, setReviseText] = useState("");
  const reviseRef = useRef<HTMLTextAreaElement>(null);
  const pendingMark = useRef<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Only for the closing message. Progress is counted off the live queue, which
  // cannot go stale; this is a single number reported once the queue is empty,
  // where "all of them were decided" is the only thing it can mean.
  const [startedWith] = useState(queue.length);

  const clamped = Math.min(index, Math.max(queue.length - 1, 0));
  const entry = queue[clamped];
  const asset = entry?.asset;

  useEffect(() => {
    if (revising) reviseRef.current?.focus();
  }, [revising]);

  useEffect(() => {
    const id = pendingMark.current;
    if (!id) return;
    pendingMark.current = null;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
  }, [openFindings]);

  const focusFinding = useCallback((id: string, findingIndex: number) => {
    const key = `${id}:${findingIndex}`;
    setOpenFindings((current) => {
      const next = new Set(current);
      if (next.delete(key)) return next;
      next.add(key);
      pendingMark.current = markId(id, findingIndex);
      return next;
    });
    setExpandedCopy((current) => new Set(current).add(id));
  }, []);

  /** Move the cursor, dropping any half-written revision with it — that text was
   *  about the deliverable you are leaving, and carrying it to the next one is
   *  how a note ends up attached to the wrong piece. */
  const move = useCallback(
    (action: "next" | "prev") => {
      setRevising(false);
      setReviseText("");
      setIndex((current) => stepQueueIndex(Math.min(current, Math.max(queue.length - 1, 0)), action, queue.length));
    },
    [queue.length],
  );

  const submitRevision = useCallback(() => {
    const instruction = reviseText.trim();
    if (!instruction || !asset || pending) return;
    onRevise(asset, instruction);
    setRevising(false);
    setReviseText("");
    // Approving or declining takes the deliverable out of the queue, so the next
    // one arrives on its own. A revision request does not — the piece is still
    // undecided and still belongs here — so this is the one action that has to
    // move the cursor itself.
    setIndex((current) => stepQueueIndex(current, "next", queue.length));
  }, [asset, onRevise, pending, queue.length, reviseText]);

  // Focus moves in so the shortcuts work without clicking first, and the page
  // behind stops scrolling, because this covers the shell rather than sitting
  // inside it.
  //
  // It is portaled for the same reason every other modal here is: `position:
  // fixed` inside a page is scoped to the CONTENT PANE, not the viewport,
  // because `.page-enter` carries a transform (see overlay-portal.tsx). This
  // component originally shipped rendering in place, with a comment calling
  // that a deliberate pane framing. It was not deliberate and it was not even
  // stable — the transform comes only from the entrance animation, and
  // `prefers-reduced-motion: reduce` sets `animation: none`, so the same
  // overlay covered the whole viewport for anyone who had asked for less
  // motion. A framing that flips on a motion preference is a bug wearing a
  // rationale.
  useEffect(() => {
    wrapRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const action = keyToQueueAction(event.key, {
        typing: isTypingTarget(event.target as HTMLElement | null),
        modifier: event.metaKey || event.ctrlKey || event.altKey,
      });
      if (!action) return;

      // Escape backs out one layer at a time: the revision box first, the queue
      // only once there is nothing half-written to lose.
      if (action === "close") {
        event.preventDefault();
        if (revising) {
          setRevising(false);
          setReviseText("");
          return;
        }
        onClose();
        return;
      }
      if (!asset || pending) return;
      event.preventDefault();
      if (action === "next" || action === "prev") {
        move(action);
        return;
      }
      if (action === "approve") onDecide(asset, "approved");
      else if (action === "decline") onDecide(asset, "declined");
      else if (action === "revise") setRevising(true);
      else if (action === "edit") onEdit(asset);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [asset, move, onClose, onDecide, onEdit, pending, revising]);

  if (!asset) {
    return (
      <OverlayPortal>
        <div className="arc-campaign rq-scope">
        <div className="rqwrap" ref={wrapRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Review ${title}`}>
          <div className="rqdone">
            <span className="rqtick" aria-hidden="true">
              {svg('<path d="M5 12l4 4L19 6"/>')}
            </span>
            <b>Everything here has a decision.</b>
            <p>
              {startedWith > 0
                ? `You worked through ${startedWith} deliverable${startedWith === 1 ? "" : "s"}. Nothing has gone out — approved work stays locked until launch.`
                : `Nothing in ${title} is waiting on you.`}
            </p>
            <button type="button" className="cbtn gold" onClick={onClose}>
              {closeLabel}
            </button>
          </div>
        </div>
        </div>
      </OverlayPortal>
    );
  }

  const summary = summarizeReview(asset);
  // Decided, not "how far down the list you scrolled". The count beside it is
  // position among what is left; this is the only thing on screen claiming
  // progress, so it has to mean progress.
  const decided = Math.max(startedWith - queue.length, 0);

  return (
    <OverlayPortal>
      <div className="arc-campaign rq-scope">
      <div className="rqwrap" ref={wrapRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Review ${title}`}>
        <div className="rqbar">
          <div className="rqcount">
            <b>{clamped + 1}</b> of {queue.length}
            <span className="rqname">{entry.campaignName}</span>
          </div>
          <div
            className="rqtrack"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={startedWith}
            aria-valuenow={decided}
            aria-label={`${decided} of ${startedWith} decided`}
          >
            <i style={{ width: `${startedWith ? Math.round((decided / startedWith) * 100) : 0}%` }} />
          </div>
          <button type="button" className="rqclose" onClick={onClose} aria-label="Close the review queue">
            {svg('<path d="M6 6l12 12M18 6L6 18"/>')}
          </button>
        </div>

        <div className="rqbody">
          <div className="rqcard">
            <div className="rqhead">
              <h2>{asset.title}</h2>
              <span className="rqchannel">{asset.channel}</span>
              {/* Without this, requesting a revision on the last deliverable in the
                  queue changes nothing on screen — there is nowhere to advance to,
                  and the state that did change was invisible. */}
              <span className={`pill ${statusMeta(asset.status).tone}`}>
                <span className="pd" />
                {statusMeta(asset.status).label}
              </span>
            </div>
            <ReviewBlock
              asset={asset}
              summary={summary}
              awaitingReview={!asset.claimsReviewed && Boolean(asset.body.trim())}
              openFindings={openFindings}
              onFocusFinding={focusFinding}
              onEditCopy={() => onEdit(asset)}
              onApplyFix={(finding, value) => onApplyFix(asset, finding, value)}
              pending={pending}
              canEdit
            />
            <DeliverableCopy
              asset={asset}
              expanded={expandedCopy.has(asset.id)}
              onToggle={() =>
                setExpandedCopy((current) => {
                  const next = new Set(current);
                  if (!next.delete(asset.id)) next.add(asset.id);
                  return next;
                })
              }
            />
          </div>
        </div>

        {error && <p className="rqerr">{error}</p>}

        <div className="rqfoot">
          {revising ? (
            <div className="rqrevise">
              <textarea
                ref={reviseRef}
                value={reviseText}
                onChange={(e) => setReviseText(e.target.value)}
                placeholder="Tell Arc what to change…"
                rows={2}
                disabled={pending}
              />
              <button className="cbtn ghost" onClick={() => { setRevising(false); setReviseText(""); }} disabled={pending}>
                Cancel
              </button>
              <button className="cbtn gold" onClick={submitRevision} disabled={pending || !reviseText.trim()}>
                Send to Arc
              </button>
            </div>
          ) : (
            <>
              <div className="rqacts">
                <button className="cbtn gold" onClick={() => onDecide(asset, "approved")} disabled={pending}>
                  {svg('<path d="M5 12l4 4L19 6"/>')}
                  Approve <kbd>A</kbd>
                </button>
                <button className="cbtn ghost" onClick={() => onEdit(asset)} disabled={pending}>
                  Edit <kbd>E</kbd>
                </button>
                <button className="cbtn ghost" onClick={() => setRevising(true)} disabled={pending}>
                  Request revision <kbd>R</kbd>
                </button>
                <button className="cbtn danger" onClick={() => onDecide(asset, "declined")} disabled={pending}>
                  Decline <kbd>D</kbd>
                </button>
              </div>
              <div className="rqnav">
                <button
                  type="button"
                  className="rqstep"
                  onClick={() => move("prev")}
                  disabled={clamped === 0}
                  aria-label="Previous deliverable"
                >
                  {svg('<path d="M15 6l-6 6 6 6"/>')}
                </button>
                <span className="rqhint">
                  <kbd>J</kbd>
                  <kbd>K</kbd> move · <kbd>Esc</kbd> close
                </span>
                <button
                  type="button"
                  className="rqstep"
                  onClick={() => move("next")}
                  disabled={clamped >= queue.length - 1}
                  aria-label="Next deliverable"
                >
                  {svg('<path d="M9 6l6 6-6 6"/>')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      </div>
    </OverlayPortal>
  );
}

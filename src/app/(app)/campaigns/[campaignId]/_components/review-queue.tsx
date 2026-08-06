"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { composeRevisionInstruction, truncateQuote } from "@/domain";
import { type CampaignAssetFinding, type CampaignWorkspaceAsset, type ReviewQueueEntry } from "@/lib/campaigns/read-model";

import { OverlayPortal } from "../../../_components/overlay-portal";

import { DeliverableCopy, markId, ReviewBlock, statusMeta, svg } from "./deliverable-review";
import { pieceLabel } from "../../_components/board-derivations";
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
  onSaveCopy,
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
  /** Save an edit to the draft in place. Omitted → the draft is read-only. */
  onSaveCopy?: (asset: CampaignWorkspaceAsset, body: string) => void;
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
  /** The passage the reviewer pointed at, carried into the revision request. */
  const [quote, setQuote] = useState<string | null>(null);
  // The selection listener is bound once, so it reads the mode through a ref.
  // Written in an effect, not during render — a ref mutated while rendering is
  // a value React cannot see, and the lint rule that catches it is right.
  // Effects flush long before any user selection event, so it is never stale
  // when the listener reads it.
  const revisingRef = useRef(false);
  useEffect(() => {
    revisingRef.current = revising;
  }, [revising]);

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
      // The quote belongs to the deliverable being left, for the same reason
      // the half-written instruction does.
      setQuote(null);
      setIndex((current) => stepQueueIndex(Math.min(current, Math.max(queue.length - 1, 0)), action, queue.length));
    },
    [queue.length],
  );

  const submitRevision = useCallback(() => {
    const instruction = reviseText.trim();
    if (!instruction || !asset || pending) return;
    // The quote is composed in HERE rather than prefilled into the box, so the
    // operator's words stay theirs and the quote stays byte-identical to the
    // draft — which is the one property that makes it useful to Arc. With no
    // selection this is exactly the string it always was.
    onRevise(asset, composeRevisionInstruction({ quote, instruction }));
    setRevising(false);
    setReviseText("");
    setQuote(null);
    // Approving or declining takes the deliverable out of the queue, so the next
    // one arrives on its own. A revision request does not — the piece is still
    // undecided and still belongs here — so this is the one action that has to
    // move the cursor itself.
    setIndex((current) => stepQueueIndex(current, "next", queue.length));
  }, [asset, onRevise, pending, queue.length, reviseText]);

  /**
   * What the reviewer has selected in the draft, if anything.
   *
   * Two selection models, because the draft is rendered two ways. An undecided
   * deliverable is a transparent `<textarea>` laid over the highlight marks
   * (see `DeliverableCopy`), where the selection lives in
   * `selectionStart/selectionEnd` and `window.getSelection()` returns nothing.
   * A decided one is ordinary text, where the opposite is true. Reading only
   * one of them would make the feature work on exactly half the queue — and
   * the half it would miss is the half you actually review.
   *
   * Scoped to the draft: selecting Arc's own finding text, or the title, is
   * reading rather than pointing at something to change.
   */
  useEffect(() => {
    function read() {
      const panel = wrapRef.current;
      if (!panel) return;
      // Committed once the instruction is being written. Clicking into the
      // textarea collapses the selection, and the quote must survive that.
      if (revisingRef.current) return;

      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement && active.classList.contains("dlive-ta") && panel.contains(active)) {
        const { selectionStart, selectionEnd, value } = active;
        const picked = selectionStart === selectionEnd ? "" : value.slice(selectionStart ?? 0, selectionEnd ?? 0);
        setQuote(picked.trim() ? picked : null);
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setQuote(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const container =
        range.commonAncestorContainer.nodeType === 1
          ? (range.commonAncestorContainer as Element)
          : range.commonAncestorContainer.parentElement;
      if (!container || !panel.contains(container) || !container.closest(".dcopy")) {
        setQuote(null);
        return;
      }
      const picked = selection.toString();
      setQuote(picked.trim() ? picked : null);
    }

    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  }, []);

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
        <div className="rqwrap">
        <div className="rqpanel is-done" ref={wrapRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Review ${title}`}>
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
      {/* Backdrop and panel are separate elements: the backdrop dims and blurs
          the page behind, the panel is the dialog. Putting `role="dialog"` on a
          full-bleed backdrop would tell a screen reader the dialog is the whole
          screen, which is also what it used to look like.

          Clicking the backdrop closes, on the SAME rule Escape already uses:
          back out one layer at a time, and never over half-written revision
          text. There was no backdrop to click when this was a full takeover, so
          the affordance is new — leaving it inert would read as broken. */}
      <div
        className="rqwrap"
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          if (revising) {
            setRevising(false);
            setReviseText("");
            return;
          }
          onClose();
        }}
      >
      <div className="rqpanel" ref={wrapRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Review ${title}`}>
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
              {/* The bar above already names the campaign; repeating it here and
                  then tagging the channel separately said one thing three times.
                  `pieceLabel` strips the parent, exactly as on the board. */}
              <h2>{pieceLabel(asset.title, entry.campaignName, asset.channel).label}</h2>
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
              placement="verdict"
            />
            {/* The draft sits between the verdict and the argument: you get the
                answer, then the thing itself, then why. It used to open with a
                critique of a document the reader had not seen. */}
            <DeliverableCopy
              asset={asset}
              // Undecided only, on the same effective status the pill above
              // reads. Editing copy that has already been approved would be a
              // quiet way around the approval gate.
              onSave={onSaveCopy && !/approved|declined|rejected|archived/i.test(asset.approval?.status ?? asset.status)
                ? (body) => onSaveCopy(asset, body)
                : undefined}
              saving={pending}
              expanded={expandedCopy.has(asset.id)}
              onToggle={() =>
                setExpandedCopy((current) => {
                  const next = new Set(current);
                  if (!next.delete(asset.id)) next.add(asset.id);
                  return next;
                })
              }
            />
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
              placement="detail"
            />
          </div>
        </div>

        {error && <p className="rqerr">{error}</p>}

        {/* Select a passage and the ask becomes about that passage. It sits
            above the actions rather than floating at the caret: the draft is a
            transparent textarea over a highlight layer, so there are no
            selection rects to anchor to, and a mirror-measured popover would be
            a lot of geometry to get subtly wrong. This is always in the same
            place, which is easier to learn and impossible to miss. */}
        {quote && !revising && (
          <div className="rqsel">
            <span className="rqsel-q">“{truncateQuote(quote, 120)}”</span>
            <button
              type="button"
              className="cbtn rqsel-go"
              // Mousedown is what collapses the selection, and the collapse
              // fires `selectionchange`, which cleared the quote before the
              // click ever landed — the box opened with nothing attached.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setRevising(true)}
              disabled={pending}
            >
              Revise this part
            </button>
            <button type="button" className="cbtn ghost" onClick={() => setQuote(null)} disabled={pending}>
              Clear
            </button>
          </div>
        )}

        <div className="rqfoot">
          {revising ? (
            <div className="rqrevise">
              {quote && (
                <span className="rqsel-tag" title={quote}>
                  About “{truncateQuote(quote, 60)}”
                </span>
              )}
              <textarea
                ref={reviseRef}
                value={reviseText}
                onChange={(e) => setReviseText(e.target.value)}
                placeholder={quote ? "What should change about it?" : "Tell Arc what to change…"}
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
              {/* The shortcuts still work — A / E / R / D — they are just not
                  printed on the buttons any more. A badge on every control put
                  four pieces of chrome in front of the one row that asks for a
                  decision, and taught the shortcut to people who were never
                  going to use it at the cost of everyone reading the label. */}
              <div className="rqacts">
                <button className="cbtn gold" onClick={() => onDecide(asset, "approved")} disabled={pending} title="Approve (A)">
                  {svg('<path d="M5 12l4 4L19 6"/>')}
                  Approve
                </button>
                <button className="cbtn ghost" onClick={() => onEdit(asset)} disabled={pending} title="Edit (E)">
                  Edit
                </button>
                <button className="cbtn ghost" onClick={() => setRevising(true)} disabled={pending} title="Request revision (R)">
                  Request revision
                </button>
                <button className="cbtn danger" onClick={() => onDecide(asset, "declined")} disabled={pending} title="Decline (D)">
                  Decline
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
      </div>
    </OverlayPortal>
  );
}

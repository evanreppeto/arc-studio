"use client";

/**
 * What Arc made, rendered as the thing it will actually ship as.
 *
 * The chat used to render an approval-gated deliverable as a one-line receipt
 * pointing at a 390px rail. The first fix put the copy in the thread; this one
 * fixes how it reads, because putting it there exposed three problems the
 * receipt had been hiding:
 *
 * 1. **Two titles competed.** Every card led with a label Arc invented for the
 *    asset ("Demo follow-up email") and demoted the email's real subject line to
 *    a row in an uppercase label column. The first thing a reviewer reads is the
 *    subject; it was styled like a database field.
 * 2. **Every medium looked identical.** An SMS, a landing page and a display ad
 *    all rendered as the same bordered box with the same label table. Nothing on
 *    screen said what would ship.
 * 3. **A four-asset package was ~2000px of scroll** with no way to put a decided
 *    one away.
 *
 * So: `DeliverableCanvas` renders each medium as itself — an email as an email,
 * a text as a phone bubble with its character count, an ad as an ad unit with
 * its CTA. The card's own chrome shrinks to a channel line and a status, because
 * the content now carries its own headline. Decided cards collapse to a row.
 *
 * And the deep read is a two-level overlay — an index of the set, and a detail
 * view you can get BACK from — rather than a single view whose only exit was a
 * close button.
 */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  PencilLine,
  ShieldQuestion,
  Undo2,
  X,
} from "lucide-react";

import {
  ARC_CHECK_LABEL,
  arcDeliverableMedium,
  arcDraftCheckState,
  ARC_SEVERITY_TONE,
  ARC_MEDIUM_LABEL,
  ASSET_NOUN,
  countOf,
  isLongDraftBody,
  parseArcDraftContent,
  type ArcActionCard,
  type ArcAssetStatus,
  type ArcDeliverableMedium,
  type ArcDraftContent,
  type ArcDraftFinding,
  type ArcMedia,
} from "@/domain";
import type { ArcAssetBody } from "@/lib/campaigns/read-model";

import { undoArcDraftDecisionAction } from "../actions";
import { OverlayPortal } from "../../_components/overlay-portal";
import { assetStatusMeta, ChannelIcon, isDecidedAssetStatus, useDraftDecision } from "./arc-messages";
import type { PaneBox } from "./arc-view.types";

const CLAMP_LINES = 10;

/** The copy to show: the live asset body if we hold it, else the card's own
 *  ~280-character stored preview. Never nothing. */
function resolveDraftText(card: ArcActionCard, bodies: Record<string, ArcAssetBody>): { text: string; full: boolean } {
  const fetched = bodies[card.approval?.assetId ?? ""]?.body;
  if (fetched) return { text: fetched, full: true };
  return { text: card.preview ?? "", full: false };
}

/**
 * What to call a deliverable, best source first.
 *
 * The copy's own headline wins — it is the thing itself. Then the asset's LIVE
 * title, because the card's is frozen at draft time and drifts: on prod, cards
 * still read "needs revision (placeholder)" for drafts Arc has since revised.
 * The frozen title is the last resort, not the default.
 */
function deliverableHeading(
  card: ArcActionCard,
  content: ArcDraftContent,
  bodies: Record<string, ArcAssetBody>,
): string {
  return content.headline ?? bodies[card.approval?.assetId ?? ""]?.title ?? card.title;
}

/** Pull a named lead-in field out of the parsed content, case-insensitively. */
function field(content: ArcDraftContent, label: string): string | undefined {
  return content.fields.find((f) => f.label.toLowerCase() === label.toLowerCase())?.value;
}

/* ── Media ──────────────────────────────────────────────────────────────── */

/** A deliverable's own creative. Renders nothing rather than a broken frame — an
 *  image that 404s says less than no image at all. */
function DeliverableMedia({ media, className }: { media: ArcMedia; className?: string }) {
  const [failed, setFailed] = useState(false);
  const poster = media.poster ?? media.thumbnailUrl;
  const src = media.kind === "video" ? poster : media.thumbnailUrl ?? media.url;
  if (failed || (!src && media.kind !== "video")) return null;

  return (
    <figure className={`arc-dlv-media${className ? ` ${className}` : ""}`} data-kind={media.kind}>
      {media.kind === "video" && media.url ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- generated creative; the copy below is the caption
        <video src={media.url} poster={poster} controls preload="metadata" onError={() => setFailed(true)} />
      ) : (
        // Signed asset URLs aren't in next/image's configured remote patterns.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={media.alt ?? ""} loading="lazy" onError={() => setFailed(true)} />
      )}
      {media.caption ? <figcaption>{media.caption}</figcaption> : null}
    </figure>
  );
}

/* ── Per-medium canvases ────────────────────────────────────────────────── */
/* Each renders the SAME parsed content; only the arrangement differs. None of
   them invent copy — a field that isn't in the draft simply doesn't render. */

function EmailCanvas({ content, card }: { content: ArcDraftContent; card: ArcActionCard }) {
  const subject = field(content, "Subject");
  const preheader = field(content, "Preheader");
  return (
    <div className="arc-dlv-email">
      <div className="arc-dlv-email-head">
        {subject ? <h4>{subject}</h4> : null}
        {preheader ? <p>{preheader}</p> : null}
      </div>
      {card.media ? <DeliverableMedia media={card.media} /> : null}
      {content.body ? <div className="arc-dlv-prose">{content.body}</div> : null}
    </div>
  );
}

/**
 * A text message, as a text message. The character count is the one number that
 * decides whether an SMS ships as one segment or three, so it is on the bubble
 * rather than buried in a details table.
 */
function SmsCanvas({ content, card }: { content: ArcDraftContent; card: ArcActionCard }) {
  const text = content.body || content.fields.map((f) => f.value).join(" ");
  return (
    <div className="arc-dlv-sms">
      <div className="arc-dlv-sms-bubble">{text}</div>
      <span className="arc-dlv-sms-meta">{card.format ?? `${text.length} characters`}</span>
    </div>
  );
}

function SocialCanvas({ content, card }: { content: ArcDraftContent; card: ArcActionCard }) {
  const headline = field(content, "Headline");
  const primary = field(content, "Primary text");
  const cta = field(content, "Call to action");
  const platform = field(content, "Platform");
  return (
    <div className="arc-dlv-ad">
      {card.media ? <DeliverableMedia media={card.media} className="is-ad" /> : null}
      <div className="arc-dlv-ad-copy">
        {headline ? <h4>{headline}</h4> : null}
        {primary ? <p>{primary}</p> : null}
        {content.body ? <div className="arc-dlv-prose is-tight">{content.body}</div> : null}
        {cta || platform ? (
          <div className="arc-dlv-ad-foot">
            {cta ? <span className="arc-dlv-cta">{cta}</span> : null}
            {platform ? <small>{platform}</small> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PageCanvas({ content, card }: { content: ArcDraftContent; card: ArcActionCard }) {
  const h1 = field(content, "Headline");
  const subhead = field(content, "Subhead");
  return (
    <div className="arc-dlv-page">
      <div className="arc-dlv-page-hero">
        {h1 ? <h4>{h1}</h4> : null}
        {subhead ? <p>{subhead}</p> : null}
      </div>
      {card.media ? <DeliverableMedia media={card.media} /> : null}
      {content.body ? <div className="arc-dlv-prose">{content.body}</div> : null}
    </div>
  );
}

/** A document renders on a sheet, monospaced-adjacent, because the ALL-CAPS
 *  section headings the runner writes for one-pagers are structure, not shouting. */
function DocCanvas({ content, card }: { content: ArcDraftContent; card: ArcActionCard }) {
  const title = field(content, "Title");
  return (
    <div className="arc-dlv-doc">
      {title ? <h4>{title}</h4> : null}
      {card.media ? <DeliverableMedia media={card.media} /> : null}
      {content.body ? <div className="arc-dlv-prose is-doc">{content.body}</div> : null}
    </div>
  );
}

function GenericCanvas({ content, card }: { content: ArcDraftContent; card: ArcActionCard }) {
  return (
    <div className="arc-dlv-generic">
      {content.fields.length > 0 ? (
        <dl className="arc-dlv-fields">
          {content.fields.map((f) => (
            <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>
          ))}
        </dl>
      ) : null}
      {card.media ? <DeliverableMedia media={card.media} /> : null}
      {content.body ? <div className="arc-dlv-prose">{content.body}</div> : null}
    </div>
  );
}

const CANVASES: Record<ArcDeliverableMedium, typeof EmailCanvas> = {
  email: EmailCanvas,
  sms: SmsCanvas,
  social: SocialCanvas,
  page: PageCanvas,
  doc: DocCanvas,
  generic: GenericCanvas,
};

/** The deliverable itself, laid out as its medium. */
export function DeliverableCanvas({ card, content }: { card: ArcActionCard; content: ArcDraftContent }) {
  const medium = arcDeliverableMedium({ channel: card.channel, format: card.format });
  const Canvas = CANVASES[medium];
  return (
    <div className="arc-dlv-canvas" data-medium={medium}>
      <Canvas content={content} card={card} />
    </div>
  );
}

/**
 * What Arc checked, including when it checked nothing.
 *
 * The chat used to render `flags` when present and nothing when absent. On prod
 * that meant silence for 13 of 16 draft cards — the operator could not tell an
 * inspected draft from an uninspected one, on the screen where they decide
 * whether copy reaches a customer. `unchecked` gets its own colourless tone and
 * never borrows the "passed" green.
 */
function DraftChecks({ flags, findings, limit }: { flags: ArcActionCard["flags"]; findings?: ArcDraftFinding[]; limit?: number }) {
  const state = arcDraftCheckState({ flags, findings });
  // Nothing loaded yet: say nothing. Claiming "no checks recorded" here is the
  // bug this replaced — it was false for exactly the drafts that had findings.
  if (state === "unknown") return null;

  const open = (findings ?? []).filter((f) => f.open);
  const shown = limit ? open.slice(0, limit) : open;

  return (
    <div className="arc-dlv-flags" data-check={state}>
      {state === "unchecked" ? (
        <span className="arc-dlv-unchecked" title="No guardrail result is recorded against this draft. Read it before approving.">
          <ShieldQuestion size={12} />{ARC_CHECK_LABEL.unchecked}
        </span>
      ) : null}
      {shown.map((f) => (
        <span key={f.id} className={`arc-action-flag is-${ARC_SEVERITY_TONE[f.severity]}`} title={f.matchedText ? `Matched: ${f.matchedText}` : undefined}>
          {f.message}
        </span>
      ))}
      {limit && open.length > limit ? <span className="arc-dlv-more-findings">+{open.length - limit} more</span> : null}
      {/* The card's own frozen flags still render when there is nothing live to
          show — they are a real record of what Arc checked at draft time. */}
      {open.length === 0
        ? (limit ? flags.slice(0, limit) : flags).map((flag, index) => (
            <span key={`${flag.label}-${index}`} className={`arc-action-flag is-${flag.tone}`}>{flag.label}</span>
          ))
        : null}
    </div>
  );
}

/* ── Decisions ──────────────────────────────────────────────────────────── */

/** Approve / Revise / Decline plus the revise composer. One component so the
 *  wording and the disabled gating can never drift between the two surfaces. */
function DecisionBar({
  card,
  decision,
  status,
  children,
}: {
  card: ArcActionCard;
  decision: ReturnType<typeof useDraftDecision>;
  status: ArcAssetStatus | null;
  children?: React.ReactNode;
}) {
  const { busy, notice, reviseOpen, reviseText, setReviseText, decided, decide, submitRevision, openRevise, cancelRevise } = decision;
  const id = card.approval?.assetId ?? card.title;

  if (reviseOpen) {
    return (
      <form className="arc-dlv-revise" onSubmit={submitRevision}>
        <label htmlFor={`arc-revise-${id}`}>What should Arc change in the {(card.channel ?? "draft").toLowerCase()}?</label>
        <textarea
          id={`arc-revise-${id}`}
          autoFocus
          rows={3}
          value={reviseText}
          onChange={(event) => setReviseText(event.target.value)}
          placeholder="Describe the change…"
        />
        <div>
          <button type="button" onClick={cancelRevise}>Cancel</button>
          <button type="submit" className="is-primary" disabled={!reviseText.trim() || busy}>Send revision</button>
        </div>
      </form>
    );
  }

  return (
    <div className="arc-dlv-decide" aria-busy={busy}>
      <span className="arc-dlv-notice" role="status" aria-live="polite">{notice ?? ""}</span>
      {children}
      <button type="button" className="is-quiet" onClick={() => decide("declined")} disabled={busy || decided}>Decline</button>
      <button type="button" className="is-quiet" onClick={openRevise} disabled={busy || decided}><PencilLine size={13} /> Revise</button>
      <button type="button" className="is-primary" onClick={() => decide("approved")} disabled={busy || decided}>
        <Check size={14} /> {status === "approved" ? "Approved" : "Approve"}
      </button>
    </div>
  );
}

/* ── The inline card ────────────────────────────────────────────────────── */

/**
 * One drafted deliverable, in the conversation.
 *
 * Clamped rather than unbounded — a package stacks these, and an unclamped stack
 * buries the composer. The disclosure is offered on what the CONTENT says
 * (`isLongDraftBody`), never on a DOM measurement: asking the layout whether it
 * clipped is exactly the read the preview pane freezes.
 *
 * Once decided, the card collapses to a single row. An approved draft is no
 * longer something to read, and leaving four settled ones at full height is how
 * the thread became 2000px of scroll.
 */
export function InlineDeliverable({
  card,
  status,
  bodies,
  checks,
  onStatus,
  onOpen,
  onContextMenu,
}: {
  card: ArcActionCard;
  status: ArcAssetStatus | null;
  bodies: Record<string, ArcAssetBody>;
  /** Live findings by asset id. A MISSING key means not loaded; an empty array
   *  means loaded with none — see arcDraftCheckState. */
  checks: Record<string, ArcDraftFinding[]>;
  onStatus: (assetId: string, status: ArcAssetStatus) => void;
  onOpen: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // A decided card collapses, but the operator can still open it back up — the
  // collapse is a default, not a lock.
  const [reopened, setReopened] = useState(false);
  const meta = assetStatusMeta(status);
  const { text, full } = resolveDraftText(card, bodies);
  const content = parseArcDraftContent(text);
  const decision = useDraftDecision({ approval: card.approval, status, onResolved: onStatus });
  const medium = arcDeliverableMedium({ channel: card.channel, format: card.format });
  const findings = checks[card.approval?.assetId ?? ""];
  const collapsed = isDecidedAssetStatus(status) && !reopened;

  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  /** Take the decision back. Append-only server-side: it records a `reverted`
   *  row and restores the previous status — it never deletes history and never
   *  unlocks outbound, so undo cannot send anything. */
  const undo = () => {
    const assetId = card.approval?.assetId;
    if (!assetId || undoing) return;
    setUndoing(true);
    setUndoError(null);
    undoArcDraftDecisionAction({ assetId }).then((result) => {
      setUndoing(false);
      if (!result.ok) return setUndoError(result.error);
      // Back to undecided, which un-collapses the card on the next render.
      onStatus(assetId, "draft");
      setReopened(false);
    });
  };

  // Only offer "Show more" once we hold copy that has more to show. While the
  // card is on its stored preview the honest control is "Open" — the rest of the
  // text is not in the browser yet.
  const canExpand = full && isLongDraftBody(content.body, CLAMP_LINES);
  // Live asset title beats the card's frozen one: on prod, cards still read
  // "needs revision (placeholder)" for drafts Arc has since revised. The
  // content's own headline still wins over both — it is the copy itself.
  const heading = deliverableHeading(card, content, bodies);

  if (collapsed) {
    return (
      /* Not a <button>: it carries its own Undo control, and a button inside a
         button is invalid and unreachable by keyboard. */
      <div className="arc-dlv-collapsed" data-status={status ?? "review"} onContextMenu={onContextMenu}>
        <button type="button" className="arc-dlv-collapsed-open" onClick={() => setReopened(true)} aria-label={`Reopen ${heading}`}>
          <span className="arc-dlv-collapsed-icon"><ChannelIcon channel={card.channel} size={14} /></span>
          <span className="arc-dlv-collapsed-title"><b>{heading}</b><small>{ARC_MEDIUM_LABEL[medium]}</small></span>
          <em className={`arc-dlv-status is-${meta.tone}`}><i />{meta.label}</em>
          <ChevronDown size={14} />
        </button>
        {/* The decision is reversible, and this row is where a misclick ends up
            — approving both commits it and hides the thing it was made about. */}
        <button type="button" className="arc-dlv-undo" onClick={undo} disabled={undoing}>
          <Undo2 size={12} />{undoing ? "Undoing…" : "Undo"}
        </button>
        {undoError ? <span className="arc-dlv-undo-error" role="status">{undoError}</span> : null}
      </div>
    );
  }

  return (
    <article className="arc-dlv" data-status={status ?? "review"} data-medium={medium} onContextMenu={onContextMenu}>
      {/* Chrome is deliberately thin: a channel line and a status. The content
          below carries its own headline, and two headlines compete. */}
      <header className="arc-dlv-head">
        <span className="arc-dlv-kind"><ChannelIcon channel={card.channel} size={13} />{ARC_MEDIUM_LABEL[medium]}{card.format ? <small>{card.format}</small> : null}</span>
        <em className={`arc-dlv-status is-${meta.tone}`}><i />{meta.label}</em>
        <button type="button" className="arc-dlv-expand" data-arc-review-trigger="true" onClick={onOpen} aria-label={`Open ${heading} full screen`}>
          <Maximize2 size={14} />
        </button>
      </header>

      <div className="arc-dlv-body" data-clamped={expanded || !canExpand ? "false" : "true"}>
        <DeliverableCanvas card={card} content={content} />
      </div>

      {canExpand ? (
        <button type="button" className="arc-dlv-more" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          <ChevronDown size={13} />{expanded ? "Show less" : "Show more"}
        </button>
      ) : null}

      {/* Always rendered, including when there is nothing to report — an empty
          flag list used to render nothing at all, which made a draft nobody had
          checked look exactly like one that passed. */}
      <DraftChecks flags={card.flags} findings={findings} limit={4} />

      <footer className="arc-dlv-foot">
        <DecisionBar card={card} decision={decision} status={status} />
      </footer>
    </article>
  );
}

/**
 * The campaign package header. It carries the count and the way into the deep
 * read — the channel strip it used to show was a table of contents for content
 * that now renders directly underneath it.
 */
export function DeliverablePackageHead({
  cards,
  statuses,
  onReviewAll,
  onContextMenu,
}: {
  cards: ArcActionCard[];
  statuses: Record<string, ArcAssetStatus>;
  onReviewAll: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  const approved = cards.filter((card) => (statuses[card.approval?.assetId ?? ""] ?? card.status) === "approved").length;
  return (
    <div className="arc-dlv-package" onContextMenu={onContextMenu}>
      <span><b>{countOf(cards.length, ASSET_NOUN)}</b><small>{approved} of {cards.length} approved</small></span>
      <button type="button" data-arc-review-trigger="true" onClick={onReviewAll}>
        <Maximize2 size={13} /> Review all
      </button>
    </div>
  );
}

/* ── The deep read ──────────────────────────────────────────────────────── */

/** A tile in the overlay's index — a real preview of the deliverable, not a
 *  filename in a list. */
function IndexTile({
  card,
  status,
  bodies,
  onOpen,
}: {
  card: ArcActionCard;
  status: ArcAssetStatus | null;
  bodies: Record<string, ArcAssetBody>;
  onOpen: () => void;
}) {
  const meta = assetStatusMeta(status);
  const medium = arcDeliverableMedium({ channel: card.channel, format: card.format });
  const { text } = resolveDraftText(card, bodies);
  const content = parseArcDraftContent(text);
  return (
    <button type="button" className="arc-dlv-tile" data-medium={medium} data-status={status ?? "review"} onClick={onOpen}>
      <span className="arc-dlv-tile-head">
        <span className="arc-dlv-kind"><ChannelIcon channel={card.channel} size={12} />{ARC_MEDIUM_LABEL[medium]}</span>
        <em className={`arc-dlv-status is-${meta.tone}`}><i />{meta.label}</em>
      </span>
      <span className="arc-dlv-tile-preview" aria-hidden="true">
        <DeliverableCanvas card={card} content={content} />
      </span>
      <span className="arc-dlv-tile-foot">{deliverableHeading(card, content, bodies)}</span>
    </button>
  );
}

/**
 * The deep read, as two levels rather than one.
 *
 * The first version of this had exactly one exit — a close button — so opening a
 * deliverable from a set of four stranded you: no way back to the set, no way to
 * the next one, nothing to press but ✕. Now it opens on an INDEX of the set, a
 * tile per deliverable showing its real content, and a tile opens the detail
 * view with a back control that names where it goes. Single-asset opens skip
 * straight to detail, where back returns to the conversation.
 *
 * Positioned from a measured `PaneBox`: it portals to the shell, so it cannot be
 * absolute inside a pane it has left, and `fixed` would anchor to `.page-enter`'s
 * transform instead.
 */
export function DeliverableReview({
  cards,
  statuses,
  bodies,
  checks,
  paneBox,
  returnLabel,
  onStatus,
  onClose,
}: {
  cards: ArcActionCard[];
  statuses: Record<string, ArcAssetStatus>;
  bodies: Record<string, ArcAssetBody>;
  checks: Record<string, ArcDraftFinding[]>;
  paneBox: PaneBox | null;
  /** Where closing returns to, when that isn't the conversation — e.g. the
   *  workspace sidebar the operator selected this from. */
  returnLabel?: string;
  onStatus: (assetId: string, status: ArcAssetStatus) => void;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  // A set opens on its index; a single deliverable has no index worth showing.
  const [active, setActive] = useState<number | null>(cards.length > 1 ? null : 0);
  const showingIndex = active === null;
  const index = active === null ? 0 : Math.min(active, cards.length - 1);
  const card = cards[index]!;
  const assetId = card.approval?.assetId ?? "";
  const status = statuses[assetId] ?? card.status ?? null;
  const meta = assetStatusMeta(status);
  const approved = cards.filter((c) => (statuses[c.approval?.assetId ?? ""] ?? c.status) === "approved").length;
  const decision = useDraftDecision({ approval: card.approval, status, onResolved: onStatus });
  const { reset } = decision;
  const { text } = resolveDraftText(card, bodies);
  const content = parseArcDraftContent(text);
  const findings = checks[assetId];
  const medium = arcDeliverableMedium({ channel: card.channel, format: card.format });

  /** Back goes UP a level: detail → index when there is one, else out to chat. */
  const goBack = useCallback(() => {
    if (!showingIndex && cards.length > 1) { setActive(null); reset(); return; }
    onClose();
  }, [showingIndex, cards.length, onClose, reset]);

  const step = useCallback((delta: number) => {
    setActive((current) => {
      if (current === null) return current;
      return (current + delta + cards.length) % cards.length;
    });
    reset();
  }, [cards.length, reset]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Never steal the arrow keys from the revise textarea.
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "TEXTAREA" || target?.tagName === "INPUT";
      if (event.key === "Escape") return goBack();
      if (typing || showingIndex || cards.length < 2) return;
      if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [goBack, step, showingIndex, cards.length]);

  const returningToIndex = !showingIndex && cards.length > 1;
  // Closing lands wherever the operator opened this from. Selecting a
  // deliverable in the workspace sidebar leaves that sidebar open underneath, so
  // "Back to chat" would name a place this button does not go.
  const exitLabel = returnLabel ?? "Back to chat";
  const backLabel = returningToIndex ? `All ${countOf(cards.length, ASSET_NOUN)}` : exitLabel;
  // Spelled out for a screen reader: the visible label is a destination, and out
  // of context "All 4 assets" doesn't say it is the way back to them.
  const backAria = returningToIndex
    ? `Back to all ${countOf(cards.length, ASSET_NOUN)}`
    : returnLabel ? `Back to ${returnLabel.toLowerCase()}` : "Back to the conversation";

  return (
    <OverlayPortal>
      <motion.button
        type="button"
        className="arc-dlv-scrim"
        aria-label="Close review"
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reduceMotion ? undefined : { opacity: 0 }}
        onClick={onClose}
      />
      <motion.section
        className="arc-dlv-review"
        role="dialog"
        aria-modal="true"
        aria-label="Review what Arc drafted"
        style={paneBox ? { top: paneBox.top, left: paneBox.left, width: paneBox.width, height: paneBox.height } : undefined}
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduceMotion ? undefined : { opacity: 0, y: 6 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <header className="arc-dlv-review-head">
          <button type="button" className="arc-dlv-back" onClick={goBack} aria-label={backAria} autoFocus>
            <ArrowLeft size={15} />{backLabel}
          </button>
          <div className="arc-dlv-review-title">
            <h2>{showingIndex ? "Campaign deliverables" : deliverableHeading(card, content, bodies)}</h2>
            <p>{showingIndex ? `${countOf(cards.length, ASSET_NOUN)} · ${approved} approved` : `${ARC_MEDIUM_LABEL[medium]}${card.format ? ` · ${card.format}` : ""}`}</p>
          </div>
          {!showingIndex && cards.length > 1 ? (
            <div className="arc-dlv-step">
              <button type="button" onClick={() => step(-1)} aria-label="Previous deliverable"><ChevronLeft size={16} /></button>
              <span>{index + 1} / {cards.length}</span>
              <button type="button" onClick={() => step(1)} aria-label="Next deliverable"><ChevronRight size={16} /></button>
            </div>
          ) : null}
          <button type="button" className="arc-dlv-close" onClick={onClose} aria-label="Close review"><X size={18} /></button>
        </header>

        <div className="arc-dlv-review-body">
          <AnimatePresence mode="wait" initial={false}>
            {showingIndex ? (
              <motion.div
                key="index"
                className="arc-dlv-index"
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
                transition={{ duration: 0.16 }}
              >
                {cards.map((tile, tileIndex) => (
                  <IndexTile
                    key={`${tile.approval?.assetId ?? tile.title}-${tileIndex}`}
                    card={tile}
                    status={statuses[tile.approval?.assetId ?? ""] ?? tile.status ?? null}
                    bodies={bodies}
                    onOpen={() => { setActive(tileIndex); reset(); }}
                  />
                ))}
              </motion.div>
            ) : (
              <motion.div
                key={`detail-${index}`}
                className="arc-dlv-detail"
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
                transition={{ duration: 0.16 }}
              >
                {/* The deliverable reads at its own measure; the review context
                    that used to stack below it now sits beside it, which is what
                    the pane's width was going to waste on margins. */}
                <div className="arc-dlv-detail-main">
                  <DeliverableCanvas card={card} content={content} />
                </div>
                <aside className="arc-dlv-detail-side">
                  <section>
                    <h4>Status</h4>
                    <em className={`arc-dlv-status is-${meta.tone}`}><i />{meta.label}</em>
                  </section>
                  {card.rows.length > 0 ? (
                    <section>
                      <h4>Details</h4>
                      {card.rows.slice(0, 8).map((row, rowIndex) => (
                        <div className="arc-dlv-detail-row" key={`${row.name}-${rowIndex}`}><b>{row.name}</b><span>{row.meta ?? ""}</span></div>
                      ))}
                    </section>
                  ) : null}
                  <section>
                    <h4>Checks</h4>
                    <DraftChecks flags={card.flags} findings={findings} />
                  </section>
                </aside>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {!showingIndex ? (
          <footer className="arc-dlv-review-foot">
            <DecisionBar card={card} decision={decision} status={status} />
          </footer>
        ) : null}
      </motion.section>
    </OverlayPortal>
  );
}

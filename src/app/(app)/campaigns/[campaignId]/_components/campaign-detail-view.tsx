"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  ASSET_NOUN,
  assetSourceLabel,
  countOf,
  composeMediaNote,
  deriveCampaignSpine,
  describeRegion,
  formatTimecode,
  isMeaningfulRegion,
  normalizeRegion,
  type MediaRegion,
  humanizePersonaLabel as humanizePersona,
  reviewAgentLabel,
  reviewVerdictLabel,
  riskFlagLabel,
  toWorkState,
  WORK_STATE_LABEL,
  type AssetDecision,
  WORK_STATE_TONE,
  type AudienceResolution,
  type WorkStateTone,
} from "@/domain";
import { type AttachableMediaItem } from "@/lib/campaigns/attach-media";
import {
  type CampaignAssetFinding,
  type CampaignMediaAsset,
  type CampaignWorkspaceAsset,
  mediaReviewStateFromStatus,
  type CampaignWorkspaceAssetCategory,
  type LiveCampaignWorkspace,
} from "@/lib/campaigns/read-model";
import { buildCampaignExport, buildDeliverableExport, exportSlug, isExportable } from "@/lib/campaigns/deliverable-export";
import { diffLines } from "@/lib/campaigns/revision-diff";
import { type StalledRevision } from "@/lib/campaigns/revision-recovery";
import { LOCKED_CLAIMS, MEASUREMENT_PLAN } from "@/lib/performance/measurement-copy";
import { buildPerformanceLearning, type CampaignPerformancePanel, type PerformanceKpi, type PerformanceTrendPoint } from "@/lib/performance/campaign-panel";

import { KpiStrip, type KpiCell } from "../../../_components/kpi-strip";
import { Modal } from "../../../_components/modal";
import { ShareDialog } from "../../../_components/share-dialog";
import { DeliverableCopy, markId, ReviewBlock, statusMeta, svg, type Tone } from "./deliverable-review";
import { CampaignSpine } from "./campaign-spine";
import { ExternalSendModal } from "./external-send-modal";
import { ReviewQueue } from "./review-queue";
import {
  isCleanForBulkApproval,
  splitSuggestedEdits,
  summarizeReview,
  type ReviewSummary,
} from "./review-summary";
import { applyFindingFixAction, attachCampaignMediaAction, decideCampaignAsset, decideCampaignMediaAction, editCampaignDraftAction, launchCampaignAction, reopenCampaignAsset, requestCampaignRevision, retryCampaignRevision } from "../actions";
import { announce } from "../../../_components/announcer";
import {
  getCampaignSharingStateAction,
  setCampaignSharingAction,
  shareCampaignWithMemberAction,
  unshareCampaignMemberAction,
} from "../../sharing-actions";
import { AppImage } from "../../../_components/app-image";


const CATEGORY_LABEL: Record<CampaignWorkspaceAssetCategory, string> = {
  physical: "Direct & physical",
  virtual: "Email & messaging",
  ads: "Paid & social",
  media: "Creative & media",
  other: "Other deliverables",
};
const CATEGORY_ORDER: CampaignWorkspaceAssetCategory[] = ["virtual", "ads", "physical", "media", "other"];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Hand the operator a file. Everything exported here is already approved and
 * already in the browser's hands — this is a save, not a fetch, so it needs no
 * server round-trip and reveals nothing the page wasn't showing.
 */
function downloadMarkdown(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}


// A deliverable still accepts a decision until it's approved, archived, or live.
function isActionable(status: string): boolean {
  return !/approved|archived|live|sent|deployed/i.test(status || "");
}

/**
 * Whether to tell the operator this copy's claims are unchecked.
 *
 * The chat path critiques a draft AFTER the reply lands, so for about a minute a
 * card offers Approve with no critique on it — and a card with no critique looks
 * exactly like a card that passed one. That silence is the whole problem: it
 * reads as reassurance. Only worth saying while a decision is still open, and
 * only for copy that actually makes claims (an image has none).
 */
function awaitingClaimsReview(asset: CampaignWorkspaceAsset): boolean {
  return !asset.claimsReviewed && Boolean(asset.body.trim()) && isActionable(asset.status);
}

/**
 * The campaign's own state, in the shared vocabulary.
 *
 * `launchState.lifecycle` is a parallel set of display words baked into the
 * domain type — "Drafting" | "In review" | "Ready" | "Live" — which is exactly
 * what `vocabulary.ts` says not to do: a state is a state, and the label is
 * decided in one place. Rendering it raw is why this screen said "In review" on
 * the header pill and in Launch readiness while the asset cards below said
 * "Needs you", for one campaign, in one viewport.
 *
 * The union is left alone (it is a real state machine, used for gating), and
 * translated here at the display boundary. `toWorkState` already maps all four:
 * Drafting→draft, In review→needs_you, Ready→approved, Live→sending.
 */
function lifecycleLabel(lifecycle: string): string {
  return WORK_STATE_LABEL[toWorkState(lifecycle)];
}

const WORK_STATE_TONE_CLASS: Record<WorkStateTone, Tone> = {
  attention: "amber",
  ok: "ok",
  neutral: "gray",
};

function lifecycleTone(lifecycle: string): Tone {
  // "Live" keeps blue: on this screen blue means "out in the world", which is a
  // stronger statement than the shared `ok` and the one the operator most needs
  // to spot. Everything else follows the vocabulary's tone.
  if (toWorkState(lifecycle) === "sending") return "blue";
  return WORK_STATE_TONE_CLASS[WORK_STATE_TONE[toWorkState(lifecycle)]];
}

/** Step the lightbox, wrapping at both ends. Exported for test: the demo
 *  fixtures only ever attach one media per deliverable, so the preview cannot
 *  exercise the wrap. */
export function stepMediaIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (((current + delta) % length) + length) % length;
}

const MEDIA_ORIGIN_LABEL: Record<CampaignMediaAsset["origin"], string> = {
  generated: "AI generated",
  attached: "Attached media",
  referenced: "Referenced elsewhere",
};

/**
 * How this asset's own review reads. "Not reviewed" is the common case and the
 * important one: asset-level approval writes to `approval_items`, and there are
 * no such rows in prod — the path exists and has never run. An asset nobody has
 * looked at must not read like one that passed.
 */
const MEDIA_REVIEW_LABEL: Record<CampaignMediaAsset["review"]["state"], string> = {
  // "Not reviewed" is its own state and stays: it means nobody has looked, which
  // is neither "waiting on you" nor "done" and is the whole point of the note
  // above. Everything else is the shared vocabulary — a media asset waiting on a
  // decision is in the same state as a deliverable waiting on one, and used to
  // say "Awaiting review" two inches from a card saying "Needs you".
  unreviewed: "Not reviewed",
  pending: WORK_STATE_LABEL.needs_you,
  approved: WORK_STATE_LABEL.approved,
  declined: WORK_STATE_LABEL.declined,
  needs_revision: WORK_STATE_LABEL.needs_changes,
  archived: WORK_STATE_LABEL.archived,
};

function mediaReviewTone(state: CampaignMediaAsset["review"]["state"]): Tone {
  if (state === "approved") return "ok";
  if (state === "declined") return "red";
  if (state === "needs_revision" || state === "pending") return "amber";
  return "gray";
}

/**
 * The declared ratio as a CSS `aspect-ratio`. The read-model has already
 * rejected anything that isn't `w:h` within sane bounds; this is the render
 * half of that. Falls back to the old fixed 4:3 when the producer declared
 * nothing — an undeclared ratio must not silently become a square.
 */
function tileAspect(format: string | null): string {
  const parts = format?.split(":");
  return parts?.length === 2 ? `${parts[0]} / ${parts[1]}` : "4 / 3";
}

function MediaTile({ media, onOpen }: { media: CampaignMediaAsset; onOpen: () => void }) {
  const thumb = media.thumbnailUrl || (media.type === "image" ? media.url : null);
  const [failed, setFailed] = useState(false);
  // First lineage row ("Made in Higgsfield · soul-x") captions the tile. The
  // full lineage + prompt live in the lightbox, not a native tooltip — a
  // tooltip is invisible to touch and to the keyboard, and the OS truncates a
  // long prompt anyway.
  const lineageLine = media.lineage[0]?.[1] ?? null;
  const flagged = media.riskFlags.length > 0;
  // A declined asset still sitting on a deliverable is worth seeing without
  // opening it — same visual weight as a risk flag, for the same reason.
  const declined = media.review.state === "declined";
  const label = [
    `Open ${media.title} at full size`,
    flagged ? `${media.riskFlags.length} risk flag${media.riskFlags.length === 1 ? "" : "s"}` : null,
    declined ? "declined" : null,
  ]
    .filter(Boolean)
    .join(" — ");
  return (
    <button
      type="button"
      className={`mediatile${flagged || declined ? " flagged" : ""}`}
      onClick={onOpen}
      aria-label={label}
      // The tile letterboxes to the creative's own shape. It used to crop
      // everything to 4:3, so a 9:16 vertical and a 1:1 square were
      // indistinguishable from each other and from what would actually ship.
      style={{ aspectRatio: tileAspect(media.format) }}
    >
      {thumb && !failed ? (
        <AppImage className="mtimg" src={thumb} alt={media.title} onError={() => setFailed(true)} />
      ) : null}
      <span className="mtscrim" />
      <span className={`mtbadge ${media.origin === "generated" ? "ai" : "real"}`}>
        {media.origin === "generated" ? "AI" : media.type}
      </span>
      {/* A flag recorded against THIS image was invisible here until now — the
          reviewer saw only the deliverable-level guardrail note, if any. */}
      {flagged && (
        <span className="mtrisk" aria-hidden>
          {svg('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2v.1"/>')}
        </span>
      )}
      <span className="mttitle">
        {media.title}
        {lineageLine ? <em className="mtlineage">{lineageLine}</em> : null}
      </span>
      <span className="mtzoom" aria-hidden>
        {svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M11 8v6M8 11h6"/>')}
      </span>
    </button>
  );
}

/**
 * What the reviewer pointed at on a piece of creative.
 *
 * A drawn box for a still, a moment for a video — the two ways of saying "this
 * bit" when there is no text to select. Both end up as words in the note; see
 * `composeMediaNote`.
 */
export type MediaAnnotation = { region?: MediaRegion | null; atSeconds?: number | null };

/** The media itself, full size. Owns its own load-failure state so the parent
 *  can reset it with a key rather than an effect. */
function LightboxStage({
  media,
  annotation,
  onAnnotate,
}: {
  media: CampaignMediaAsset;
  annotation: MediaAnnotation | null;
  onAnnotate: (next: MediaAnnotation | null) => void;
}) {
  const [failed, setFailed] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  /** The box being dragged right now, in normalized coordinates. */
  const [drawing, setDrawing] = useState<MediaRegion | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  if (failed) {
    return (
      <p className="lbfail">
        This file didn&apos;t load. It may have moved, or the link may have expired — open the original to check.
      </p>
    );
  }
  /** Pointer position as a fraction of the rendered frame. */
  function at(event: React.PointerEvent): { x: number; y: number } | null {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  }

  if (media.type === "image") {
    const shown = drawing ?? annotation?.region ?? null;
    return (
      <div
        ref={frameRef}
        className={`lbdraw${drawing ? " drawing" : ""}`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const start = at(event);
          if (!start) return;
          event.preventDefault();
          origin.current = start;
          setDrawing({ x: start.x, y: start.y, width: 0, height: 0 });

          // Tracked on the WINDOW, not on the element. Pointer capture makes
          // the element's own pointerup conditional on the input source
          // behaving, and a drag that ends outside the picture — which is
          // exactly how you box something at its edge — then never commits.
          let latest: MediaRegion | null = null;
          const rect = frameRef.current?.getBoundingClientRect();
          const move = (native: PointerEvent) => {
            if (!rect || !rect.width || !rect.height) return;
            const point = {
              x: (native.clientX - rect.left) / rect.width,
              y: (native.clientY - rect.top) / rect.height,
            };
            latest = normalizeRegion({
              x: Math.min(start.x, point.x),
              y: Math.min(start.y, point.y),
              width: Math.abs(point.x - start.x),
              height: Math.abs(point.y - start.y),
            });
            setDrawing(latest);
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
            origin.current = null;
            setDrawing(null);
            // A click produces a zero-size drag. That is not pointing at
            // anything, and clearing on it is what lets a stray click dismiss
            // a box you no longer want.
            onAnnotate(latest && isMeaningfulRegion(latest) ? { region: latest } : null);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
          window.addEventListener("pointercancel", up);
        }}
      >
        <AppImage className="lbimg" src={media.url} alt={media.title} loading="eager" onError={() => setFailed(true)} />
        {shown && (
          <span
            className="lbregion"
            aria-hidden="true"
            style={{
              left: `${shown.x * 100}%`,
              top: `${shown.y * 100}%`,
              width: `${shown.width * 100}%`,
              height: `${shown.height * 100}%`,
            }}
          />
        )}
      </div>
    );
  }
  if (media.type === "video") {
    return (
      <div className="lbvideo">
        <video
          ref={videoRef}
          className="lbimg"
          src={media.url}
          poster={media.thumbnailUrl ?? undefined}
          controls
          onError={() => setFailed(true)}
        />
        {/* No drag layer over a video: the surface belongs to the scrubber, and
            a box over a moving picture is ambiguous anyway. A moment is the
            useful unit here — "the logo flickers at 0:07". */}
        <button
          type="button"
          className="cbtn ghost lbframe"
          onClick={() =>
            onAnnotate(
              typeof annotation?.atSeconds === "number"
                ? null
                : { atSeconds: videoRef.current?.currentTime ?? 0 },
            )
          }
        >
          {typeof annotation?.atSeconds === "number"
            ? `Noting ${formatTimecode(annotation.atSeconds)} — clear`
            : "Note this moment"}
        </button>
      </div>
    );
  }
  // Embeds, files and links are somebody else's page. Show what we already
  // have and hand over the link, rather than iframing a URL that arrived from
  // a tool result into an authenticated shell.
  return (
    <div className="lbnoprev">
      {media.thumbnailUrl ? (
        <AppImage className="lbimg" src={media.thumbnailUrl} alt={media.title} loading="eager" onError={() => setFailed(true)} />
      ) : null}
      <p className="lbfail">No inline preview for this {media.type}. Open the original to view it.</p>
    </div>
  );
}

/**
 * Decide one image, from the campaign that carries it.
 *
 * Its own component so it can be keyed on the asset: the parent steps through a
 * list with the arrows, and mounting a fresh panel per picture is what
 * guarantees a half-typed acknowledgement — or a refusal from the last one —
 * never follows the reviewer to the next. Resetting that in an effect would fire
 * a second render pass on every step, for state that only ever needs to start
 * empty.
 */
function MediaDecision({
  media,
  onDecide,
  annotation,
  onClearAnnotation,
}: {
  media: CampaignMediaAsset;
  onDecide: (
    media: CampaignMediaAsset,
    decision: AssetDecision,
    acknowledgement: string,
    notes?: string | null,
  ) => Promise<string | null>;
  /** What the reviewer pointed at, if anything — a drawn box, or a video frame. */
  annotation: MediaAnnotation | null;
  onClearAnnotation: () => void;
}) {
  /** The reviewer's written acknowledgement of the risk flags. */
  const [ack, setAck] = useState("");
  /** What to change about the part they pointed at. */
  const [note, setNote] = useState("");
  /** Which decision is in flight, so only that button says "Recording…". */
  const [deciding, setDeciding] = useState<AssetDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flagged = media.riskFlags.length > 0;
  const pointing = Boolean(annotation?.region || typeof annotation?.atSeconds === "number");

  async function decide(decision: AssetDecision) {
    setError(null);
    setDeciding(decision);
    // Composed the same way copy revisions are: the reviewer's words stay
    // theirs, and where they pointed is added at submit time. With no
    // annotation this is exactly the note they typed, or nothing at all.
    const composed = note.trim()
      ? composeMediaNote({ region: annotation?.region, atSeconds: annotation?.atSeconds, instruction: note })
      : null;
    setError(await onDecide(media, decision, ack, composed));
    setDeciding(null);
  }

  return (
    <div className="lbdecide">
      {/* Only approval is gated. Declining or asking for another pass is how a
          reviewer ACTS on a flag, so making them justify that first would push
          them toward approving as the easier path — see checkAssetApproval. */}
      {flagged && (
        <label className="lback">
          <span>How was the flag addressed?</span>
          <textarea
            value={ack}
            onChange={(event) => setAck(event.target.value)}
            rows={2}
            placeholder="Required to approve a flagged image…"
            disabled={deciding !== null}
          />
        </label>
      )}
      {/* Appears once the reviewer has pointed at something. The note is
          optional on every decision — "Needs another pass" with nothing typed
          behaves exactly as it did — but a drawn box with no words is a gesture
          Arc cannot act on, so this is where the words go. */}
      {pointing && (
        <div className="lbmark">
          <div className="lbmark-head">
            <span className="lbmark-where">
              {annotation?.region ? describeRegion(annotation.region) : null}
              {annotation?.region && typeof annotation?.atSeconds === "number" ? " · " : null}
              {typeof annotation?.atSeconds === "number" ? `at ${formatTimecode(annotation.atSeconds)}` : null}
            </span>
            <button type="button" className="lbmark-clear" onClick={onClearAnnotation} disabled={deciding !== null}>
              Clear
            </button>
          </div>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="What should change about it?"
            disabled={deciding !== null}
            aria-label="What should change about the part you marked"
          />
        </div>
      )}
      {error && (
        <p className="lbdecerr" role="alert">
          {error}
        </p>
      )}
      <div className="lbdecrow">
        <button type="button" className="cbtn gold" disabled={deciding !== null} onClick={() => decide("approved")}>
          {svg('<path d="M5 12l4 4L19 6"/>')}
          {deciding === "approved" ? "Recording…" : "Approve image"}
        </button>
        <button
          type="button"
          className="cbtn ghost"
          disabled={deciding !== null}
          onClick={() => decide("needs_revision")}
        >
          {deciding === "needs_revision" ? "Recording…" : "Needs another pass"}
        </button>
        <button type="button" className="cbtn danger" disabled={deciding !== null} onClick={() => decide("declined")}>
          {deciding === "declined" ? "Recording…" : "Decline"}
        </button>
      </div>
      {/* The same promise the rest of the screen makes, restated where the
          decision is actually taken. */}
      <p className="lbdecnote">
        A decision here is recorded against this image alone. It sends nothing and unlocks nothing.
      </p>
    </div>
  );
}

/**
 * The creative, at a size you can actually judge.
 *
 * The tile is a 96px thumbnail, and Approve is one button below it — reviewing
 * a campaign image meant squinting at a cropped 4:3 crop of it. This is the
 * full-size view: uncropped (the tile crops, this letterboxes), with the
 * provenance the tile has no room for as readable text rather than a hover
 * tooltip. Built on the app's one Modal so Escape, scroll-lock, and focus
 * behave the same as every other dialog here.
 */
function MediaLightbox({
  items,
  index,
  onClose,
  onStep,
  onDecide,
}: {
  items: CampaignMediaAsset[];
  index: number;
  onClose: () => void;
  onStep: (delta: number) => void;
  /** Records a decision against THIS image. Resolves to an error string, or null on success. */
  onDecide: (
    media: CampaignMediaAsset,
    decision: AssetDecision,
    acknowledgement: string,
    notes?: string | null,
  ) => Promise<string | null>;
}) {
  const media = items[index];
  const many = items.length > 1;
  /**
   * An annotation belongs to the picture it was drawn on, so it carries that
   * picture's index and is DERIVED away when the reviewer steps.
   *
   * Not reset in an effect: that fires a second render pass on every step, for
   * state whose only requirement is to start empty — the same reasoning that
   * keys `MediaDecision` on the asset instead.
   */
  const [marked, setMarked] = useState<{ at: number; value: MediaAnnotation } | null>(null);
  const annotation = marked && marked.at === index ? marked.value : null;
  const setAnnotation = useCallback(
    (next: MediaAnnotation | null) => setMarked(next ? { at: index, value: next } : null),
    [index],
  );

  useEffect(() => {
    if (!many) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onStep(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onStep(-1);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [many, onStep]);

  if (!media) return null;

  // Lineage tuples are [icon key, text] — the key drives the dot, exactly as
  // the Library card renders it. It is not a label; don't print it as one.
  //
  // Origin and review state are NOT in this list: they are the two facts a
  // reviewer needs before anything else, so they sit in the dialog's subtitle
  // and in the status block above. A row repeating them would only push the
  // ones that are genuinely reference material further down.
  const rows: Array<[string, string]> = [
    // "Declared" is doing real work: nothing measures the stored file, so this
    // is the producer's claim about the creative, not a verified dimension.
    ["Format", media.format ? `${media.format} (declared)` : "Not declared"],
    ["File type", media.mimeType || media.type],
    ["Found in", media.source],
  ];
  if (media.review.notes) rows.push(["Decision notes", media.review.notes]);
  if (media.description) rows.push(["Description", media.description]);
  if (media.virality) {
    // The score never travels without its disclaimer — a bare "82" reads as a
    // measurement, and neither of these is one.
    rows.push(
      media.virality.kind === "predicted"
        ? [
            "Viral potential",
            `${media.virality.viralPotential}/100 — hook ${media.virality.hookScore}, sustain ${media.virality.sustain}`,
          ]
        : [
            "Creative quality",
            media.virality.factors.length
              ? `${media.virality.qualityScore}/100 — ${media.virality.factors.join(", ")}`
              : `${media.virality.qualityScore}/100`,
          ],
      ["Note", media.virality.disclaimer],
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={media.title}
      description={[
        MEDIA_ORIGIN_LABEL[media.origin],
        media.format ? `${media.format} declared` : null,
        media.mimeType || media.type,
      ]
        .filter(Boolean)
        .join(" · ")}
      width={1120}
      footer={
        // Same `display: contents` scope wrapper as the body — the footer's
        // `.cbtn`s and stepper are campaign.css rules too, and the footer is a
        // sibling of the body inside the portal, not a descendant of it.
        <div className="arc-campaign lb-scope">
          {many && (
            <div className="lbstepper">
              <button type="button" className="cbtn ghost" onClick={() => onStep(-1)} aria-label="Previous media">
                {svg('<path d="M15 5l-7 7 7 7"/>')}
              </button>
              <span className="lbcount">
                {index + 1} of {items.length}
              </span>
              <button type="button" className="cbtn ghost" onClick={() => onStep(1)} aria-label="Next media">
                {svg('<path d="M9 5l7 7-7 7"/>')}
              </button>
            </div>
          )}
          <a className="cbtn ghost" href={media.url} target="_blank" rel="noreferrer noopener">
            {svg('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>')}
            Open original
          </a>
          <button type="button" className="cbtn gold" onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      {/*
        The dialog is portaled into the shell (overlay-portal.tsx), which takes
        it out from under `.arc-campaign` — and every rule below is scoped to
        that ancestor. So the scope travels as a class on a `display: contents`
        wrapper, exactly as the review queue does it. Without this the whole
        dialog rendered as raw markup: a full-bleed uncapped image, a
        stacked-block metadata list, and the risk-flag warning icon at its
        intrinsic size, taller than the picture it was warning about.
      */}
      <div className="arc-campaign lb-scope">
        <div className="lbgrid">
          {/* Keyed on the asset so stepping to the next one re-arms the load —
              a broken file must not leave its error over the working one. */}
          <div className="lbstage">
            <LightboxStage key={media.id} media={media} annotation={annotation} onAnnotate={setAnnotation} />
          </div>

          {/* The creative is the point of this dialog, so it keeps the width and
              everything written *about* it reads down one rail beside it, in the
              order a reviewer needs it: what has been decided, what was flagged,
              then the reference facts. It used to run underneath the image, so
              judging a picture and reading its provenance were two scroll
              positions. */}
          <div className="lbside">
            <div className="lbstatus">
              <span className={`pill ${mediaReviewTone(media.review.state)}`}>
                <span className="pd" />
                {MEDIA_REVIEW_LABEL[media.review.state]}
              </span>
              {media.review.reviewer && (
                <span className="lbwho">
                  {media.review.reviewer}
                  {media.review.reviewedAt ? ` · ${fmtDate(media.review.reviewedAt)}` : ""}
                </span>
              )}
            </div>
            {/* Rendered even when nothing has reviewed it — especially then.
                Asset-level approval is its own record, and the deliverable's
                approve button does not write one. The controls below are what
                make that sentence actionable instead of just true: until they
                existed, the only place to decide a picture was /library, so a
                reviewer looking straight at the creative had to leave to act
                on it. */}
            {media.review.state === "unreviewed" && (
              <p className="lbnote">Approving the deliverable does not record a decision on this image.</p>
            )}

            {/* Ahead of the controls, not after them: a flag recorded against
                this image is the reason a reviewer might decline it, and the box
                below asks them to say how it was addressed. Asking that question
                above the answer to "addressed what?" reads backwards. */}
            {media.riskFlags.length > 0 && (
              <div className="lbrisk">
                <b>
                  {svg('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2v.1"/>')}
                  {media.riskFlags.length === 1
                    ? "Risk flag on this image"
                    : `${media.riskFlags.length} risk flags on this image`}
                </b>
                <ul>
                  {media.riskFlags.map((flag) => (
                    <li key={flag}>{riskFlagLabel(flag)}</li>
                  ))}
                </ul>
                <p>Recorded when the asset was produced. Nothing has cleared it — that is your call.</p>
              </div>
            )}

            {/* Keyed on the asset: stepping to the next image unmounts this and
                mounts a fresh one, so a half-typed acknowledgement or a refusal
                from the last picture can never be carried onto the next. */}
            <MediaDecision
              key={media.id}
              media={media}
              onDecide={onDecide}
              annotation={annotation}
              onClearAnnotation={() => setAnnotation(null)}
            />


            <dl className="lbmeta">
              {rows.map(([label, value], i) => (
                <div className="lbrow" key={`${label}-${i}`}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {media.lineage.length > 0 && (
              <div className="lbsec">
                <b>Provenance lineage</b>
                <div className="lblineage">
                  {media.lineage.map(([kind, text], i) => (
                    <div className="lbstep" key={`${text}-${i}`}>
                      <span className={`lbdot pv-${kind}`} />
                      <span>{text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {media.prompt && (
              <div className="lbsec lbprompt">
                <b>Generation prompt</b>
                <p>{media.prompt}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// Arc's revision, as the line-level diff of the draft it started from against
// the copy standing now. Collapsed by default: the reviewer's default question
// is "is this approvable", and only sometimes "what moved".
function RevisionDiff({ revision }: { revision: { draft: string; current: string } }) {
  const lines = useMemo(() => diffLines(revision.draft, revision.current), [revision.draft, revision.current]);
  const changed = lines.filter((line) => line.kind !== "same").length;

  // Arc recorded a revision but the copy is byte-identical — claiming "0 lines
  // changed" would read as a bug, so keep the plain note.
  if (changed === 0) {
    return (
      <div className="revnote">
        <b>Revised by Arc.</b> Latest reflects your last request.
      </div>
    );
  }

  return (
    <details className="revnote revdiff">
      <summary>
        <b>Revised by Arc.</b> {changed} line{changed === 1 ? "" : "s"} changed — see what changed
      </summary>
      <div className="revdiff-body">
        {lines.map((line, index) => (
          <div className={`revdiff-line is-${line.kind}`} key={index}>
            <span className="revdiff-gutter" aria-hidden="true">
              {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : ""}
            </span>
            {line.kind !== "same" ? <span className="sr-only">{line.kind === "added" ? "Added:" : "Removed:"}</span> : null}
            <span className="revdiff-text">{line.text.trim() ? line.text : " "}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

const NUM = new Intl.NumberFormat("en-US");
const USD0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Compact revenue-over-time area chart. Static (no animation) per the restrained
// motion posture; scales to its container via a non-uniform viewBox.
function TrendChart({ points }: { points: PerformanceTrendPoint[] }) {
  const W = 680;
  const H = 132;
  const PAD = 8;
  const max = Math.max(1, ...points.map((p) => p.revenue));
  const total = points.reduce((s, p) => s + p.revenue, 0);
  const stepX = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
  const x = (i: number) => PAD + i * stepX;
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.revenue).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${(H - PAD).toFixed(1)} L${x(0).toFixed(1)} ${(H - PAD).toFixed(1)} Z`;

  return (
    <div className="ptrend">
      <div className="ptcap">
        <span>Marketing-attributed revenue</span>
        <b>{USD0.format(total)}</b>
      </div>
      <svg className="ptsvg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="ptfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#ptfill)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="ptaxis">
        <span>{points[0]?.week}</span>
        <span>{points[points.length - 1]?.week}</span>
      </div>
    </div>
  );
}

/**
 * The panel's KPI shape, in the shared strip's terms.
 *
 * `deltaTone` is a JUDGEMENT, not an arithmetic direction — "Cost / booked job"
 * ships `-9%` with tone `ok`, because a falling cost is good news. The strip's
 * `dir` drives colour, so tone maps to it directly (`ok` → green) rather than
 * the sign of the number, which would paint the best result on the panel red.
 */
function toKpiCell(k: PerformanceKpi): KpiCell {
  const dir = k.deltaTone === "ok" ? "up" : k.deltaTone === "red" ? "dn" : "flat";
  return {
    label: k.label,
    value: k.value,
    sublabel: k.hint,
    ...(k.delta ? { delta: { label: k.delta, dir } } : {}),
  };
}

function PerformancePanel({ panel, lifecycle, campaignName }: { panel: CampaignPerformancePanel; lifecycle: string; campaignName?: string }) {
  const learning = buildPerformanceLearning(panel, campaignName);
  if (panel.status === "measuring") {
    return (
      <div>
        <div className="csec">
          <h3 className="csh">
            Performance <span className="est">Measurement plan</span>
          </h3>
          <p className="empty-note" style={{ marginBottom: 4 }}>{panel.message}</p>
          <div className="mplan">
            {MEASUREMENT_PLAN.map((m) => (
              <div className="mprow" key={m.area}>
                <div className="mpk">
                  <span className="mparea">{m.area}</span>
                  <span className="pill amber"><span className="pd" />{m.currentSignal}</span>
                </div>
                <div className="mpq">{m.question}</div>
                <div className="mpn">{m.nextStep}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="csec">
          <h3 className="csh">What stays locked until data is attached</h3>
          <div className="lockgrid">
            {LOCKED_CLAIMS.map((c) => (
              <div className="lockcard" key={c.title}>
                <div className="lockt">
                  {svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>')}
                  {c.title}
                </div>
                <div className="lockd">{c.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const funnelMax = Math.max(1, ...panel.funnel.map((f) => f.count));

  return (
    <div>
      <div className="csec">
        <h3 className="csh">
          Performance
          <span className={`est ${panel.source === "demo" ? "" : "live"}`}>
            {panel.source === "demo" ? "Illustrative" : "Attributed"} · {panel.windowLabel}
          </span>
        </h3>
        <KpiStrip className="perfkpis" items={panel.kpis.map(toKpiCell)} />
        <p className="perfnote">{panel.note}</p>
      </div>

      {learning && (
        <div className="csec perflearn">
          <h3 className="csh">
            {svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/>')}
            What Arc learned <span className="est">Next move</span>
          </h3>
          <ul className="perflearn-wins">
            {learning.wins.map((win, index) => <li key={index}>{win}</li>)}
          </ul>
          <div className="perflearn-move">
            <div className="perflearn-rec">{learning.recommendation}</div>
            <Link className="perflearn-cta" href={`/arc?new=1&prompt=${encodeURIComponent(learning.arcPrompt)}`}>
              Ask Arc to draft it
              {svg('<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>')}
            </Link>
          </div>
          <p className="perflearn-lock">Outbound stays locked — Arc drafts the next iteration for your approval.</p>
        </div>
      )}

      {panel.trend.length > 1 && (
        <div className="csec">
          <h3 className="csh">Revenue over time <span className="cgc">{panel.windowLabel}</span></h3>
          <TrendChart points={panel.trend} />
        </div>
      )}

      {panel.funnel.length > 0 && (
        <div className="csec">
          <h3 className="csh">Funnel</h3>
          <div className="pfunnel">
            {panel.funnel.map((f) => (
              <div className="pfrow" key={f.label}>
                <span className="pfl">{f.label}</span>
                <div className="pfbar"><i style={{ width: `${Math.round((f.count / funnelMax) * 100)}%` }} /></div>
                <span className="pfc">{NUM.format(f.count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {panel.channels.length > 0 && (
        <div className="csec">
          <h3 className="csh">By channel</h3>
          <div className="pchan">
            <div className="pchead">
              <span>Channel</span><span>Leads</span><span>Booked</span><span>Revenue</span><span>Spend</span>
            </div>
            {panel.channels.map((c) => (
              <div className="pcrow" key={c.channel}>
                <span className="pcname">{c.channel}<i className="pcshare" style={{ width: `${c.share}%` }} /></span>
                <span>{NUM.format(c.leads)}</span>
                <span>{NUM.format(c.booked)}</span>
                <span>{c.revenue}</span>
                <span className="pcspend">{c.spend}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {panel.assets.length > 0 && (
        <div className="csec">
          <h3 className="csh">Asset performance <span className="est">Provenance-tagged</span></h3>
          <div className="passets">
            <div className="pahead">
              <span>Asset</span><span>Source</span><span>Status</span><span>Impr.</span><span>Clicks</span><span>Leads</span><span>CTR</span>
            </div>
            {panel.assets.map((a) => {
              const meta = statusMeta(a.status);
              return (
                <div className="parow" key={a.id}>
                  <span className="paname">
                    <b>{a.title}</b>
                    <i>{a.channel} · {a.format}</i>
                  </span>
                  <span><span className={`prov ${provTone(a.source)}`}>{a.source}</span></span>
                  <span><span className={`pill ${meta.tone}`}><span className="pd" />{meta.label}</span></span>
                  <span className="panum">{NUM.format(a.impressions)}</span>
                  <span className="panum">{NUM.format(a.clicks)}</span>
                  <span className="panum">{NUM.format(a.leads)}</span>
                  <span className="panum">{a.ctr}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {lifecycle !== "Live" && (
        <p className="empty-note">
          This campaign isn&apos;t live yet — figures reflect attribution to date. No sending, spending, or publishing runs without explicit approval.
        </p>
      )}
    </div>
  );
}

// Provenance badge tone — mirrors the asset-review posture (real BSR media vs AI vs composite).
function provTone(source: string): string {
  const s = source.toLowerCase();
  if (s.includes("real")) return "real";
  if (s.includes("ai")) return "ai";
  if (s.includes("composite")) return "composite";
  return "stock";
}

export function CampaignDetailView({ detail, performance, audience, attachableMedia = [], stalledRevisions = [] }: { detail: LiveCampaignWorkspace; performance: CampaignPerformancePanel; audience?: AudienceResolution | null; attachableMedia?: AttachableMediaItem[]; stalledRevisions?: StalledRevision[] }) {
  const { campaign, launchState, executiveOverview, reasoning, sources, approvalHistory, media } = detail;
  const [assets, setAssets] = useState<CampaignWorkspaceAsset[]>(detail.assets);
  // Revisions Arc never started, by asset. Seeded from the server read and
  // trimmed locally as retries succeed, so the notice clears without a reload.
  const [stalled, setStalled] = useState<StalledRevision[]>(stalledRevisions);
  const stalledByAsset = useMemo(() => new Map(stalled.map((s) => [s.assetId, s])), [stalled]);
  // Set when a revision request comes back un-dispatched, so the operator learns
  // immediately rather than after the 10-minute stale cutoff makes it "stalled".
  // assetId -> the queued task, so Retry works without waiting for that sweep.
  const [undispatched, setUndispatched] = useState<Map<string, string>>(new Map());
  const [tab, setTab] = useState("deliverables");
  const [reviseFor, setReviseFor] = useState<string | null>(null);
  const [reviseText, setReviseText] = useState("");
  // Inline copy editing: which asset is open, and its working title/body.
  const [editFor, setEditFor] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  // Media attach: which asset's picker is open.
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  // Full-size media preview: the tiles of one deliverable, and which is open.
  const [lightbox, setLightbox] = useState<{ items: CampaignMediaAsset[]; index: number } | null>(null);
  // Long copy is clamped so the review above it stays on screen. These hold the
  // assets the reviewer has opened in full, and the findings they've expanded
  // (keyed `assetId:findingIndex`).
  const [fullCopy, setFullCopy] = useState<Set<string>>(new Set());
  const [openFindings, setOpenFindings] = useState<Set<string>>(new Set());
  // Which deliverables are expanded. Collapsed is the default so the tab opens
  // as a list you can triage — except when there is only one, where collapsing
  // the single thing on the page helps nobody.
  const [openCards, setOpenCards] = useState<Set<string>>(() =>
    detail.assets.length === 1 ? new Set([detail.assets[0].id]) : new Set(),
  );
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  // The mark to jump to once the copy above it has finished un-clamping. A ref,
  // not state: it is a one-shot instruction to the effect below, and nothing
  // renders from it.
  const pendingMark = useRef<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmLaunch, setConfirmLaunch] = useState(false);
  const [launchErr, setLaunchErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const stepLightbox = useCallback((delta: number) => {
    setLightbox((current) =>
      current ? { ...current, index: stepMediaIndex(current.index, delta, current.items.length) } : current,
    );
  }, []);
  const closeLightbox = useCallback(() => setLightbox(null), []);

  /**
   * Record a decision on one image and reflect it in place.
   *
   * The new state is applied ONLY after the server confirms it, and from what
   * the server returned rather than from what was asked for — an optimistic pill
   * here would tell an operator their picture was approved while the gate was
   * refusing it for an un-acknowledged risk flag. `revalidatePath` in the action
   * refreshes the page's own copy; this keeps the open dialog honest in the
   * meantime, since the reviewer is still looking at it.
   */
  const decideMedia = useCallback(
    async (
      target: CampaignMediaAsset,
      decision: AssetDecision,
      acknowledgement: string,
      notes?: string | null,
    ): Promise<string | null> => {
      const res = await decideCampaignMediaAction({
        campaignId: campaign.id,
        libraryAssetId: target.libraryAssetId,
        storagePath: target.storagePath,
        decision,
        acknowledgement,
        notes: notes ?? null,
      });
      if (!res.ok) return res.error;

      const review: CampaignMediaAsset["review"] = {
        state: mediaReviewStateFromStatus(res.status),
        reviewer: res.reviewer,
        reviewedAt: res.reviewedAt,
        notes: notes?.trim() || null,
      };
      const apply = (list: CampaignMediaAsset[]) => list.map((m) => (m.id === target.id ? { ...m, review } : m));
      // Both copies: the dialog reads `lightbox.items`, while the tiles under the
      // deliverable and in the Creative rail read `assets`. Updating one would
      // leave a picture reading "Approved" in the dialog and "Not reviewed"
      // behind it.
      setLightbox((current) => (current ? { ...current, items: apply(current.items) } : current));
      setAssets((current) => current.map((asset) => ({ ...asset, media: apply(asset.media) })));
      return null;
    },
    [campaign.id],
  );

  const persona = humanizePersona(campaign.persona);
  const renderableMediaList = media.filter((m) => m.origin !== "referenced");

  // Re-group the (locally owned) assets so optimistic status changes reflect live.
  const grouped = CATEGORY_ORDER.map((cat) => ({ cat, items: assets.filter((a) => a.category === cat) })).filter((g) => g.items.length > 0);
  // Still open, reviewed, and nothing raised — the ones worth a single decision.
  const cleanAssets = assets.filter((a) => isActionable(a.status) && isCleanForBulkApproval(a));
  // Everything still awaiting a decision, in the order the page lists it, so the
  // queue walks the campaign the same way reading it top to bottom would.
  const queueAssets = grouped
    .flatMap((g) => g.items)
    .filter((a) => isActionable(a.status))
    .map((asset) => ({ campaignId: campaign.id, campaignName: campaign.name, asset }));
  // BYO send channel: which approved deliverable is open in the export modal.
  const [externalSendFor, setExternalSendFor] = useState<CampaignWorkspaceAsset | null>(null);
  const router = useRouter();

  // Where this campaign is, in four steps. Derived from the SAME `launchState`
  // the header counts and the launch panel already read, so the spine cannot
  // drift from the numbers beside it.
  //
  // Deliberately NOT recomputed from the optimistic `assets` state. In the
  // backend-less preview a decision looks like it does not move the spine —
  // `decideCampaignAsset` short-circuits at `isSupabaseAdminConfigured()` and
  // returns `persisted: false` WITHOUT calling `revalidatePath`, so the server
  // props never change while the card's own pill flips optimistically. That is
  // a demo artifact, not staleness: on a configured workspace the decision
  // revalidates and the header, the readiness panel and this all refresh
  // together.
  //
  // Deriving from client state instead would also make `launchState.ready`
  // optimistic, which gates the Launch button — an approve that failed
  // server-side would leave a real outbound control enabled.
  const spine = deriveCampaignSpine({
    hasBrief: Boolean(
      campaign.objective?.trim() || campaign.campaignTheme?.trim() || campaign.audienceSummary?.trim(),
    ),
    // A theme and nothing else. Every campaign Arc created from a chat looked
    // like this, and the step said "Set" about all of them.
    briefIsThin: Boolean(
      campaign.campaignTheme?.trim() && !campaign.objective?.trim() && !campaign.audienceSummary?.trim(),
    ),
    requiredCount: launchState.requiredCount,
    approvedCount: launchState.approvedCount,
    pendingCount: launchState.pendingCount,
    deployedCount: launchState.deployedCount,
    live: launchState.live,
    ready: launchState.ready,
  });

  function setAssetStatus(assetId: string, status: string) {
    setAssets((as) => as.map((a) => (a.id === assetId ? { ...a, status, approval: a.approval ? { ...a.approval, status } : a.approval } : a)));
  }

  /**
   * Fill in the one value a finding is asking for (BSR-743).
   *
   * No optimistic update. Everything else here can predict its own result — a
   * status flips to a value we already know. This one cannot: the substitution
   * happens server-side against the copy as it stands now, and it legitimately
   * refuses when the placeholder has been rewritten since the review. Guessing
   * the new body locally would show the operator an edit that did not happen.
   */
  function applyFix(assetId: string, finding: CampaignAssetFinding, value: string) {
    if (pending) return;
    setErr(null);
    startTransition(async () => {
      const res = await applyFindingFixAction({ campaignId: campaign.id, findingId: finding.id, value });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      if (!res.persisted) {
        setErr("Not connected to a workspace, so nothing was saved.");
        return;
      }
      // The server revalidates; drop the finding locally so the row does not sit
      // there asking for a value it already has.
      setAssets((as) =>
        as.map((a) => (a.id === assetId ? { ...a, findings: a.findings.filter((f) => f.id !== finding.id) } : a)),
      );
    });
  }

  function toggleCard(assetId: string) {
    setOpenCards((current) => {
      const next = new Set(current);
      if (!next.delete(assetId)) next.add(assetId);
      return next;
    });
  }

  function toggleFullCopy(assetId: string) {
    setFullCopy((current) => {
      const next = new Set(current);
      if (!next.delete(assetId)) next.add(assetId);
      return next;
    });
  }

  /**
   * Open a finding and take the reviewer to the words it quotes. Clamped copy
   * has to open too, or the highlight it scrolls to is behind the fold — which
   * is why the jump waits for the commit below rather than running here.
   */
  function focusFinding(assetId: string, index: number) {
    const key = `${assetId}:${index}`;
    const opening = !openFindings.has(key);
    setOpenFindings((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
    if (!opening) return;
    setFullCopy((current) => new Set(current).add(assetId));
    pendingMark.current = markId(assetId, index);
  }

  // Jump only once the clamp has actually lifted, or the target is still behind
  // the fold and lands in the wrong place. An effect, not requestAnimationFrame:
  // rAF does not fire in a throttled tab, and a click that silently does nothing
  // is worse than one that jumps a frame late.
  useEffect(() => {
    const id = pendingMark.current;
    if (!id) return;
    pendingMark.current = null;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
  }, [openFindings, fullCopy]);

  function decide(asset: CampaignWorkspaceAsset, decision: "approved" | "declined" | "archived") {
    if (pending) return;
    setErr(null);
    const prev = asset.status;
    setAssetStatus(asset.id, decision);
    // Decided means done with, so it folds away and the next one is in reach.
    // Re-opened on failure below, with the card back in the state it was in.
    setOpenCards((current) => {
      const next = new Set(current);
      next.delete(asset.id);
      return next;
    });
    startTransition(async () => {
      const res = await decideCampaignAsset(campaign.id, asset.id, decision);
      if (!res.ok) {
        setAssetStatus(asset.id, prev);
        setOpenCards((current) => new Set(current).add(asset.id));
        setErr(res.error);
        announce(`Could not ${decision === "approved" ? "approve" : "decline"}: ${asset.title}. ${res.error}`, "assertive");
        return;
      }
      // The card folds away and a count ticks over — both invisible to a screen
      // reader, on the one action the whole outbound gate turns on.
      //
      // Outcome first, title second. Titles here are whole sentences ("Water in
      // your home? We respond in 60 minutes."), so appending the verb produced
      // "…60 minutes. approved." — and made the listener wait through the title
      // to learn what happened.
      announce(`${decision === "approved" ? "Approved" : "Declined"}: ${asset.title}`);
    });
  }

  /**
   * Approve every deliverable a claims review passed with nothing flagged.
   *
   * Deliberately narrow: only pieces that were actually reviewed qualify — see
   * isCleanForBulkApproval. Approving still sends nothing; outbound stays locked
   * behind launch either way.
   */
  function approveAllClean() {
    if (pending || cleanAssets.length === 0) return;
    setErr(null);
    setConfirmBulk(false);
    const targets = cleanAssets.map((a) => ({ id: a.id, status: a.status }));
    targets.forEach((t) => setAssetStatus(t.id, "approved"));
    startTransition(async () => {
      const results = await Promise.all(targets.map((t) => decideCampaignAsset(campaign.id, t.id, "approved")));
      const failed = targets.filter((_, i) => !results[i].ok);
      if (failed.length === 0) {
        announce(`${targets.length} ${targets.length === 1 ? "deliverable" : "deliverables"} approved.`);
        return;
      }
      // Put back only what actually failed — a partial success must not look
      // like a total one, and must not roll back the approvals that landed.
      failed.forEach((t) => setAssetStatus(t.id, t.status));
      const firstError = results.find((r) => !r.ok);
      const message = `${failed.length} of ${targets.length} could not be approved${firstError && !firstError.ok ? `: ${firstError.error}` : ""}. The rest went through.`;
      setErr(message);
      // Assertive: a partial success looks identical to a full one on screen
      // until you count the cards.
      announce(message, "assertive");
    });
  }

  function submitRevision(asset: CampaignWorkspaceAsset) {
    requestRevisionFor(asset, reviseText);
  }

  /** The one revision path. The list passes its inline textarea, the queue
   *  passes its own — neither owns the request. */
  function requestRevisionFor(asset: CampaignWorkspaceAsset, rawInstruction: string) {
    const instruction = rawInstruction.trim();
    if (!instruction || pending) return;
    setErr(null);
    const prev = asset.status;
    setAssetStatus(asset.id, "revision_requested");
    setReviseFor(null);
    setReviseText("");
    startTransition(async () => {
      const res = await requestCampaignRevision(campaign.id, asset.id, instruction);
      if (!res.ok) {
        setAssetStatus(asset.id, prev);
        setErr(res.error);
        return;
      }
      // The request is recorded either way, so the status stays
      // revision_requested — but `dispatched: false` means Arc has NOT started,
      // and nothing will re-surface the task on its own. Saying so now is the
      // difference between a visible failure and a silent one.
      setUndispatched((current) => {
        const next = new Map(current);
        if (res.persisted && res.dispatched === false && res.agentTaskId) next.set(asset.id, res.agentTaskId);
        else next.delete(asset.id);
        return next;
      });
    });
  }

  /** Re-wake a revision Arc never started. Reuses the existing task — never a second one. */
  function retryRevision(assetId: string, agentTaskId: string) {
    if (pending) return;
    setErr(null);
    startTransition(async () => {
      const res = await retryCampaignRevision(campaign.id, agentTaskId);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      if (res.persisted && res.dispatched === false) {
        setErr("Arc still isn't reachable. The request is saved — try again in a few minutes.");
        return;
      }
      // Picked up: clear both notices for this asset.
      setStalled((current) => current.filter((s) => s.assetId !== assetId));
      setUndispatched((current) => {
        const next = new Map(current);
        next.delete(assetId);
        return next;
      });
    });
  }

  function openEdit(asset: CampaignWorkspaceAsset) {
    setErr(null);
    setReviseFor(null);
    setEditFor(asset.id);
    setEditTitle(asset.title);
    setEditBody(asset.preview ?? "");
  }

  function saveEdit(asset: CampaignWorkspaceAsset) {
    const body = editBody.trim();
    const title = editTitle.trim();
    if (pending || (!body && !title)) return;
    setErr(null);
    const prev = { title: asset.title, preview: asset.preview };
    // Optimistically reflect the edit; the read path coalesces edited_body so a
    // refresh keeps it. Editing never changes the decision — it stays actionable.
    setAssets((as) => as.map((a) => (a.id === asset.id ? { ...a, title: title || a.title, preview: body || a.preview } : a)));
    setEditFor(null);
    startTransition(async () => {
      const res = await editCampaignDraftAction({ campaignId: campaign.id, assetId: asset.id, title, body });
      if (!res.ok) {
        setAssets((as) => as.map((a) => (a.id === asset.id ? { ...a, title: prev.title, preview: prev.preview } : a)));
        setErr(res.error);
      }
    });
  }

  function reopen(asset: CampaignWorkspaceAsset) {
    if (pending) return;
    setErr(null);
    const prev = asset.status;
    // Optimistically flip back to review so the decision controls reappear; the
    // action re-locks dispatch server-side. Revert on failure.
    setAssetStatus(asset.id, "pending_approval");
    startTransition(async () => {
      const res = await reopenCampaignAsset(campaign.id, asset.id);
      if (!res.ok) {
        setAssetStatus(asset.id, prev);
        setErr(res.error);
      }
    });
  }

  function attachMedia(asset: CampaignWorkspaceAsset, item: AttachableMediaItem) {
    if (pending) return;
    setErr(null);
    setPickerFor(null);
    // Optimistic tile (origin "attached" renders like real, non-AI media). The
    // read path reflects the real attachment on the next refresh.
    const tile: CampaignMediaAsset = {
      id: `attach-${item.id}`,
      type: item.kind === "video" ? "video" : "image",
      origin: "attached",
      lineage: [],
      prompt: null,
      // The optimistic tile knows neither — the read path fills them in on the
      // next refresh. Guessing here would put an invented ratio on the tile.
      format: null,
      riskFlags: [],
      libraryAssetId: item.id,
      storagePath: null,
      // The attach just happened; whatever review the asset carries arrives
      // with the next read. Claiming one here would be inventing it.
      review: { state: "unreviewed", reviewer: null, reviewedAt: null, notes: null },
      title: item.fileName,
      url: item.url,
      thumbnailUrl: item.url,
      mimeType: null,
      description: null,
      source: "library",
      virality: null,
    };
    if (asset.media.some((m) => m.id === tile.id)) return; // already attached this session
    setAssets((as) => as.map((a) => (a.id === asset.id ? { ...a, media: [...a.media, tile] } : a)));
    startTransition(async () => {
      const res = await attachCampaignMediaAction({ campaignId: campaign.id, assetId: asset.id, libraryAssetId: item.id });
      if (!res.ok) {
        setAssets((as) => as.map((a) => (a.id === asset.id ? { ...a, media: a.media.filter((m) => m.id !== tile.id) } : a)));
        setErr(res.error);
      }
    });
  }

  function doLaunch() {
    if (pending) return;
    setErr(null);
    setLaunchErr(null);
    startTransition(async () => {
      const res = await launchCampaignAction(campaign.id);
      if (!res.ok) {
        setLaunchErr(res.error);
        return;
      }
      // launchCampaignAction revalidates this path; the server re-renders with
      // launch_locked cleared, so the launch control unmounts on its own.
      setConfirmLaunch(false);
    });
  }

  const TABS: Array<[string, string]> = [
    ["deliverables", `Deliverables`],
    ["overview", "Overview"],
    ["performance", "Performance"],
    ["sources", "Sources"],
    ["history", "History"],
  ];

  return (
    <div className="arc-campaign">
      <div className="cband">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link className="back" href="/campaigns">
            {svg('<path d="M15 5l-7 7 7 7"/>')}
            Back to Campaigns
          </Link>
          <button className="cbtn" style={{ marginLeft: "auto" }} onClick={() => setShareOpen(true)} aria-label="Share this campaign">
            {svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>')}
            Share
          </button>
        </div>
        <div className="crow">
          <div className="cmain">
            <h2 className="cname">{campaign.name}</h2>
            {/* `campaignTheme` joins the chain because it is the only one of the
                three required at creation — the other two are null on most live
                campaigns. The whole chain was previously inert: `objective` was
                never empty, because the read-model substituted a placeholder
                sentence for a null one. */}
            {(campaign.objective || campaign.campaignTheme || campaign.audienceSummary) && (
              <div className="csub">{campaign.objective || campaign.campaignTheme || campaign.audienceSummary}</div>
            )}
            <div className="cchips">
              {persona && (
                <span className="chip persona">
                  <span className="pgd" />
                  {persona}
                </span>
              )}
              <span className={`pill ${lifecycleTone(launchState.lifecycle)}`}>
                <span className="pd" />
                {lifecycleLabel(launchState.lifecycle)}
              </span>
              {campaign.owner && (
                <span className="chip ghost">
                  {svg('<circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/>', "gi")}
                  {campaign.owner}
                </span>
              )}
              {campaign.launchLocked && (
                <span className="chip ghost">
                  {svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>', "gi")}
                  Outbound locked
                </span>
              )}
            </div>
          </div>
          <div className="cstate">
            <div className="csrow">
              <span className="csv">{launchState.approvedCount}</span>
              <span className="csk">of {launchState.requiredCount} approved</span>
            </div>
            <div className="cstrack">
              <i style={{ width: `${launchState.requiredCount ? Math.round((launchState.approvedCount / launchState.requiredCount) * 100) : 0}%` }} />
            </div>
            <div className="csmeta">
              {/* "pending" and "live" were a fifth and sixth word for states the
                  rest of this screen calls "Needs you" and "Sending". */}
              {launchState.pendingCount} need you · {launchState.deployedCount} sending
            </div>
          </div>
        </div>
        {/* The journey, above the work. Every value comes from
            `deriveCampaignSpine` — this screen must not compute a second answer
            to "where am I", which is the bug it already had when the board's
            pill and its own header disagreed. */}
        <CampaignSpine
          steps={spine}
          onSelect={(key) => {
            setErr(null);
            if (key === "brief") {
              // The brief has always existed — "The brief" is the first section
              // of Overview — but nothing pointed at it, so it went unread by
              // the person about to approve the work it describes.
              setTab("overview");
              return;
            }
            if (key === "review") {
              setTab("deliverables");
              // Straight into the queue when there is something to decide; the
              // list is the right landing when there isn't.
              if (queueAssets.length > 0) setQueueOpen(true);
              return;
            }
            if (key === "launch") {
              // Launch readiness lives in the right rail beside this tab.
              setTab("deliverables");
              return;
            }
            // Send is only reachable once launched, and the Outbox owns it —
            // this screen never confirms a send.
            router.push("/outbox");
          }}
        />
      </div>

      {/* Was a row of clickable divs at tabIndex -1 — the campaign's sections
          could not be reached from a keyboard at all. */}
      <div className="ctabs" role="tablist" aria-label="Campaign sections">
        {TABS.map(([key, label]) => (
          <button type="button" role="tab" key={key} className={`ctab${tab === key ? " on" : ""}`} aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
            {key === "deliverables" && <span className="cnt">{assets.length}</span>}
          </button>
        ))}
      </div>

      <div className="cbody">
        <div className="cscroll">
          {err && (
            <p className="cerr">{err}</p>
          )}

          {/* One decision for the deliverables that were reviewed and raised
              nothing. Offered from two up — at one, the card's own button is
              already the shorter path. */}
          {/* Two ways through the same queue: read the list, or be handed one
              deliverable at a time. Offered from two up — with one, the card is
              already the focused view.

              GOLD, not ghost. This is the screen's primary action: the whole
              page exists so a human can decide these, and the control that
              walks them through one at a time was the quietest thing on it —
              quieter than "Approve all clean" below, which is the shortcut, not
              the path. The hierarchy now matches what the product wants people
              to do.

              The label deliberately does NOT repeat the count. The sentence
              beside it already says "6 deliverables need a decision", and a
              button reading "Review 6 deliverables" next to that is one fact
              printed twice — the same redundancy `nextActionFor` exists to
              avoid on the board. "One at a time" says what the mode IS, which
              the count cannot. */}
          {tab === "deliverables" && queueAssets.length > 1 && (
            <div className="rqstart">
              <span>
                <b>{queueAssets.length} deliverables</b> need a decision.
              </span>
              <button className="cbtn gold" onClick={() => { setErr(null); setQueueOpen(true); }} disabled={pending}>
                {svg('<path d="M4 6h16M4 12h16M4 18h9"/>')}
                Review one at a time
              </button>
            </div>
          )}

          {tab === "deliverables" && cleanAssets.length > 1 && (
            <div className={confirmBulk ? "bulkbar confirming" : "bulkbar"}>
              {confirmBulk ? (
                <>
                  <div className="bulktext">
                    <b>Approve {cleanAssets.length} deliverables?</b> Nothing sends — approved work stays
                    locked until you launch the campaign.
                    <ul className="bulklist">
                      {cleanAssets.map((a) => (
                        <li key={a.id}>{a.title}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="bulkacts">
                    <button className="cbtn ghost" onClick={() => setConfirmBulk(false)} disabled={pending}>
                      Cancel
                    </button>
                    <button className="cbtn gold" onClick={approveAllClean} disabled={pending}>
                      {svg('<path d="M5 12l4 4L19 6"/>')}
                      {pending ? "Approving…" : `Approve ${cleanAssets.length}`}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="bulktext">
                    {cleanAssets.length} deliverables passed their claims review with nothing flagged.
                  </span>
                  <button
                    className="cbtn ghost"
                    onClick={() => { setErr(null); setConfirmBulk(true); }}
                    disabled={pending}
                  >
                    {svg('<path d="M5 12l4 4L19 6"/>')}
                    Approve all clean
                  </button>
                </>
              )}
            </div>
          )}

          {tab === "deliverables" &&
            (grouped.length === 0 ? (
              <p className="empty-note">Nothing here yet. Arc drafts the assets here as it builds the campaign — each one waits on your approval.</p>
            ) : (
              grouped.map(({ cat, items }) => (
                <div className="csec" key={cat}>
                  <h3 className="csh">
                    {CATEGORY_LABEL[cat]} <span className="cgc">{items.length}</span>
                  </h3>
                  {items.map((asset) => {
                    const meta = statusMeta(asset.status);
                    const actionable = isActionable(asset.status);
                    const assetMedia = asset.media.filter((m) => m.origin !== "referenced");
                    const summary = summarizeReview(asset);
                    const copyOpen = fullCopy.has(asset.id);
                    const cardOpen = openCards.has(asset.id);
                    return (
                      <div className={cardOpen ? "deliver open" : "deliver"} key={asset.id}>
                        {/* The collapsed row has to carry enough to triage on — status,
                            what the review found, whether media is attached — or folding
                            the list just hides the work instead of ordering it. */}
                        <button
                          type="button"
                          className="dsum"
                          onClick={() => toggleCard(asset.id)}
                          aria-expanded={cardOpen}
                        >
                          <span className="dchev" aria-hidden="true">
                            {svg('<path d="M9 6l6 6-6 6"/>')}
                          </span>
                          <span className="dsumhead">
                            <span className="dtitle">{asset.title}</span>
                            <span className="dmeta">
                              {asset.channel && <span>{asset.channel}</span>}
                              {assetSourceLabel(asset.toolSource) && <span>· {assetSourceLabel(asset.toolSource)}</span>}
                              {assetMedia.length > 0 && <span>· {assetMedia.length} attached</span>}
                              {/* Only when there is a date to print. `updatedAt`
                                  is empty on every demo asset and nullable on
                                  the live read, and this rendered the bare word
                                  "updated" with nothing after it — a label for a
                                  fact the row didn't have. */}
                              {fmtDate(asset.updatedAt) && <span>· updated {fmtDate(asset.updatedAt)}</span>}
                            </span>
                          </span>
                          {summary.chip && (
                            <span className={`dsumrev tone-${summary.tone}`}>
                              <i aria-hidden="true" />
                              {summary.chip}
                            </span>
                          )}
                          <span className={`pill ${meta.tone}`}>
                            <span className="pd" />
                            {meta.label}
                          </span>
                        </button>
                        {cardOpen && (
                        <div className="dwrap">
                        <ReviewBlock
                          asset={asset}
                          summary={summary}
                          awaitingReview={awaitingClaimsReview(asset)}
                          openFindings={openFindings}
                          onFocusFinding={focusFinding}
                          onEditCopy={() => openEdit(asset)}
                          canEdit={actionable}
                          onApplyFix={actionable ? (finding, value) => applyFix(asset.id, finding, value) : undefined}
                          pending={pending}
                        />
                        <DeliverableCopy asset={asset} expanded={copyOpen} onToggle={() => toggleFullCopy(asset.id)} />
                        {assetMedia.length > 0 && (
                          <div className="mediagrid">
                            {assetMedia.map((m, mediaIndex) => (
                              <MediaTile
                                key={m.id}
                                media={m}
                                onOpen={() => setLightbox({ items: assetMedia, index: mediaIndex })}
                              />
                            ))}
                          </div>
                        )}
                        {actionable && attachableMedia.length > 0 && (
                          pickerFor === asset.id ? (
                            <div className="mediapicker">
                              <div className="mphead">
                                <b>Attach approved media</b>
                                <button type="button" className="mpclose" onClick={() => setPickerFor(null)} aria-label="Close media picker">
                                  {svg('<path d="M6 6l12 12M18 6L6 18"/>')}
                                </button>
                              </div>
                              <div className="mpgrid">
                                {attachableMedia.map((item) => (
                                  <button
                                    type="button"
                                    key={item.id}
                                    className="mpitem"
                                    onClick={() => attachMedia(asset, item)}
                                    disabled={pending}
                                    title={item.fileName}
                                  >
                                    <span className="mpthumb" style={{ backgroundImage: `url(${item.url})` }} />
                                    <span className="mpname">{item.fileName}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <button type="button" className="addmedia" onClick={() => setPickerFor(asset.id)} disabled={pending}>
                              {svg('<path d="M12 5v14M5 12h14"/>')}
                              Add media
                            </button>
                          )
                        )}
                        {(() => {
                          // A revision Arc never started. Two ways to get here:
                          // the wake failed just now (`undispatched`), or the
                          // task has sat `queued` past the stale cutoff
                          // (`stalledByAsset`, from the server read). Both mean
                          // the same thing to the operator and both are fixed
                          // the same way, so they render as one notice.
                          const taskId = undispatched.get(asset.id) ?? stalledByAsset.get(asset.id)?.agentTaskId;
                          if (!taskId) return null;
                          const instruction = stalledByAsset.get(asset.id)?.instruction;
                          return (
                            <div className="dstalled">
                              <b>Arc hasn&rsquo;t started this yet</b> — your change was saved, but it never
                              reached Arc, and it will not start on its own.
                              {instruction ? <q className="dsq">{instruction}</q> : null}
                              <button
                                type="button"
                                className="cbtn"
                                onClick={() => retryRevision(asset.id, taskId)}
                                disabled={pending}
                              >
                                {svg('<path d="M21 12a9 9 0 11-6.2-8.6"/><path d="M21 4v5h-5"/>')}
                                Send it again
                              </button>
                            </div>
                          );
                        })()}
                        {asset.revision && <RevisionDiff revision={asset.revision} />}
                        {editFor === asset.id ? (
                          <div className="revbox editbox">
                            <input
                              className="editrow-title"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              placeholder="Title"
                              disabled={pending}
                              aria-label="Deliverable title"
                            />
                            <textarea
                              value={editBody}
                              onChange={(e) => setEditBody(e.target.value)}
                              placeholder="Edit the copy…"
                              rows={5}
                              disabled={pending}
                              aria-label="Deliverable copy"
                            />
                            <div className="revactions">
                              <span className="editnote">Your edits still need approving. Nothing goes out because of them.</span>
                              <button className="cbtn ghost" onClick={() => setEditFor(null)} disabled={pending}>
                                Cancel
                              </button>
                              <button className="cbtn gold" onClick={() => saveEdit(asset)} disabled={pending || (!editBody.trim() && !editTitle.trim())}>
                                {svg('<path d="M5 12l4 4L19 6"/>')}
                                Save edit
                              </button>
                            </div>
                          </div>
                        ) : reviseFor === asset.id ? (
                          <div className="revbox">
                            <textarea
                              value={reviseText}
                              onChange={(e) => setReviseText(e.target.value)}
                              placeholder="Tell Arc what to change…"
                              rows={2}
                              disabled={pending}
                            />
                            <div className="revactions">
                              <button className="cbtn ghost" onClick={() => { setReviseFor(null); setReviseText(""); }} disabled={pending}>
                                Cancel
                              </button>
                              <button className="cbtn gold" onClick={() => submitRevision(asset)} disabled={pending || !reviseText.trim()}>
                                Send to Arc
                              </button>
                            </div>
                          </div>
                        ) : actionable ? (
                          <div className="dctrls">
                            <button className="cbtn gold" onClick={() => decide(asset, "approved")} disabled={pending}>
                              {svg('<path d="M5 12l4 4L19 6"/>')}
                              Approve
                            </button>
                            <button className="cbtn ghost" onClick={() => openEdit(asset)} disabled={pending}>
                              {svg('<path d="M4 20h4L18.5 9.5a2.1 2.1 0 00-3-3L5 17v3z"/>')}
                              Edit
                            </button>
                            <button className="cbtn ghost" onClick={() => setReviseFor(asset.id)} disabled={pending}>
                              {svg('<path d="M4 7h16M4 12h10M4 17h7"/>')}
                              Request revision
                            </button>
                            <button className="cbtn danger" onClick={() => decide(asset, "declined")} disabled={pending}>
                              Decline
                            </button>
                          </div>
                        ) : (
                          <div className="ddecided">
                            <span>
                              {meta.label}
                              {asset.dispatchLocked && " · outbound stays locked until launch"}
                            </span>
                            {/^approved/i.test(asset.status) && /email|mail/i.test(asset.channel) && (
                              <button type="button" className="cbtn ghost" onClick={() => setExternalSendFor(asset)} disabled={pending} title="Export the approved email for your own send tool — links stay campaign-tagged">
                                {svg('<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>')}
                                Send it yourself
                              </button>
                            )}
                            {isExportable(asset) && (
                              <button
                                type="button"
                                className="cbtn ghost"
                                onClick={() =>
                                  downloadMarkdown(
                                    `${exportSlug(asset.title)}.md`,
                                    buildDeliverableExport(asset, { campaignName: campaign.name, now: new Date().toLocaleDateString("en-US") }),
                                  )
                                }
                                title="Download this approved deliverable — copy and attached media — to keep or send from your own tool"
                              >
                                {svg('<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>')}
                                Download
                              </button>
                            )}
                            {/^(approved|archived)/i.test(asset.status) && (
                              <button type="button" className="cbtn ghost dreopen" onClick={() => reopen(asset)} disabled={pending} title="Send this deliverable back to review">
                                {svg('<path d="M4 4v6h6M20 20v-6h-6"/><path d="M20 10a8 8 0 00-14-3M4 14a8 8 0 0014 3"/>')}
                                Reopen
                              </button>
                            )}
                          </div>
                        )}
                        </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            ))}

          {tab === "overview" && (
            <div>
              <div className="csec">
                <h3 className="csh">The brief</h3>
                <div className="brief">
                  {([
                    ["What", executiveOverview.what],
                    ["Why now", executiveOverview.why],
                    ["Who", campaign.audienceSummary],
                    ["Offer", campaign.offerSummary],
                    ["Where", executiveOverview.where],
                    ["Timeframe", executiveOverview.timeframe],
                    ["Success tracking", executiveOverview.successTracking],
                  ] as Array<[string, string]>)
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div className="briefrow" key={k}>
                        <div className="bk">{k}</div>
                        <div className="bv">{v}</div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Who was passed over, and why. The brief above says who this
                  targets; without this the operator can only trust the targeting
                  decision rather than check it. Empty is a legitimate state — a
                  campaign can have one sensible audience — so this says so
                  plainly instead of implying no alternatives existed. */}
              <div className="csec">
                <h3 className="csh">Audiences considered <span className="est">Targeting</span></h3>
                <div className="card">
                  {campaign.consideredAudiences.length > 0 ? (
                    <div className="brief">
                      {campaign.consideredAudiences.map((entry) => (
                        <div className="briefrow" key={entry.label}>
                          <div className="bk">
                            {entry.label}
                            {entry.sizeEstimate !== undefined && (
                              <span className="cmuted"> · ~{entry.sizeEstimate.toLocaleString("en-US")}</span>
                            )}
                          </div>
                          <div className="bv">Not chosen — {entry.reason}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rbody cmuted">
                      No alternative audiences were recorded for this campaign.
                    </p>
                  )}
                </div>
              </div>

              {campaign.handoffNote && (
                <div className="csec">
                  <h3 className="csh">Handoff note <span className="est">For the person continuing offline</span></h3>
                  <div className="card">
                    <p className="rbody">{campaign.handoffNote}</p>
                  </div>
                </div>
              )}

              <div className="csec">
                <h3 className="csh">Why Arc built this <span className="est">Arc reasoning</span></h3>
                <div className="card">
                  {reasoning.whyBuilt && <p className="rbody">{reasoning.whyBuilt}</p>}
                  {reasoning.recommendedAction && (
                    <p className="rbody">
                      <b>Recommended:</b> {reasoning.recommendedAction}
                    </p>
                  )}
                  {/* Said once, in the muted voice of an empty state — not twice
                      in `.rbody`, which is the styling real reasoning uses. The
                      section stays rather than disappearing: on an Arc-drafted
                      campaign, "no reasoning was recorded" is itself worth
                      knowing, and hiding it would make missing provenance
                      indistinguishable from provenance nobody looked for. */}
                  {!reasoning.whyBuilt && !reasoning.recommendedAction && (
                    <p className="empty-note">Arc recorded no reasoning for this campaign.</p>
                  )}
                  {reasoning.guardrailFlags.length > 0 && (
                    <div className="flags">
                      {reasoning.guardrailFlags.map((f) => (
                        <span className="flag" key={f}>
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                  {reasoning.toolsUsed.length > 0 && <div className="tools">Tools · {reasoning.toolsUsed.join(", ")}</div>}
                </div>
              </div>
            </div>
          )}

          {tab === "performance" && <PerformancePanel panel={performance} lifecycle={launchState.lifecycle} campaignName={detail.campaign.name} />}

          {tab === "sources" && (
            <div className="csec">
              <h3 className="csh">Source-backed evidence</h3>
              {sources.length === 0 ? (
                <p className="empty-note">No sources attached yet.</p>
              ) : (
                sources.map((s) =>
                  s.recordHref ? (
                    <Link className="srcrow" key={s.id} href={s.recordHref}>
                      <span className="srck">{s.kind}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="srct">{s.label}</div>
                        <div className="srcd">{s.detail}</div>
                      </div>
                      <span className="go">→</span>
                    </Link>
                  ) : (
                    <a className="srcrow" key={s.id} href={s.url ?? undefined} target={s.url ? "_blank" : undefined} rel="noreferrer">
                      <span className="srck">{s.kind}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="srct">{s.label}</div>
                        <div className="srcd">{s.detail}</div>
                      </div>
                      {s.url && <span className="go">↗</span>}
                    </a>
                  ),
                )
              )}
            </div>
          )}

          {tab === "history" && (
            <div className="csec">
              <h3 className="csh">Approval history</h3>
              {approvalHistory.length === 0 ? (
                <p className="empty-note">No decisions recorded yet. Approvals, declines, and revision requests land here.</p>
              ) : (
                approvalHistory.map((h) => (
                  <div className="hist" key={h.id}>
                    <span className={`tdot ${h.tone === "green" ? "task" : h.tone === "red" ? "" : "status"}`} style={h.tone === "red" ? { background: "var(--red)" } : undefined} />
                    <div>
                      <div className="ht">
                        {h.action} <span className="by">· {h.decidedBy}</span>
                      </div>
                      <div className="hd">{h.itemTitle}</div>
                      {h.notes && <div className="hd">“{h.notes}”</div>}
                      <div className="hts">{fmtDate(h.at)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <aside className="csnap">
          <div className="snsec">
            <h3 className="snh">Launch readiness</h3>
            <div className="lstate">
              <div className={`lpill ${lifecycleTone(launchState.lifecycle)}`}>{lifecycleLabel(launchState.lifecycle)}</div>
              {/* Approved / needs-you / required used to be three rows here, and
                  the header card two inches away already says all three
                  ("0 of 3 approved · 3 need you · 0 sending") with a progress bar
                  behind them. This panel is about the one thing the header
                  can't do — launching — so it states where that stands in a
                  sentence and gets out of the way. */}
              <div className="lnote">
                {launchState.ready
                  ? "Every gating piece is approved. Launch is a separate, explicit step."
                  : `${countOf(launchState.requiredCount - launchState.approvedCount, ASSET_NOUN)} still need approving before this can launch.`}
              </div>
            </div>

            <div className="lctrl">
              <button
                className="cbtn ghost"
                disabled={launchState.approvedCount === 0}
                title={
                  launchState.approvedCount === 0
                    ? "Approve a deliverable first — the export gate is the same as the send gate"
                    : "Download every approved deliverable as one file, to keep or send from your own tool"
                }
                onClick={() =>
                  downloadMarkdown(
                    `${exportSlug(campaign.name)}.md`,
                    buildCampaignExport(campaign, assets, new Date().toLocaleDateString("en-US")).content,
                  )
                }
              >
                {svg('<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>')}
                Download campaign
              </button>
            </div>

            {campaign.launchLocked && (
              <div className="lctrl">
                {launchErr && <div className="cerr" style={{ margin: 0 }}>{launchErr}</div>}
                {confirmLaunch ? (
                  <>
                    <button className="cbtn gold" onClick={doLaunch} disabled={pending}>
                      {svg('<path d="M5 12l4 4L19 6"/>')}
                      {pending ? "Launching…" : "Confirm launch"}
                    </button>
                    <button className="cbtn ghost" onClick={() => setConfirmLaunch(false)} disabled={pending}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="cbtn gold"
                    onClick={() => { setErr(null); setLaunchErr(null); setConfirmLaunch(true); }}
                    disabled={!launchState.ready || pending}
                    title={launchState.ready ? undefined : "Approve every gating deliverable first"}
                  >
                    {svg('<path d="M3 12l18-8-8 18-2-7z"/>')}
                    Launch campaign
                  </button>
                )}
                {audience ? (
                  <div className={`lc-audience${audience.eligibleCount === 0 ? " empty" : ""}`}>
                    <svg viewBox="0 0 24 24" aria-hidden dangerouslySetInnerHTML={{ __html: '<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>' }} />
                    <span>Email audience — {audience.summary}</span>
                  </div>
                ) : null}
                <div className="lchint">
                  Launching unlocks approved deliverables for dispatch and opens the Outbox. Nothing sends automatically — you confirm each send there.
                </div>
              </div>
            )}
          </div>

          {renderableMediaList.length > 0 && (
            <div className="snsec">
              <h3 className="snh">Creative</h3>
              <div className="mediagrid">
                {renderableMediaList.slice(0, 4).map((m, mediaIndex) => (
                  // Opens against the whole list, not the visible four — the
                  // arrows should reach the creative the strip had to cut.
                  <MediaTile
                    key={m.id}
                    media={m}
                    onOpen={() => setLightbox({ items: renderableMediaList, index: mediaIndex })}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="snsec">
            <h3 className="snh">Package</h3>
            <div className="glance">
              <div className="gl">
                <span className="gk">Deliverables</span>
                <span className="gv">{detail.metrics.assets}</span>
              </div>
              <div className="gl">
                <span className="gk">Creative</span>
                <span className="gv">{detail.metrics.media}</span>
              </div>
              <div className="gl">
                <span className="gk">Sources</span>
                <span className="gv">{detail.metrics.sources}</span>
              </div>
              <div className="gl">
                <span className="gk">Theme</span>
                <span className="gv">{campaign.campaignTheme || "—"}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {queueOpen ? (
        <ReviewQueue
          title={campaign.name}
          queue={queueAssets}
          pending={pending}
          error={err}
          onDecide={decide}
          onRevise={requestRevisionFor}
          onApplyFix={(asset, finding, value) => applyFix(asset.id, finding, value)}
          // Editing leaves the queue for the list's editor, opened on the piece
          // that was on screen — one editor, not two that can disagree.
          onEdit={(asset) => { setQueueOpen(false); setOpenCards((c) => new Set(c).add(asset.id)); openEdit(asset); }}
          onClose={() => setQueueOpen(false)}
        />
      ) : null}

      {lightbox ? (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          onClose={closeLightbox}
          onStep={stepLightbox}
          onDecide={decideMedia}
        />
      ) : null}

      {externalSendFor ? (
        <ExternalSendModal
          campaignId={campaign.id}
          assetId={externalSendFor.id}
          assetTitle={externalSendFor.title}
          open
          onClose={() => setExternalSendFor(null)}
        />
      ) : null}

      {shareOpen ? (
        <ShareDialog
          subjectId={campaign.id}
          subjectNoun="campaign"
          onClose={() => setShareOpen(false)}
          load={getCampaignSharingStateAction}
          onSetVisibility={(id, visibility, permission) => setCampaignSharingAction({ campaignId: id, visibility, workspacePermission: permission })}
          onAdd={(id, userId, permission) => shareCampaignWithMemberAction({ campaignId: id, userId, permission }).then(() => {})}
          onRemove={(id, userId) => unshareCampaignMemberAction({ campaignId: id, userId }).then(() => {})}
        />
      ) : null}
    </div>
  );
}

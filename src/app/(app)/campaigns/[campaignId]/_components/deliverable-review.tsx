"use client";

/**
 * How one deliverable's review reads — shared by the list and the review queue.
 *
 * These two surfaces show the same thing at different densities, and the moment
 * they each own a copy is the moment they start disagreeing about what a
 * blocker looks like. There is one renderer.
 */

import { useState } from "react";

import { reviewAgentLabel, reviewVerdictLabel, riskFlagLabel, toWorkState, WORK_STATE_LABEL } from "@/domain";
import { type CampaignAssetFinding, type CampaignWorkspaceAsset } from "@/lib/campaigns/read-model";

import { highlightClaims, isBlocker, splitSuggestedEdits, type ReviewSummary } from "./review-summary";

export type Tone = "ok" | "amber" | "red" | "gray" | "blue";

/** The deliverable's workflow state, in the shared approval vocabulary. Lives
 *  here because the list and the queue both render the same pill. */
export function statusMeta(status: string): { tone: Tone; label: string } {
  const s = (status || "").toLowerCase();
  if (/approved/.test(s)) return { tone: "ok", label: WORK_STATE_LABEL.approved };
  if (/declined|rejected/.test(s)) return { tone: "red", label: WORK_STATE_LABEL.declined };
  if (/archived/.test(s)) return { tone: "gray", label: WORK_STATE_LABEL.archived };
  // A compliance block is not a routine pending item and must not read as one —
  // it has to be distinguishable at a glance from the amber "Needs you" crowd.
  // It keeps the red tone; only the wording joins the shared vocabulary.
  if (/compliance|blocked/.test(s)) return { tone: "red", label: "Blocked by a rule" };
  if (/revision/.test(s)) return { tone: "amber", label: WORK_STATE_LABEL.needs_changes };
  if (/live|sent|deployed/.test(s)) return { tone: "blue", label: WORK_STATE_LABEL.sending };
  if (/pending|review/.test(s)) return { tone: "amber", label: WORK_STATE_LABEL.needs_you };
  return { tone: "gray", label: status ? WORK_STATE_LABEL[toWorkState(status)] : WORK_STATE_LABEL.draft };
}

export const svg = (d: string, cls?: string) => <svg viewBox="0 0 24 24" className={cls} dangerouslySetInnerHTML={{ __html: d }} />;

/** DOM id of the span a finding points at, so clicking the finding can jump to it. */
export function markId(assetId: string, findingIndex: number): string {
  return `mark-${assetId}-${findingIndex}`;
}

/**
 * Everything the reviewer needs to decide, above the draft rather than below it.
 *
 * This used to be four separate boxes stacked under the full copy — a banned-
 * phrase notice, a guardrail line, an unreviewed warning and a recommendation
 * card carrying a rationale paragraph, the findings, the risk flags and a
 * numbered edits paragraph. Reaching the verdict meant reading all of it. Now
 * the count of blocking problems comes first, each finding is one clickable
 * line that jumps to the words it quotes, and the reasoning stays folded until
 * someone wants it.
 */
export function ReviewBlock({
  asset,
  summary,
  awaitingReview,
  openFindings,
  onFocusFinding,
  onEditCopy,
  canEdit,
  onApplyFix,
  pending = false,
}: {
  asset: CampaignWorkspaceAsset;
  summary: ReviewSummary;
  awaitingReview: boolean;
  openFindings: Set<string>;
  onFocusFinding: (assetId: string, index: number) => void;
  onEditCopy: () => void;
  canEdit: boolean;
  /** Absent on a decided deliverable — there is nothing to fill in once the
   *  decision is made, and offering an input that edits approved copy would be
   *  a quiet way around the approval gate. */
  onApplyFix?: (finding: CampaignAssetFinding, value: string) => void;
  pending?: boolean;
}) {
  const rec = asset.recommendation;
  const edits = splitSuggestedEdits(rec?.suggestedEdits ?? "");
  const hasAnything =
    Boolean(rec) || asset.findings.length > 0 || asset.blockedPhrases.length > 0 || asset.complianceNotes || awaitingReview;
  if (!hasAnything) return null;

  // Blockers first: the reviewer works top-down and should hit the hard stops
  // before the notes.
  const ordered = asset.findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, a2) => Number(isBlocker(a2.finding)) - Number(isBlocker(a.finding)));

  return (
    <div className={`review tone-${summary.tone}`}>
      {/* Nothing to head the block with on a decided piece that carries only a
          guardrail note — better silent than captioned "Reviewed" when nothing was. */}
      {summary.headline && (
        <div className="rvhead">
          <span className="rvdot" aria-hidden="true" />
          <b className="rvline">{summary.headline}</b>
          {rec && (
            <span className="rvverdict">
              {reviewAgentLabel(rec.agent)} recommends {reviewVerdictLabel(rec.verdict)}
            </span>
          )}
        </div>
      )}

      {asset.blockedPhrases.length > 0 && (
        <div className="rvbanned">
          Your Brand Kit bans {asset.blockedPhrases.map((p) => `“${p}”`).join(", ")} — rewrite before approving.
        </div>
      )}

      {ordered.length > 0 && (
        <ul className="rvlist">
          {ordered.map(({ finding, index }) => {
            const open = openFindings.has(`${asset.id}:${index}`);
            return (
              <li key={index} className={isBlocker(finding) ? "rvrow blk" : "rvrow"}>
                <button
                  type="button"
                  className="rvbtn"
                  onClick={() => onFocusFinding(asset.id, index)}
                  aria-expanded={open}
                >
                  {finding.claim && <q className="rvq">{finding.claim}</q>}
                  <span className={open ? "rvwhy open" : "rvwhy"}>{finding.message}</span>
                </button>
                {finding.fix && onApplyFix && (
                  <InlineFixRow finding={finding} pending={pending} onApply={onApplyFix} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {awaitingReview && (
        <p className="rvpending">
          Nothing has checked these claims against your evidence yet. On a fresh draft that usually lands
          within a minute — until then, an empty review is not a clean one.
        </p>
      )}

      {rec?.riskFlags && rec.riskFlags.length > 0 && (
        <div className="flags rvflags">
          {rec.riskFlags.map((f) => (
            <span className="flag" key={f}>
              {riskFlagLabel(f)}
            </span>
          ))}
        </div>
      )}

      {edits.length > 0 && (
        <details className="rvfold">
          <summary>
            What to change <span className="rvcount">{edits.length}</span>
          </summary>
          <ol className="rvedits">
            {edits.map((edit, i) => (
              <li key={i}>{edit}</li>
            ))}
          </ol>
          {canEdit && (
            <button type="button" className="cbtn ghost rvedit" onClick={onEditCopy}>
              {svg('<path d="M4 20h4L18.5 9.5a2.1 2.1 0 00-3-3L5 17v3z"/>')}
              Make these edits
            </button>
          )}
        </details>
      )}

      {rec?.rationale && (
        <details className="rvfold">
          <summary>Why Arc says this</summary>
          <p className="rvbody">{rec.rationale}</p>
        </details>
      )}

      {asset.complianceNotes && (
        <details className="rvfold">
          <summary>Guardrail for this deliverable</summary>
          <p className="rvbody">{asset.complianceNotes}</p>
        </details>
      )}

      {rec && <p className="rvfoot">Advisory only — you decide.</p>}
    </div>
  );
}


/**
 * The one value a finding is asking for, collected where the finding is.
 *
 * The point of BSR-743: the reviewer should not have to leave the review, open
 * the editor, find the placeholder and retype a value the finding already
 * named. Applying writes through the same draft-edit path the editor uses — it
 * is an edit, not an approval, and the deliverable still needs approving after.
 */
function InlineFixRow({
  finding,
  pending,
  onApply,
}: {
  finding: CampaignAssetFinding;
  pending: boolean;
  onApply: (finding: CampaignAssetFinding, value: string) => void;
}) {
  const [value, setValue] = useState("");
  const fix = finding.fix;
  if (!fix) return null;

  const submit = () => {
    if (!value.trim() || pending) return;
    onApply(finding, value);
    setValue("");
  };

  return (
    <div className="rvfix">
      <label className="rvfixlabel" htmlFor={`fix-${finding.id}`}>
        {fix.label}
      </label>
      <div className="rvfixrow">
        <input
          id={`fix-${finding.id}`}
          className="rvfixinput"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          // Enter submits, because this is a one-field form and reaching for the
          // mouse to confirm a single value is the friction being removed.
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          type={fix.kind === "phone" ? "tel" : fix.kind === "url" ? "url" : fix.kind === "date" ? "date" : "text"}
          placeholder={fix.target}
          disabled={pending}
          autoComplete="off"
        />
        <button type="button" className="cbtn gold rvfixgo" onClick={submit} disabled={pending || !value.trim()}>
          {svg('<path d="M5 12l4 4L19 6"/>')}
          Apply
        </button>
      </div>
      <p className="rvfixnote">
        Replaces <code>{fix.target}</code> in the draft. Still needs approving — nothing goes out because of this.
      </p>
    </div>
  );
}

/** Long copy is folded so the review above it stays on screen. Generous on
 *  purpose — a short email is not worth hiding, and a clamp that fires on
 *  everything just moves the reading rather than removing it. */
export function isLongCopy(preview: string): boolean {
  return preview.length > 520 || preview.split("\n").length > 12;
}

/**
 * The draft, with the spans the review quoted marked where they live.
 *
 * `expanded` is owned by the caller because the two surfaces disagree about the
 * default: the list folds long copy until asked, the queue is already showing
 * one thing at a time and has no reason to.
 */
export function DeliverableCopy({
  asset,
  expanded,
  onToggle,
}: {
  asset: CampaignWorkspaceAsset;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!asset.preview) return null;
  const segments = highlightClaims(asset.preview, asset.findings.map((f) => f.claim));
  const long = isLongCopy(asset.preview);
  return (
    <div className="dcopy">
      <div className={long && !expanded ? "dbody clamped" : "dbody"}>
        {segments.map((seg, i) =>
          seg.findingIndex === null ? (
            <span key={i}>{seg.text}</span>
          ) : (
            <mark
              key={i}
              id={markId(asset.id, seg.findingIndex)}
              className={isBlocker(asset.findings[seg.findingIndex]) ? "dmark blk" : "dmark"}
            >
              {seg.text}
            </mark>
          ),
        )}
      </div>
      {long && (
        <button type="button" className="dmore" onClick={onToggle}>
          {expanded ? "Show less" : "Show full copy"}
        </button>
      )}
    </div>
  );
}

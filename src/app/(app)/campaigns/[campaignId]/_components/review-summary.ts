/**
 * Turning a review into something a reviewer can act on in seconds.
 *
 * The card used to render the whole review as equal-weight prose: verdict,
 * rationale paragraph, quoted findings, risk flags and suggested edits all at
 * the same size, below the full draft. Reaching the verdict meant reading a few
 * hundred words. Everything here exists to put the short answer first — how many
 * things block send, and which words in the draft they point at — and leave the
 * long reasoning one click away.
 *
 * Pure on purpose: no I/O, no React, so the parsing below is unit-tested rather
 * than eyeballed in the browser.
 */

import { type CampaignAssetFinding, type CampaignWorkspaceAsset } from "@/lib/campaigns/read-model";

/** `gray` is the one that matters: nothing has reviewed this copy yet, and an
 *  unchecked draft must never borrow the colour of one that passed. */
export type ReviewTone = "ok" | "amber" | "red" | "gray";

export type ReviewSummary = {
  tone: ReviewTone;
  /** Findings that must be fixed before this can go out, plus any banned phrase. */
  blockers: number;
  /** Everything else the review raised. */
  concerns: number;
  /** The one line the reviewer reads first. Empty when there is nothing to say. */
  headline: string;
  /** The same verdict at row length, for a card that is collapsed. Triage has to
   *  work without opening anything, or collapsing the list just hides the work. */
  chip: string;
};

/** A finding is a blocker only when the reviewer said so. Everything else is a note. */
export function isBlocker(finding: CampaignAssetFinding): boolean {
  return finding.severity === "blocker";
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function summarizeReview(asset: {
  recommendation: CampaignWorkspaceAsset["recommendation"];
  findings: CampaignAssetFinding[];
  blockedPhrases: string[];
  claimsReviewed: boolean;
}): ReviewSummary {
  // A phrase the Brand Kit bans is a hard block in exactly the same sense as a
  // blocker finding, so it counts toward the same number the reviewer reads.
  const blockers = asset.findings.filter(isBlocker).length + asset.blockedPhrases.length;
  const concerns = asset.findings.length - asset.findings.filter(isBlocker).length;
  // Matched on the raw value, which arrives in either shape depending on which
  // writer produced it (`Request Revision` from one path, `request_revision`
  // from another). Rendering the verdict is `reviewVerdictLabel`'s job, not
  // this module's — there is one vocabulary for it and it lives in the domain.
  const verdict = asset.recommendation?.verdict ?? "";
  const wantsChange = /revis|declin|reject|block/i.test(verdict);
  // Nothing has weighed in at all. This is the state that used to look exactly
  // like a clean pass, which is the whole reason it gets its own tone.
  const unchecked = !asset.claimsReviewed && !asset.recommendation;

  let headline = "";
  let chip = "";
  let tone: ReviewTone = "ok";
  if (blockers > 0) {
    headline = `${plural(blockers, "thing", "things")} to fix before this can go out`;
    chip = `${blockers} to fix`;
    tone = "red";
  } else if (concerns > 0) {
    headline = `${plural(concerns, "note", "notes")} on this draft`;
    chip = plural(concerns, "note", "notes");
    tone = "amber";
  } else if (wantsChange) {
    headline = "Arc wants a change before this goes out";
    chip = "Needs a change";
    tone = "amber";
  } else if (unchecked) {
    headline = "Not checked yet";
    chip = "Not checked";
    tone = "gray";
  } else if (verdict) {
    headline = "Nothing flagged";
    chip = "Nothing flagged";
  }

  return { tone, blockers, concerns, headline, chip };
}

/**
 * Whether this deliverable can go into a bulk approval.
 *
 * `claimsReviewed` is the load-bearing term. A draft nobody has checked produces
 * exactly the same empty findings list as one that passed, so without it "approve
 * everything clean" would quietly put unreviewed copy behind a human's approval —
 * the one thing the approval gate exists to prevent.
 */
export function isCleanForBulkApproval(asset: {
  findings: CampaignAssetFinding[];
  blockedPhrases: string[];
  claimsReviewed: boolean;
}): boolean {
  return asset.claimsReviewed && asset.findings.length === 0 && asset.blockedPhrases.length === 0;
}

/**
 * Arc writes its edits as one numbered paragraph, but the reviewer works through
 * them one at a time. Split on the numbering so each becomes its own row; prose
 * with no numbering is left exactly as written.
 */
export function splitSuggestedEdits(text: string): string[] {
  const trimmed = (text || "").trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split(/(?=(?:^|\s)\d{1,2}[.)]\s)/g)
    .map((part) => part.trim().replace(/^\d{1,2}[.)]\s*/, "").trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [trimmed];
}

const QUOTE_CHARS = "\"'‘’“”";

/**
 * Strip the quoting and elision a stored claim carries so it can be found in the
 * draft. Claims arrive already wrapped in quotes — sometimes twice — and a long
 * one is often shortened with an ellipsis, which only its opening run can match.
 */
export function normalizeClaim(raw: string): string {
  let s = (raw || "").trim();
  while (s.length > 1 && QUOTE_CHARS.includes(s[0]) && QUOTE_CHARS.includes(s[s.length - 1])) {
    s = s.slice(1, -1).trim();
  }
  const elided = s.search(/…|\.\.\./);
  if (elided > 0) s = s.slice(0, elided).trim();
  return s;
}

/** Fold the typographic variants a draft and a quote of it can disagree on.
 *  Every replacement is one character for one, so indices survive it. */
function flatten(s: string): string {
  return s.replace(/[‘’“”–— ]/g, (c) =>
    c === "‘" || c === "’" ? "'" : c === "“" || c === "”" ? '"' : c === " " ? " " : "-",
  );
}

export type CopySegment = {
  text: string;
  /** Index into the findings list this span belongs to, or null for plain copy. */
  findingIndex: number | null;
};

/**
 * Mark, inside the draft itself, the exact spans the review quoted — so the
 * reviewer sees each problem where it lives instead of matching quotes against
 * the body by eye.
 *
 * A claim that can't be located simply doesn't highlight. That is not a failure
 * worth reporting: the finding still lists it in full, and a claim Arc
 * paraphrased rather than quoted was never going to match.
 */
export function highlightClaims(body: string, claims: string[]): CopySegment[] {
  if (!body) return [];
  const flat = flatten(body);
  const marks: Array<{ start: number; end: number; index: number }> = [];
  claims.forEach((raw, index) => {
    const needle = normalizeClaim(raw);
    // Anything shorter is a fragment that would match half the draft.
    if (needle.length < 4) return;
    const at = flat.indexOf(flatten(needle));
    if (at < 0) return;
    marks.push({ start: at, end: at + needle.length, index });
  });

  // Two findings quoting overlapping spans would nest, which cannot render.
  // Longest-first at each start, then keep the first of any overlap.
  marks.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: typeof marks = [];
  for (const mark of marks) {
    if (kept.length > 0 && mark.start < kept[kept.length - 1].end) continue;
    kept.push(mark);
  }

  const segments: CopySegment[] = [];
  let cursor = 0;
  for (const mark of kept) {
    if (mark.start > cursor) segments.push({ text: body.slice(cursor, mark.start), findingIndex: null });
    segments.push({ text: body.slice(mark.start, mark.end), findingIndex: mark.index });
    cursor = mark.end;
  }
  if (cursor < body.length) segments.push({ text: body.slice(cursor), findingIndex: null });
  return segments;
}

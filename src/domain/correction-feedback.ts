// What the operator sent back, and why — pure, no I/O (BSR-685).
//
// Every time a draft is declined or sent back for revision the operator types
// what was wrong. That text is stored on `approval_decisions.decision_notes`,
// rendered into the activity timeline, and then never used again. Arc has no
// way to know it has already been corrected, so it can make the same mistake
// indefinitely.
//
// ── Why these are surfaced individually, unlike dismissal reasons ────────────
//
// BSR-686 aggregates dismissals and only reports a pattern seen three or more
// times, because a dismissal is one value from a fixed vocabulary and a single
// one is an opinion about a single record. Corrections are the opposite: free
// text, highly specific, and valuable on their own. On the live tenant all
// three read like standing instructions — one of them literally says "in the
// future, always use this". Waiting for a threshold would throw them away.
//
// ── The filter that matters ─────────────────────────────────────────────────
//
// The archived demo org carries nine identical `revision_requested` notes
// reading "Nightly smoke check — no action needed" — one per night from the
// prod smoke workflow. Org scoping keeps those out of the live tenant's
// context, and it is the caller's job to scope the read. `dedupeByText` is the
// second line: the same sentence repeated is boilerplate, and repeating it in
// the prompt would spend context teaching Arc a machine's filler.

import { approvalItemLabel } from "./vocabulary";

/** Decisions that carry a correction. An approval note is praise, not a lesson. */
const CORRECTIVE_DECISIONS = new Set(["revision_requested", "declined"]);

export type CorrectionInput = {
  decision: string;
  /** The operator's own words. */
  note: string | null;
  /** What was being reviewed — "campaign_asset", "email_campaign_asset", … */
  itemType?: string | null;
  /** ISO timestamp; newest is kept when the same text appears twice. */
  decidedAt: string;
};

/** Most notes are a sentence. This is a ceiling against a pasted wall of text. */
const MAX_NOTE_CHARS = 240;
/** How many corrections reach the prompt. Recent ones win. */
const MAX_CORRECTIONS = 5;

function normalize(note: string): string {
  return note.replace(/\s+/g, " ").trim();
}

function truncate(note: string): string {
  return note.length <= MAX_NOTE_CHARS ? note : `${note.slice(0, MAX_NOTE_CHARS - 1).trimEnd()}…`;
}

/**
 * The operator's recent corrections, newest first, as lines for Arc's context.
 *
 * Deduplicated on the note text itself so repeated boilerplate contributes one
 * line rather than N. Returns an empty array when there is nothing to say, so
 * the caller renders no block at all instead of a heading over nothing.
 */
export function summarizeCorrections(inputs: readonly CorrectionInput[], limit = MAX_CORRECTIONS): string[] {
  const corrective = inputs.filter((i) => CORRECTIVE_DECISIONS.has(i.decision) && normalize(i.note ?? "").length > 0);

  // Newest first, so the survivor of a duplicate is the most recent one and the
  // cap keeps the freshest feedback rather than whatever happened to be read.
  const byRecency = [...corrective].sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : a.decidedAt > b.decidedAt ? -1 : 0));

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const input of byRecency) {
    const note = normalize(input.note ?? "");
    const key = note.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${approvalItemLabel(input.itemType)} — "${truncate(note)}"`);
    if (lines.length >= limit) break;
  }
  return lines;
}

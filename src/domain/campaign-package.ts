// The last two fields of the campaign package contract — pure, no I/O.
//
// `consideredAudiences` records what Arc weighed and did NOT choose. The package
// already says who it targets; without this it never says who it passed over,
// and an operator has to trust the targeting rather than check it. Showing the
// rejected alternative and the reason is what makes a recommendation auditable —
// the same principle the opportunity cards already follow with evidence links.
//
// `handoffNote` is for the human who continues offline: a salesperson or
// referral partner. Distinct from the Arc deploy handoff in
// `lib/campaigns/launch.ts`, which is a machine signal.

export type ConsideredAudience = {
  /** The audience that was weighed, in the operator's own vocabulary. */
  label: string;
  /** Why it wasn't chosen. The load-bearing half — a label alone explains nothing. */
  reason: string;
  /** Rough size, when known. Never invented. */
  sizeEstimate?: number;
};

/** Longest handoff note we store. Long enough for real instruction, short enough to read. */
export const MAX_HANDOFF_NOTE_CHARS = 2_000;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Parse the stored JSONB into considered audiences, discarding anything
 * malformed.
 *
 * An entry with no reason is dropped rather than shown: "we also considered
 * Property Managers" with no explanation is worse than silence, because it looks
 * like diligence while conveying nothing an operator can weigh.
 */
export function parseConsideredAudiences(value: unknown): ConsideredAudience[] {
  if (!Array.isArray(value)) return [];
  const out: ConsideredAudience[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const label = asString(record.label);
    const reason = asString(record.reason);
    if (!label || !reason) continue;

    const size = record.sizeEstimate;
    const sizeEstimate = typeof size === "number" && Number.isFinite(size) && size >= 0 ? Math.round(size) : undefined;
    out.push(sizeEstimate === undefined ? { label, reason } : { label, reason, sizeEstimate });
  }
  return out;
}

/** Normalize a handoff note for storage. Empty → null, so "no note" is one value. */
export function normalizeHandoffNote(value: unknown): string | null {
  const note = asString(value);
  if (!note) return null;
  return note.length > MAX_HANDOFF_NOTE_CHARS ? note.slice(0, MAX_HANDOFF_NOTE_CHARS).trimEnd() : note;
}

/**
 * One-line summary for a considered audience, e.g.
 * "Property managers (~120) — overlaps the active nurture, would double-contact".
 */
export function describeConsideredAudience(entry: ConsideredAudience): string {
  const size = entry.sizeEstimate !== undefined ? ` (~${entry.sizeEstimate.toLocaleString("en-US")})` : "";
  return `${entry.label}${size} — ${entry.reason}`;
}

/**
 * Whether the package can show its targeting reasoning.
 *
 * Deliberately NOT treated as a completeness failure: plenty of campaigns have
 * exactly one sensible audience, and manufacturing a rejected alternative to
 * fill the section would be worse than leaving it empty. The UI says "no
 * alternatives recorded" rather than implying none were possible.
 */
export function hasTargetingRationale(entries: readonly ConsideredAudience[]): boolean {
  return entries.length > 0;
}

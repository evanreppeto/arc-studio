import { humanizeArcProse } from "@/domain";

/**
 * List-row formatting for the opportunity inbox. The general prose cleaner it
 * builds on lives in `@/domain/arc-prose`; these two are about fitting a title
 * into a row, which is this screen's problem and nobody else's.
 */

/** Longest a list row's lead may run before it stops being scannable. */
const MAX_NAME_CHARS = 46;
/** Longest the qualifier beneath it may run. */
const MAX_QUALIFIER_CHARS = 42;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 2).trim()}…` : text;
}

/** The lead of a title — everything before its first em/en dash. */
export function rowName(title: string): string {
  const first = title.split(/\s+[—–]\s+/)[0].trim() || title.trim();
  return clip(first, MAX_NAME_CHARS);
}

/**
 * The part of the title `rowName` cuts — "Cook, IL / DuPage, IL +1 more" out of
 * "Flood Advisory — Cook, IL / DuPage, IL +1 more".
 *
 * Without it, two live flood advisories over different counties render as two
 * rows both reading "Flood Advisory", with nothing to tell them apart: the tail
 * after the dash is precisely the distinguishing part, and it was the part being
 * dropped.
 */
export function rowQualifier(title: string): string | null {
  const rest = title.split(/\s+[—–]\s+/).slice(1).join(" — ").trim();
  return rest ? clip(rest, MAX_QUALIFIER_CHARS) : null;
}

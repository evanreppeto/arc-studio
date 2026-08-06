import { MAX_REVISION_INSTRUCTION_LENGTH } from "./campaign-revisions";

/**
 * Asking Arc to change one PART of a draft, not the whole thing.
 *
 * A revision instruction is one free-text string, and "make the opening less
 * pushy" leaves Arc guessing which sentence the opening is. Quoting the exact
 * words removes the guess, and the reviewer already has them selected — they
 * were reading the line when they decided it was wrong.
 *
 * The quote is kept OUT of the instruction the operator types. It is composed
 * in at submit time so the box stays theirs: a prefilled textarea invites
 * editing the quote, and a quote edited by hand no longer matches the draft,
 * which is the one property that makes it useful to Arc.
 */

/**
 * How much of a selection to carry.
 *
 * Long enough for a sentence or two — the unit someone actually objects to —
 * and short enough that selecting the whole draft does not push the operator's
 * own words out of the instruction. A selection longer than this is a signal
 * they mean the whole passage, and the ends identify it well enough.
 */
export const MAX_QUOTE_LENGTH = 280;

/** Collapse the newlines and runs of spaces a selection drags in. */
export function normalizeQuote(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Trim to `limit`, from the MIDDLE.
 *
 * Cutting the tail loses the end of the passage, and the end is often the part
 * that is wrong. Keeping both ends and eliding the middle identifies the
 * selection from either direction.
 */
export function truncateQuote(raw: string, limit: number = MAX_QUOTE_LENGTH): string {
  const value = normalizeQuote(raw);
  if (limit <= 0) return "";
  if (value.length <= limit) return value;
  const ellipsis = " … ";
  const keep = limit - ellipsis.length;
  if (keep <= 1) return value.slice(0, limit);
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${value.slice(0, head).trimEnd()}${ellipsis}${value.slice(value.length - tail).trimStart()}`;
}

/**
 * The string that actually reaches Arc.
 *
 * Without a quote this is exactly what the operator typed — the existing
 * behaviour, unchanged, so a revision requested without selecting anything is
 * byte-for-byte what it was before.
 */
export function composeRevisionInstruction(input: { quote?: string | null; instruction: string }): string {
  const instruction = input.instruction.trim();
  const quote = normalizeQuote(input.quote ?? "");
  if (!quote) return instruction;

  const build = (q: string) => `About this part: "${q}"\n\n${instruction}`;

  // The operator's own words are the point; the quote yields first if the two
  // together would breach the limit the action validates against.
  const overhead = build("").length;
  const room = MAX_REVISION_INSTRUCTION_LENGTH - overhead;
  const budget = Math.min(MAX_QUOTE_LENGTH, room);
  if (budget <= 0) return instruction;

  return build(truncateQuote(quote, budget));
}

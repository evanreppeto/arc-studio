/**
 * Should a step's narration be shown, given the answer it sits above?
 *
 * A step's narration is the prose Arc wrote immediately before it acted. That
 * text is *copied* to the step, never removed from the reply — pre-tool text is
 * sometimes substantive answer content, and withholding it by position would
 * trade a silent empty trace for a silently truncated answer.
 *
 * The cost of that choice is duplication: when the pre-tool sentence survives
 * into the final reply, it would otherwise appear twice. So the suppression
 * happens here, at the point of display, where being wrong is cheap — a false
 * positive hides one line of trace, a false negative shows a sentence twice.
 * Neither can damage the answer.
 */

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "in",
  "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "were", "with",
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  );
}

/**
 * True when the answer already says what this narration says. Mirrors the
 * runner's `isSubstantiallyRepeated` threshold so the two agree on what counts
 * as a repeat.
 */
export function narrationEchoesAnswer(narration: string, answer: string): boolean {
  const narrationText = narration.trim();
  if (!narrationText) return true;
  if (!answer.trim()) return false;
  if (answer.includes(narrationText)) return true;

  const narrationTokens = tokens(narrationText);
  if (narrationTokens.size === 0) return true;
  const answerTokens = tokens(answer);
  let shared = 0;
  for (const token of narrationTokens) if (answerTokens.has(token)) shared += 1;
  return shared / narrationTokens.size >= 0.55;
}

/** The narration to render for a step, or null when the answer already covers it. */
export function visibleStepNarration(narration: string | undefined | null, answer: string): string | null {
  if (!narration?.trim()) return null;
  return narrationEchoesAnswer(narration, answer) ? null : narration.trim();
}

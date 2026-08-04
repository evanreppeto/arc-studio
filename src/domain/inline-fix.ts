/**
 * Applying a one-value fix to a draft (BSR-743).
 *
 * The claims reviewer can already tell you the CTA still says "Call [24/7 line]".
 * Until now it told you in prose and left you to go and edit the copy yourself,
 * retyping the value the finding had just named. This is the substitution that
 * closes that loop.
 *
 * Pure on purpose. The interesting cases here are all failure cases, and they
 * are the difference between a button that works and a button that appears to:
 * the target may no longer be in the draft at all, because a revision landed
 * between the review and the click.
 */

/** Input hints. Mirrored in the guardrail_findings CHECK constraint — a test
 *  pins the two lists together, because a value the database rejects would fail
 *  at write time on a path nothing exercises until an operator uses it. */
export const FIX_KINDS = ["text", "phone", "url", "date", "address"] as const;

export type FixKind = (typeof FIX_KINDS)[number];

export function isFixKind(value: string | null | undefined): value is FixKind {
  return typeof value === "string" && (FIX_KINDS as readonly string[]).includes(value);
}

/** What a finding needs from the human, when the answer is a single value. */
export type InlineFix = {
  /** The exact substring of the draft to replace, e.g. `[24/7 line]`. */
  target: string;
  /** What to ask for, in the operator's words. */
  label: string;
  kind: FixKind;
};

export type ApplyFixResult =
  | { ok: true; body: string; replaced: number }
  /** The value was blank. Nothing was written. */
  | { ok: false; reason: "empty_value" }
  /**
   * The target is not in the draft any more — most likely the copy was revised
   * after the review that raised this. Reported rather than swallowed: a
   * substitution that silently matches nothing would leave the operator looking
   * at an unchanged draft and a button that claimed success.
   */
  | { ok: false; reason: "target_missing" }
  /** The value still contains the placeholder, so applying would change nothing. */
  | { ok: false; reason: "value_contains_target" };

/**
 * Substitute `value` for every occurrence of `fix.target` in `body`.
 *
 * Every occurrence, not the first: a placeholder generally appears wherever the
 * real thing belongs — the CTA and the sign-off both say `[24/7 line]` — and
 * filling in one of them is not what the operator meant by "here's the number".
 */
export function applyInlineFix(body: string, fix: Pick<InlineFix, "target">, value: string): ApplyFixResult {
  const replacement = value.trim();
  if (!replacement) return { ok: false, reason: "empty_value" };
  if (!fix.target || !body.includes(fix.target)) return { ok: false, reason: "target_missing" };
  // Otherwise the "fix" leaves the placeholder in the copy and reports success.
  if (replacement.includes(fix.target)) return { ok: false, reason: "value_contains_target" };

  const replaced = body.split(fix.target).length - 1;
  return { ok: true, body: body.split(fix.target).join(replacement), replaced };
}

/** What to tell the operator when a fix could not be applied. Their words, not
 *  the reason code — they did nothing wrong and the draft is intact. */
export function describeFixFailure(reason: Exclude<ApplyFixResult, { ok: true }>["reason"], target: string): string {
  switch (reason) {
    case "empty_value":
      return "Add the value first — nothing was changed.";
    case "target_missing":
      return `“${target}” isn't in this draft any more, so there was nothing to replace. It was probably rewritten after this review. Nothing was changed.`;
    case "value_contains_target":
      return `That still contains “${target}”. Nothing was changed.`;
  }
}

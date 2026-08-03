// Why an operator dismissed an opportunity — pure, no I/O (BSR-686).
//
// Dismiss is the operator's most frequent judgement in the product and it used
// to record nothing: 46 of prod's 134 opportunities were dismissed with no
// reason, because there was nowhere to put one. Arc kept proposing, the operator
// kept saying no, and nothing learned.
//
// The vocabulary is deliberately short and deliberately NOT a free-text box.
// Dismiss is valuable because it costs nothing — a modal asking someone to write
// a sentence would collapse the volume, and volume is the signal. Five taps that
// mean genuinely different things beat fifty paragraphs nobody writes.
//
// Each reason exists because Arc should do something DIFFERENT about it. If two
// reasons would lead to the same change, they should be one reason.

export const DISMISS_REASONS = [
  "not_relevant",
  "already_handled",
  "evidence_wrong",
  "not_worth_it",
  "bad_timing",
] as const;

export type DismissReason = (typeof DISMISS_REASONS)[number];

export function isDismissReason(value: unknown): value is DismissReason {
  return typeof value === "string" && (DISMISS_REASONS as readonly string[]).includes(value);
}

type ReasonCopy = {
  /** The picker item. Written as the operator's own words, not a category name. */
  label: string;
  /**
   * What Arc should take from it. This is the whole point of the field — it goes
   * into Arc's context, so it has to say what to CHANGE, not restate the label.
   */
  lesson: string;
};

export const DISMISS_REASON_COPY: Record<DismissReason, ReasonCopy> = {
  not_relevant: {
    label: "Not relevant to us",
    lesson: "the targeting was wrong — this persona or service fit does not match how they actually sell",
  },
  already_handled: {
    label: "Already handled",
    lesson: "the signal was fair but the record was stale; check recent activity before raising this again",
  },
  evidence_wrong: {
    label: "The evidence is wrong",
    lesson: "the underlying data was incorrect — treat this source with less confidence, not the judgement",
  },
  not_worth_it: {
    label: "Real, but not worth it",
    lesson: "the read was accurate and the payoff too small; raise the bar for this kind",
  },
  bad_timing: {
    label: "Wrong moment",
    lesson: "right idea, wrong time — the basis was sound and only the timing failed",
  },
};

/** The picker, in the order it is shown. Most-common judgements first. */
export const DISMISS_REASON_OPTIONS: Array<{ value: DismissReason; label: string }> = DISMISS_REASONS.map((value) => ({
  value,
  label: DISMISS_REASON_COPY[value].label,
}));

export type DismissReasonTally = { reason: DismissReason; kind: string; count: number };

/**
 * Turn a workspace's dismissals into sentences Arc can act on.
 *
 * Only patterns are reported, never one-offs: a single dismissal is an opinion
 * about one record, while the same reason on the same kind repeatedly is a
 * statement about how this business works. `minCount` is what separates them.
 *
 * Returns an empty array when nothing clears the bar, so the caller renders no
 * block at all rather than a header over nothing.
 */
export function summarizeDismissals(tallies: readonly DismissReasonTally[], minCount = 3): string[] {
  return tallies
    .filter((t) => t.count >= minCount && isDismissReason(t.reason))
    .sort((a, b) => b.count - a.count)
    .map(
      (t) =>
        `${t.count}× "${DISMISS_REASON_COPY[t.reason].label}" on ${t.kind} — ${DISMISS_REASON_COPY[t.reason].lesson}`,
    );
}

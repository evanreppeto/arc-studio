/**
 * Whether anyone actually checked this draft, and what they found.
 *
 * A deliverable card carries `flags` — guardrail results Arc froze into
 * `arc_messages.metadata` at the moment it drafted. The chat rendered those and
 * nothing else, which turned out to be a much bigger problem than it looked:
 *
 * A census of prod found 13 of 16 approval-bearing draft cards carrying zero
 * flags — and those same 13 assets have **15 open guardrail findings** recorded
 * against them, 13 `warning` and 2 `blocker`. The checks ran. The results were
 * written down. They live in `guardrail_findings`, keyed by `campaign_asset_id`,
 * and the chat had never read that table. So a draft with an unresolved blocker
 * ("Contradicts documented service area") rendered as though nothing had been
 * flagged, one click from approval.
 *
 * The frozen `flags` are therefore a snapshot, not the truth — the same
 * relationship `preview` has to the real draft body. Both are read live now.
 *
 * ## Four states, and why `unknown` has to exist
 *
 * The first attempt at this shipped three states and said "No checks recorded"
 * whenever `flags` was empty. That sentence was FALSE for exactly the 13 drafts
 * that mattered, which is worse than the silence it replaced: it turned missing
 * data into a confident wrong answer on the screen where copy gets approved.
 *
 * So a surface that has not yet loaded the live findings reports `unknown` and
 * says nothing. Only a surface that has actually looked, and found none, is
 * allowed to say none were recorded.
 */

import type { ArcActionFlag } from "./arc-chat";

/** One recorded guardrail finding, as a review surface needs it. */
export type ArcDraftFinding = {
  id: string;
  severity: ArcFindingSeverity;
  message: string;
  /** The phrase that tripped the check, when the guardrail captured one. */
  matchedText?: string;
  /** `open` findings are unresolved. A resolved one is history, not a warning. */
  open: boolean;
};

export type ArcFindingSeverity = "blocker" | "warning" | "info";

/** Prod stores `blocker` and `warning`. Anything unrecognised is treated as a
 *  warning rather than ignored — an unknown severity is not a safe severity. */
export function arcFindingSeverity(raw: string | null | undefined): ArcFindingSeverity {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "blocker" || value === "block" || value === "error" || value === "critical") return "blocker";
  if (value === "info" || value === "notice") return "info";
  return "warning";
}

export const ARC_SEVERITY_TONE: Record<ArcFindingSeverity, "risk" | "warn" | "ok"> = {
  blocker: "risk",
  warning: "warn",
  info: "ok",
};

export type ArcDraftCheckState =
  /** Checked, nothing unresolved. */
  | "clean"
  /** At least one unresolved finding. */
  | "flagged"
  /** Looked, and no check was ever recorded. */
  | "unchecked"
  /** Haven't looked yet — say nothing. */
  | "unknown";

export function arcDraftCheckState(input: {
  flags?: readonly ArcActionFlag[];
  /** `undefined` means the live findings have not loaded. An empty ARRAY means
   *  they loaded and there are none — a different claim entirely. */
  findings?: readonly ArcDraftFinding[];
}): ArcDraftCheckState {
  const flags = input.flags ?? [];
  const findings = input.findings;

  // Anything unresolved outranks everything: the reviewer needs the worst news.
  if (findings?.some((f) => f.open)) return "flagged";
  if (flags.some((f) => f.tone === "warn" || f.tone === "risk")) return "flagged";

  if (findings === undefined) {
    // Not loaded. A card's own flags can still prove a check happened, but their
    // ABSENCE proves nothing — that is the false claim this state exists to stop.
    return flags.length > 0 ? "clean" : "unknown";
  }

  if (findings.length > 0 || flags.length > 0) return "clean";
  return "unchecked";
}

export const ARC_CHECK_LABEL: Record<ArcDraftCheckState, string> = {
  clean: "Checks passed",
  flagged: "Needs a look",
  unchecked: "No checks recorded",
  unknown: "",
};

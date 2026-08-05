/**
 * Whether anyone actually checked this draft.
 *
 * A deliverable card carries `flags` — guardrail results Arc recorded when it
 * drafted. The chat rendered them when present and rendered NOTHING when absent,
 * which quietly conflated two very different states:
 *
 *   - "checked, and nothing came up"  → safe to approve at a glance
 *   - "no check was recorded"         → nobody has looked at this
 *
 * Those are not the same claim, and the difference is not academic here: a
 * census of prod found **13 of 16** approval-bearing draft cards carrying zero
 * flags. So the common case on real data is the one the UI said nothing about,
 * and an operator scanning a package had no way to tell an inspected draft from
 * an uninspected one.
 *
 * This is also why `cleanApprovableDrafts` must not be wired to a bulk-approve
 * button as it stands: it treats "no warn/risk flags" as clean, which on prod
 * data would sweep 13 of 16 unchecked drafts through a human's approval — the
 * exact thing the approval gate exists to prevent.
 *
 * `unchecked` gets its own colourless tone wherever it renders. It must never
 * borrow the tone of `clean`; that would restate an absence of evidence as
 * evidence of absence, on the screen where someone decides whether copy reaches
 * a customer.
 */

import type { ArcActionFlag } from "./arc-chat";

export type ArcDraftCheckState = "clean" | "flagged" | "unchecked";

export function arcDraftCheckState(flags: readonly ArcActionFlag[] | undefined): ArcDraftCheckState {
  if (!flags || flags.length === 0) return "unchecked";
  if (flags.some((flag) => flag.tone === "warn" || flag.tone === "risk")) return "flagged";
  return "clean";
}

/** What to say about each state. Phrased as what is KNOWN, not as reassurance —
 *  "no checks recorded" is the honest reading of an empty flag list, whereas
 *  "looks fine" would be a claim nothing in the data supports. */
export const ARC_CHECK_LABEL: Record<ArcDraftCheckState, string> = {
  clean: "Checks passed",
  flagged: "Needs a look",
  unchecked: "No checks recorded",
};

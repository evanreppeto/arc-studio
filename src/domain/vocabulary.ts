/**
 * The one place the app's user-facing vocabulary is decided (BSR-656).
 *
 * Before this module the approval state had eleven names — "packages waiting",
 * "Waiting on you", "to decide", "Needs you", "Needs approval", "In review",
 * "need review", "Ready for review", "Awaiting your confirm", "Awaiting review",
 * "proposed" — and `/arc` rendered two of them ("Needs review" and "Ready for
 * review") on the same card, saying opposite things. The unit of work had four
 * names too: package, piece, asset, draft.
 *
 * Rules for anything added here:
 *   - A state is what a *user* would say, not what the column stores. Map the
 *     stored status to a state at the display boundary; never rename a DB value
 *     to match a label.
 *   - One state, one string. If a screen needs a longer form, derive it from the
 *     canonical label (see `needsYouCount` phrasing helpers below) rather than
 *     writing a second wording.
 *   - No internal nouns. `package` and `piece` are retired; a campaign holds
 *     assets. See `ASSET_NOUN`.
 *
 * Pure — no I/O, no React. Display strings only.
 */

/**
 * The approval lifecycle as a user experiences it. Ordered the way work moves,
 * so a reader can see the pipeline in the type.
 */
export type WorkState =
  | "draft"
  | "needs_you"
  | "needs_changes"
  | "approved"
  | "scheduled"
  | "sending"
  | "sent"
  | "declined"
  | "archived";

/**
 * The canonical label for each state. These strings are the product's
 * vocabulary — changing one changes it everywhere, which is the point.
 *
 * `sending` covers what used to be split across "Live" and "Sending". A
 * campaign that is out in the world is sending; one word, used on the campaign
 * board and in the outbox alike.
 */
export const WORK_STATE_LABEL: Record<WorkState, string> = {
  draft: "Draft",
  needs_you: "Needs you",
  needs_changes: "Needs changes",
  approved: "Approved",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  declined: "Declined",
  archived: "Archived",
};

/**
 * One line saying what the state means, for tooltips, legends, and the glossary
 * in DESIGN.md. Written for someone who has never used marketing software.
 */
export const WORK_STATE_MEANING: Record<WorkState, string> = {
  draft: "Arc is still building this.",
  needs_you: "Arc finished it and is waiting for your decision.",
  needs_changes: "You asked for changes. Arc is reworking it.",
  approved: "You said yes. It has not gone out yet.",
  scheduled: "Approved and queued to go out at a set time.",
  sending: "Going out to customers now.",
  sent: "Already delivered.",
  declined: "You said no. Nothing will go out.",
  archived: "Put away. Nothing will go out.",
};

/**
 * The tone each state carries. Gold is the "needs you" cue and the one accent
 * per screen; green is healthy/done; grey is everything inert. Red is reserved
 * for destructive controls and never appears here — a declined item is a normal
 * outcome, not a warning (DESIGN.md §4, and BSR-661).
 */
export type WorkStateTone = "attention" | "ok" | "neutral";

export const WORK_STATE_TONE: Record<WorkState, WorkStateTone> = {
  draft: "neutral",
  needs_you: "attention",
  needs_changes: "attention",
  approved: "ok",
  scheduled: "ok",
  sending: "ok",
  sent: "ok",
  declined: "neutral",
  archived: "neutral",
};

export function workStateLabel(state: WorkState): string {
  return WORK_STATE_LABEL[state];
}

/**
 * Map a stored status string onto a user-facing state.
 *
 * Deliberately forgiving: statuses reach the UI from campaign rows, approval
 * items, dispatch rows, and Arc's own message payloads, and they have never
 * agreed on spelling ("pending_approval", "in_review", "submitted", "live",
 * "running"). Matching on substrings keeps one mapping instead of four.
 *
 * Order matters — the checks run most-specific first, because "pending_review"
 * matches both the review and the pending test.
 */
export function toWorkState(status: string | null | undefined): WorkState {
  const s = (status || "").toLowerCase();
  if (!s) return "draft";
  if (/archiv|paused/.test(s)) return "archived";
  if (/declin|reject/.test(s)) return "declined";
  if (/revis|changes.request|blocked/.test(s)) return "needs_changes";
  if (/sent|delivered/.test(s)) return "sent";
  if (/live|active|sending|running|dispatch/.test(s)) return "sending";
  if (/schedul|queued/.test(s)) return "scheduled";
  if (/review|pending|await|submitted|proposed/.test(s)) return "needs_you";
  if (/approv|ready/.test(s)) return "approved";
  return "draft";
}

/** Convenience for the common "is this on my desk?" question. */
export function needsDecision(state: WorkState): boolean {
  return state === "needs_you" || state === "needs_changes";
}

/**
 * The unit of work inside a campaign. Was variously "package", "piece",
 * "asset", and "deliverable"; a campaign holds assets and nothing else.
 */
export const ASSET_NOUN = { one: "asset", many: "assets" } as const;

/** The campaign itself. Retires "package" as a user-facing noun. */
export const CAMPAIGN_NOUN = { one: "campaign", many: "campaigns" } as const;

export type CountableNoun = { one: string; many: string };

/** `countOf(1, ASSET_NOUN)` → "1 asset"; `countOf(4, ASSET_NOUN)` → "4 assets". */
export function countOf(count: number, noun: CountableNoun): string {
  return `${count} ${count === 1 ? noun.one : noun.many}`;
}

/**
 * The queue headline, in one voice. Home used four different phrasings of this
 * within a single screen ("4 packages waiting", "Waiting on you", "4 to decide",
 * "View all 4 waiting"); every one of them now comes from here.
 */
export function needsYouPhrase(count: number): string {
  return count === 1 ? "1 thing needs you" : `${count} things need you`;
}

/**
 * Why a send did not go.
 *
 * `submitDraft` used to open with one condition covering six cases and a bare
 * `return`. Three of those six are invisible flags, so a blocked send produced
 * no message, no error, and no network request — the click simply did nothing.
 * A stuck `uploading` flag then swallowed every message an operator sent for a
 * day, and the only way to find it was reading production logs and noticing
 * that no POST had ever left the browser.
 *
 * The distinction this module draws:
 *
 *   silent  — the composer is already explaining itself on screen (an empty
 *             box, a half-typed /command, a trailing @ with the mention picker
 *             open). Saying it twice is noise.
 *   loud    — a flag the operator cannot see. Always say it.
 *
 * Pure, so the rule can be tested without rendering the chat.
 */

/** A bare `/command` still being typed — the skill picker is open beneath it. */
const BARE_COMMAND = /^\/[^\s]*$/;
/** A trailing `@` — the mention picker is open. */
const OPEN_MENTION = /@$/;

/**
 * True when the composer's own UI already accounts for the send not going.
 * These are mid-composition states, not failures.
 */
export function isMidComposition(body: string): boolean {
  return !body || BARE_COMMAND.test(body) || OPEN_MENTION.test(body);
}

export type ComposerBusyState = {
  /** A previous send is still in flight. */
  isSending: boolean;
  /** The offline preview is mid-simulation. */
  demoPending: boolean;
  /** An attachment is still uploading. */
  uploading: boolean;
};

/**
 * What to tell the operator when an invisible flag is holding the send, or null
 * when nothing is. Ordered by which is most likely to clear on its own, so the
 * message names the thing they should actually wait for.
 */
export function describeBlockedSend(state: ComposerBusyState): string | null {
  if (state.isSending) return "Still sending your last message.";
  if (state.demoPending) return "Arc is still replying — this preview answers on a delay.";
  if (state.uploading) return "Waiting for the attachment to finish uploading.";
  return null;
}

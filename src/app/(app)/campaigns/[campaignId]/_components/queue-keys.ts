/**
 * What a keypress means in the review queue.
 *
 * Pure and separately tested because a keyboard layer fails silently in exactly
 * two directions and neither shows up in a screenshot: a shortcut that does
 * nothing, and — far worse — a shortcut that fires while someone is typing.
 * "d" is Decline and also a letter people write with.
 */

export type QueueAction = "approve" | "decline" | "revise" | "edit" | "next" | "prev" | "close";

export type KeyContext = {
  /** Focus is in a text field — every letter belongs to the field, not to us. */
  typing: boolean;
  /** A modifier is held, so this is a browser or OS shortcut, not ours. */
  modifier: boolean;
};

const LETTERS: Record<string, QueueAction> = {
  a: "approve",
  d: "decline",
  r: "revise",
  e: "edit",
  j: "next",
  k: "prev",
};

const KEYS: Record<string, QueueAction> = {
  ArrowRight: "next",
  ArrowDown: "next",
  ArrowLeft: "prev",
  ArrowUp: "prev",
  Escape: "close",
};

export function keyToQueueAction(key: string, context: KeyContext): QueueAction | null {
  // Escape survives typing: it is how you get out of the revision box, and a
  // reviewer who has started typing and changed their mind must not be stuck.
  if (key === "Escape") return "close";
  if (context.typing || context.modifier) return null;
  return KEYS[key] ?? LETTERS[key.toLowerCase()] ?? null;
}

/** Whether the event's target is somewhere a person is entering text. */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

/** Where the queue lands after moving. Clamped rather than wrapping: reaching
 *  the end of a review queue is information, and silently looping back to the
 *  top hides it. */
export function stepQueueIndex(current: number, action: "next" | "prev", length: number): number {
  if (length <= 0) return 0;
  const next = action === "next" ? current + 1 : current - 1;
  return Math.min(Math.max(next, 0), length - 1);
}

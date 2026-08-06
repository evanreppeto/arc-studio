/**
 * Where the "revise this" bubble sits relative to what you selected.
 *
 * Pure geometry so it can be tested without a browser — the failure mode of a
 * hand-placed popover is that it works at the size you built it and hangs off
 * the edge at every other one.
 */

export type Rect = { top: number; left: number; width: number; height: number };

export type AnchorPlacement = {
  top: number;
  left: number;
  /** Above the selection normally; below when there is no room above. */
  side: "above" | "below";
};

/** Distance between the bubble and the text it points at. */
const GAP = 8;
/** Never closer than this to the edge of the panel it lives in. */
const EDGE = 10;

/**
 * Centre horizontally on the selection, sit above it, and stay inside `bounds`.
 *
 * `bounds` is the scrollable region the bubble is rendered into, in the same
 * coordinate space as `selection` — viewport coordinates from
 * `getBoundingClientRect()` at both ends.
 */
export function placeSelectionAnchor(
  selection: Rect,
  bubble: { width: number; height: number },
  bounds: Rect,
): AnchorPlacement {
  const centred = selection.left + selection.width / 2 - bubble.width / 2;
  const minLeft = bounds.left + EDGE;
  const maxLeft = bounds.left + bounds.width - bubble.width - EDGE;
  // When the bubble is wider than the space it has, min wins — pinning to the
  // left edge keeps its start visible, which is where the label is.
  const left = Math.max(minLeft, Math.min(centred, maxLeft));

  const above = selection.top - bubble.height - GAP;
  const roomAbove = above >= bounds.top + EDGE;
  const top = roomAbove ? above : selection.top + selection.height + GAP;

  return { top, left, side: roomAbove ? "above" : "below" };
}

/**
 * Is this selection worth interrupting for?
 *
 * The bubble appearing on a stray two-character drag is noise, and noise on a
 * screen whose job is careful reading is worse than a missing shortcut. A
 * revision is about a phrase, so require enough characters to be one.
 */
export const MIN_SELECTION_LENGTH = 12;

export function isSubstantialSelection(raw: string): boolean {
  const value = raw.trim();
  if (value.length < MIN_SELECTION_LENGTH) return false;
  // A single long word is usually a double-click, which is far more often
  // "read that again" than "change this".
  return /\s/.test(value);
}

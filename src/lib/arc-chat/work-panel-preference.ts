/**
 * Whether the operator wants the conversation workspace open (BSR-567).
 *
 * The panel used to force itself open on every send, on any window over 1000px,
 * regardless of whether the run would put anything in it. Sending "hi" opened a
 * third of the screen to show two empty states. That is fixed; this is the other
 * half of the complaint — closing it was never remembered, so the next message
 * reopened it and there was no way to opt out short of narrowing the window.
 *
 * Only an EXPLICIT choice is stored. The automatic open when Arc produces
 * approval-gated assets deliberately does not write here: that is the panel
 * doing its job for one run, not the operator asking for it always. Storing it
 * would pin the panel open forever after a single campaign package.
 *
 * `sessionStorage`, not `localStorage` — "for the session" is what was asked
 * for, and a preference that outlives the tab is a surprise a week later.
 */

const KEY = "arc.workPanel.open";

/**
 * Reading `sessionStorage` can throw outright — Safari in private mode, and any
 * embedded context with storage disabled. This is a panel preference, so every
 * failure here resolves to "no preference" rather than taking the chat down.
 */
export function readWorkPanelPreference(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

export function writeWorkPanelPreference(open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, open ? "1" : "0");
  } catch {
    // Ignored on purpose. The panel still works for this render; it just will
    // not be remembered, which is the pre-existing behaviour.
  }
}

/**
 * What the panel should do when a conversation is switched or started.
 *
 * Not simply "closed". An operator who opened the workspace and then moved to
 * another thread asked for it open — resetting it is the same override, one
 * step removed. With no stored preference it stays closed, which is the right
 * default for a conversation that has produced nothing yet.
 */
export function workPanelOpenOnConversationChange(): boolean {
  return readWorkPanelPreference() === true;
}

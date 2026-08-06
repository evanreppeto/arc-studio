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

/**
 * Which of the panel's collapsible sections the operator left open.
 *
 * The panel replaced its tab rail with sections, so this replaces the stored
 * tab. Deliverables are never collapsible — they are the reason the panel
 * exists. Evidence and run history both start closed: they answer "where did
 * that come from", which is a question asked about a deliverable, after seeing
 * it. Evidence used to open by default, and on a real prod turn that put 65
 * rows — every record read and every fact recalled — directly beneath the
 * campaign work the operator opened the panel for. The header still carries the
 * count, so nothing is hidden; it is one click instead of a scroll.
 *
 * `sessionStorage` for the same reason as the open/closed preference above.
 */
export type WorkSectionId = "evidence" | "runs";

export const DEFAULT_WORK_SECTIONS: Record<WorkSectionId, boolean> = { evidence: false, runs: false };

const SECTIONS_KEY = "arc.workPanel.sections";

export function readWorkSectionPreference(): Record<WorkSectionId, boolean> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SECTIONS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Partial<Record<WorkSectionId, unknown>>;
    return {
      evidence: typeof record.evidence === "boolean" ? record.evidence : DEFAULT_WORK_SECTIONS.evidence,
      runs: typeof record.runs === "boolean" ? record.runs : DEFAULT_WORK_SECTIONS.runs,
    };
  } catch {
    return null;
  }
}

export function writeWorkSectionPreference(sections: Record<WorkSectionId, boolean>): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SECTIONS_KEY, JSON.stringify(sections));
  } catch {
    // Ignored on purpose — same reasoning as the open/closed preference.
  }
}

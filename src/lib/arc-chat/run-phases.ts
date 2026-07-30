/**
 * The runner's own internal phases.
 *
 * These exist so the status line can say something truthful while Arc is setting
 * up — "Reading your workspace" beats a bare "Thinking". They are *not* events
 * worth a line in the transcript: fetching context and resolving a workspace
 * summary are our plumbing, and listing them tells the reader nothing about
 * their business. Only Arc's actions on their data earn a row.
 *
 * (This is the same mistake as the old "Waiting for the first reported activity"
 * placeholder — narrating our internals to someone waiting on an answer. It got
 * reintroduced as three rows instead of one; hence this list.)
 *
 * Mirrors the STEP_* constants in `apps/arc-runner/src/arc.ts`. The runner is a
 * separate package with its own dependency graph, so the strings are duplicated
 * rather than imported. A drift here is not a failure: an unrecognised label
 * simply keeps its row, which is the safe direction — a real action is never
 * hidden by a stale entry in this list.
 */
/**
 * A trace entry that is a line of Arc's own prose rather than an action. The
 * runner emits these in the order Arc wrote them, so the trace reads
 * prose → action → prose → action.
 */
export const ARC_NARRATION_LABEL = "Arc";

export function isNarrationEntry(label: string): boolean {
  return label.trim() === ARC_NARRATION_LABEL;
}

const RUN_PHASE_LABELS = new Set([
  "Reading your workspace",
  "Checking what's active right now",
  "Working out an answer",
  "Writing the reply",
]);

export function isRunPhaseLabel(label: string): boolean {
  return RUN_PHASE_LABELS.has(label.trim());
}

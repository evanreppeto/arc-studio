import type { ArcMessageStatus } from "./persistence";

export type ArcRunViewState = "idle" | "working" | "complete" | "failed" | "canceled";

export type ArcRunViewRow = {
  status: "queued" | "running" | "done" | "retried" | "error";
};

export function resolveArcRunViewState(input: {
  pending: boolean;
  messageStatus?: ArcMessageStatus;
  outcome?: "complete" | "failed" | "canceled";
  rows?: ArcRunViewRow[];
  hasContent?: boolean;
}): {
  state: ArcRunViewState;
  label: string;
  heading: string;
  progressLabel: string | null;
  hasWarnings: boolean;
} {
  const rows = input.rows ?? [];
  // A `retried` row is a call that errored and that Arc then got right, so it is
  // finished work and counts as such. Counting it as neither left prod reading
  // "Completed with limitations · 19/22" on a run where all 22 activities had in
  // fact resolved — the same false claim the run-level fix removed, one layer up.
  const completed = rows.filter((row) => row.status === "done" || row.status === "retried").length;
  const failed = rows.filter((row) => row.status === "error").length;
  const progressLabel = rows.length > 0 ? `${completed}/${rows.length} activities` : null;

  if (input.outcome === "canceled") {
    return { state: "canceled", label: "Run canceled", heading: "Work stopped safely", progressLabel, hasWarnings: false };
  }

  // Persisted message outcomes are authoritative. A stale activity row can be
  // left "running" when the task finishes, but it must not reopen a completed
  // run or hide a terminal failure.
  if (input.outcome === "failed" || input.messageStatus === "failed") {
    return { state: "failed", label: "Needs attention", heading: "A step needs attention", progressLabel, hasWarnings: true };
  }

  if (input.outcome === "complete" || input.messageStatus === "complete") {
    return failed > 0
      ? { state: "complete", label: "Completed with limitations", heading: "Completed with some limitations", progressLabel, hasWarnings: true }
      : { state: "complete", label: "Run complete", heading: "How Arc approached this", progressLabel, hasWarnings: false };
  }

  if (input.pending || input.messageStatus === "pending") {
    return { state: "working", label: "Arc is working", heading: "Working through the request", progressLabel, hasWarnings: false };
  }

  if (failed > 0) {
    return { state: "failed", label: "Needs attention", heading: "A step needs attention", progressLabel, hasWarnings: true };
  }

  if (rows.some((row) => row.status === "running" || row.status === "queued")) {
    return { state: "working", label: "Arc is working", heading: "Working through the request", progressLabel, hasWarnings: false };
  }

  if (input.hasContent || rows.length > 0) {
    return { state: "complete", label: "Run complete", heading: "How Arc approached this", progressLabel, hasWarnings: false };
  }

  return { state: "idle", label: "Ready", heading: "Ready for the next request", progressLabel: null, hasWarnings: false };
}

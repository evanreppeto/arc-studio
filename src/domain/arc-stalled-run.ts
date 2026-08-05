/**
 * Decide whether an in-flight Arc reply has actually died.
 *
 * A chat turn writes a `pending` arc_messages row and queues an `agent_tasks`
 * row; the wake POST is the only dispatcher. If the runner never delivers (a
 * crash mid-turn, a dropped wake, a killed container), nothing ever flips that
 * row — so the bubble renders `pending` forever, and it survives a page reload
 * because `listMessages` faithfully returns the row as it is. The reclaim net
 * that would have caught this (`reclaimStaleChatTasks`) only runs from
 * `GET /api/v1/arc/messages`, which nothing calls.
 *
 * This is the read-side answer: don't rewrite persisted state, just stop the UI
 * from claiming work is happening when it demonstrably isn't. Pure and
 * deterministic — `nowMs` is passed in, never read here.
 *
 * Two signals, strongest first:
 *
 * 1. The task reached a terminal state while the reply stayed `pending`. That
 *    is proof, not a guess: the queue is finished with this work and no reply
 *    arrived. No timing involved, so it fires immediately.
 * 2. No terminal task, but the run is older than the stale cutoff. A heuristic,
 *    and the reason the cutoff is generous — a real campaign build legitimately
 *    runs for minutes, and calling a working run dead is the worse error.
 *
 * `blocked` and `needs_approval` deliberately fall through to the age check
 * rather than counting as terminal: those mean waiting on a human, not dead.
 */

/** The slice of an `agent_tasks` row this decision needs. */
export type ArcRunTaskState = {
  status: string;
  startedAt: string | null;
  createdAt: string | null;
};

export type ArcStalledReason =
  /** The task settled (completed/failed/canceled) but no reply was ever written. */
  | "task_settled"
  /** Still queued/running, but past the cutoff with nothing delivered. */
  | "timed_out";

export type ArcStalledVerdict = { stalled: false } | { stalled: true; reason: ArcStalledReason };

const NOT_STALLED: ArcStalledVerdict = { stalled: false };

/**
 * Task states that mean the queue is done with this work. A pending reply
 * behind one of these is stranded by definition.
 */
const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "canceled"]);

/**
 * How long a run may go without delivering before we stop claiming it's working.
 * Matches `STALE_RUNNING_MS` in `@/lib/arc-chat/inbox` on purpose — one
 * definition of "this run is dead", whether the reclaim path or the read model
 * is the one noticing.
 */
export const ARC_RUN_STALE_MS = 3 * 60_000;

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Has this pending reply stopped being real work?
 *
 * Only ever returns `stalled: true` for a `pending` arc message — a settled row
 * (complete/failed) already tells its own story, and re-judging it here would
 * relabel history every time the page rendered.
 */
export function decideArcRunStalled(input: {
  /** The message's persisted status. Anything but "pending" is never stalled. */
  status: string;
  /** When the reply row was inserted — the fallback clock when there's no task. */
  createdAt: string;
  /** The linked `agent_tasks` row, or null when it can't be resolved. */
  task?: ArcRunTaskState | null;
  nowMs: number;
  staleMs?: number;
}): ArcStalledVerdict {
  if (input.status !== "pending") return NOT_STALLED;

  const task = input.task ?? null;
  if (task && TERMINAL_TASK_STATUSES.has(task.status)) {
    return { stalled: true, reason: "task_settled" };
  }

  // Prefer the task's own clock (started_at, else created_at) and fall back to
  // the message row. `started_at` is re-stamped on a reclaim retry, so a task
  // handed back out reads as freshly started rather than dead on arrival.
  const startedMs = parseMs(task?.startedAt) ?? parseMs(task?.createdAt) ?? parseMs(input.createdAt);
  // An unparseable clock is not evidence of death — leave the run alone.
  if (startedMs === null) return NOT_STALLED;

  const staleMs = input.staleMs ?? ARC_RUN_STALE_MS;
  return input.nowMs - startedMs > staleMs ? { stalled: true, reason: "timed_out" } : NOT_STALLED;
}

/**
 * What the operator reads in place of the spinner. Written for an owner-operator,
 * not an engineer: it says what happened to their request, states plainly that
 * nothing went out, and points at the way forward. No task ids, no status enums.
 */
export function arcStalledMessage(reason: ArcStalledReason): string {
  return reason === "task_settled"
    ? "Arc stopped before writing a reply. Nothing was sent and nothing in your workspace changed — try again."
    : "Arc stopped responding to this message. Nothing was sent and nothing in your workspace changed — try again.";
}

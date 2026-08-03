/**
 * Bounded, per-tenant-fair scheduler for background Arc runs.
 *
 * A wake is ack'd instantly (the app times out at ~6s) and the actual Arc run is
 * dispatched HERE rather than fired unbounded (`void handle(...)`). Two rails keep
 * a single shared runner safe for many tenants at once:
 *   - a GLOBAL concurrency cap — never more than `maxConcurrent` Arc runs in
 *     flight on this instance (each run can be a heavy Opus turn), and
 *   - a PER-WORKSPACE in-flight cap plus round-robin dispatch, so one workspace
 *     flooding wakes can't monopolize the slots and starve the others.
 *
 * In-memory by design, and note what that costs: `agent_tasks` is a durable
 * RECORD, not a durable queue. There is no inbox poll and no stale-reclaim path
 * — nothing in this runner or in the app's crons drains rows in `queued`. The
 * wake POST is the only thing that ever starts a task, so a job dropped after
 * the wake (process restart, crash) is NOT re-surfaced, and a task inserted
 * without a wake never runs at all. That second case shipped: campaign asset
 * revisions wrote a perfect `queued` row and were never dispatched (BSR-695).
 * Anything that enqueues work must wake the runner itself. Per instance: if the
 * runner scales horizontally each instance bounds its own concurrency.
 */

import { captureRunnerError } from "./observability";

export type FairSchedulerOptions = {
  /** Global cap on Arc runs in flight at once (across all workspaces). */
  maxConcurrent: number;
  /** Cap on Arc runs in flight at once for any single workspace. */
  maxPerWorkspace: number;
};

export type SchedulerStats = { running: number; pending: number; workspaces: number };

export type FairScheduler = {
  /** Enqueue an Arc run for `workspaceKey`; it starts when a fair slot frees up. */
  schedule(workspaceKey: string, job: () => Promise<void>): void;
  stats(): SchedulerStats;
};

export function createFairScheduler(options: FairSchedulerOptions): FairScheduler {
  const maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent));
  const maxPerWorkspace = Math.max(1, Math.floor(options.maxPerWorkspace));

  const queues = new Map<string, Array<() => Promise<void>>>();
  const inFlight = new Map<string, number>();
  const ring: string[] = []; // distinct workspace keys, rotated for round-robin fairness
  let running = 0;

  function pendingCount(): number {
    let n = 0;
    for (const q of queues.values()) n += q.length;
    return n;
  }

  /** Round-robin: return the next runnable job from a workspace under its cap, or null. */
  function pickNext(): { key: string; job: () => Promise<void> } | null {
    for (let i = 0; i < ring.length; i++) {
      const key = ring[i];
      const q = queues.get(key);
      if (!q || q.length === 0) continue;
      if ((inFlight.get(key) ?? 0) >= maxPerWorkspace) continue;
      // Rotate the picked key to the back so the next pick favors other workspaces.
      ring.splice(i, 1);
      ring.push(key);
      return { key, job: q.shift()! };
    }
    return null;
  }

  function pump(): void {
    while (running < maxConcurrent) {
      const next = pickNext();
      if (!next) return;
      running += 1;
      inFlight.set(next.key, (inFlight.get(next.key) ?? 0) + 1);
      Promise.resolve()
        .then(next.job)
        .catch((error: unknown) => {
          // Still never let a job wedge the pump. But "the handler owns its own
          // error reporting" only holds for throws INSIDE the handler's try — a
          // throw before/around it used to vanish here with no trace anywhere.
          captureRunnerError(error, { run: "scheduler", kind: "escapedJob" });
        })
        .finally(() => {
          running -= 1;
          inFlight.set(next.key, Math.max(0, (inFlight.get(next.key) ?? 1) - 1));
          pump();
        });
    }
  }

  function schedule(workspaceKey: string, job: () => Promise<void>): void {
    const key = workspaceKey || "default";
    if (!queues.has(key)) {
      queues.set(key, []);
      ring.push(key);
    }
    queues.get(key)!.push(job);
    pump();
  }

  return {
    schedule,
    stats: () => ({ running, pending: pendingCount(), workspaces: queues.size }),
  };
}

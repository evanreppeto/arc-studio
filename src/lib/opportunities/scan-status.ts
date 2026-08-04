import { getCurrentOrgId } from "@/lib/auth/org";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { resolveTenantReadHandle } from "@/lib/supabase/tenant-client";

/**
 * The last thing Arc's background opportunity scan did, so the inbox can say so.
 *
 * Arc has scanned this workspace every day since 2026-08-01 and the product has
 * never mentioned it: the inbox shows a manual "Scan for opportunities" button
 * and nothing else, so proactive work reads as work nobody did. On 2026-08-04
 * that cost an hour — a scan ran, proposed nothing, failed to mark itself
 * complete, and the inbox looked exactly like a healthy quiet day.
 *
 * Everything here is derived from what actually happened, never from the cron
 * schedule. The schedule lives in vercel.json AND behind
 * OPPORTUNITY_SCAN_CRON_ENABLED, so a UI that promised "scans daily" would be
 * asserting something it cannot see and would lie the moment the flag is off.
 */

export type ScanOutcome =
  /** Never run for this workspace. */
  | "never"
  /** Claimed and working, or queued moments ago. */
  | "running"
  /** Queued long enough that nothing is coming — the wake never landed. */
  | "stalled"
  /** Finished and proposed at least one opportunity. */
  | "added"
  /** Finished and deliberately proposed nothing. */
  | "empty"
  /** Ended in error. */
  | "failed";

export type ScanStatus = {
  outcome: ScanOutcome;
  /** When the scan started; null when none has ever run. */
  startedAt: string | null;
  /** When it settled — null while running, stalled, or never run. */
  finishedAt: string | null;
  /** Opportunities proposed. Null when unknown (a task from before this was recorded). */
  proposed: number | null;
  /**
   * Arc's own account of the pass, or the error that stopped it. Null when the
   * task predates the runner persisting it.
   */
  detail: string | null;
};

/**
 * A queued scan older than this is not "about to start" — the wake was dropped.
 *
 * Real runs settle in about two minutes (13:00:47 -> 13:02:41 on 2026-08-03).
 * Twenty minutes is far outside that and well inside the daily cadence, so it
 * cannot mislabel a slow run or collide with the next day's.
 */
const STALLED_AFTER_MS = 20 * 60 * 1000;

type ScanTaskRow = {
  status: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown> | null;
};

/** Opportunities proposed, from what the runner recorded. Null when it recorded nothing. */
function proposedCount(metadata: Record<string, unknown> | null): number | null {
  const outputs = metadata?.outputs;
  if (!outputs || typeof outputs !== "object") return null;
  const actions = (outputs as Record<string, unknown>).actions;
  return Array.isArray(actions) ? actions.length : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Classify a raw task row. Pure, so the state machine is testable without a database. */
export function classifyScanTask(row: ScanTaskRow | null, now: number = Date.now()): ScanStatus {
  if (!row) {
    return { outcome: "never", startedAt: null, finishedAt: null, proposed: null, detail: null };
  }

  const status = (row.status ?? "").toLowerCase();
  const startedAt = row.started_at ?? row.created_at ?? null;
  const metadata = row.metadata ?? null;
  const detail = firstString(metadata?.completion_summary, metadata?.blocked_reason, metadata?.reason);
  const proposed = proposedCount(metadata);

  if (status === "completed") {
    // A completed scan that proposed nothing is a legitimate outcome, not a
    // fault — Arc had already raised every gap it could see. It still must not
    // look identical to a scan that never ran.
    return {
      outcome: proposed && proposed > 0 ? "added" : "empty",
      startedAt,
      finishedAt: row.completed_at ?? null,
      proposed,
      detail,
    };
  }

  if (status === "blocked" || status === "failed" || status === "error") {
    return { outcome: "failed", startedAt, finishedAt: row.completed_at ?? null, proposed, detail };
  }

  // Still open. Whether that means "working" or "never started" is a question of
  // age, and it is the distinction that mattered on 2026-08-04: the task sat in
  // `queued` for hours after its work was actually done.
  const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  const stalled = Number.isFinite(startedMs) && now - startedMs > STALLED_AFTER_MS;
  return { outcome: stalled ? "stalled" : "running", startedAt, finishedAt: null, proposed, detail };
}

/**
 * Most recent background opportunity scan for the current tenant.
 *
 * Correctly silent: a workspace with no scan history, or no Supabase, gets
 * `never` rather than an error — the inbox is still usable without this.
 */
export async function getLastScanStatus(orgId?: string): Promise<ScanStatus> {
  const none = classifyScanTask(null);
  if (!isSupabaseAdminConfigured()) return none;

  try {
    const { client, orgId: handleOrgId } = await resolveTenantReadHandle();
    const resolvedOrgId = orgId ?? handleOrgId ?? (await getCurrentOrgId());
    const { data, error } = await client
      .from("agent_tasks")
      .select("status,created_at,started_at,completed_at,metadata")
      .eq("org_id", resolvedOrgId)
      .eq("task_type", "arc_opportunity_scan")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<ScanTaskRow>();

    if (error || !data) return none;
    return classifyScanTask(data);
  } catch {
    return none;
  }
}

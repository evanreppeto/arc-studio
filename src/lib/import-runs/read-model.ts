import { type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

/**
 * Import history (BSR-643). Past runs, what each did, and — the part that takes
 * the fear out of importing — whether it can still be undone.
 *
 * Reversibility is computed at read time rather than stored, because it is a fact
 * about the world *now*: a run that was reversible an hour ago stops being so the
 * moment a campaign starts using one of its leads. A stored flag would go stale
 * silently, and an undo button that is wrong is worse than no undo button.
 */

export type ImportRunSummary = {
  id: string;
  source: string;
  status: string;
  operator: string | null;
  startedAt: string;
  finishedAt: string | null;
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ externalId: string; message: string }>;
  reversedAt: string | null;
  /** Whether "undo this import" is offered. */
  reversible: boolean;
  /** Why not, in words an operator can act on. Null when reversible. */
  blockedReason: string | null;
};

type RunRow = {
  id: string;
  source: string;
  status: string;
  operator: string | null;
  started_at: string;
  finished_at: string | null;
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: unknown;
  reversed_at: string | null;
};

type RecordRow = { import_run_id: string; local_id: string; action: string; previous: unknown };

const IN_USE =
  "Some of these records are now used by a campaign or an opportunity. Undoing would break work that came after.";
const SUPERSEDED =
  "A later import has since updated some of these records. Undoing would overwrite the newer values.";
const ALREADY = "This import has already been undone.";
const NOT_COMPLETED = "This import did not finish, so there is nothing consistent to undo.";

/**
 * Recent import runs for a workspace, newest first, each with its reversibility
 * resolved. Best-effort: an unavailable history is an empty list, never an
 * exception that takes the import page down with it.
 */
export async function listImportRuns(
  tenant: { orgId: string; workspaceId: string },
  client?: SupabaseClient,
  limit = 20,
): Promise<ImportRunSummary[]> {
  if (!client && !isSupabaseAdminConfigured()) return [];
  const db = client ?? getSupabaseAdminClient();

  try {
    const { data: runRows, error } = await db
      .from("import_runs")
      .select("id,source,status,operator,started_at,finished_at,imported,updated,skipped,failed,errors,reversed_at")
      .eq("org_id", tenant.orgId)
      .eq("workspace_id", tenant.workspaceId)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error || !runRows?.length) return [];

    const runs = runRows as RunRow[];
    const runIds = runs.map((r) => r.id);

    // Every record these runs touched, in one read. Reversibility needs to know
    // which leads are involved and whether anything has happened to them since.
    const { data: recordRows } = await db
      .from("import_run_records")
      .select("import_run_id,local_id,action,previous")
      .in("import_run_id", runIds);
    const records = (recordRows ?? []) as RecordRow[];

    const leadIds = [...new Set(records.map((r) => r.local_id))];
    const inUse = leadIds.length ? await leadsInUse(db, tenant.orgId, leadIds) : new Set<string>();

    // A lead touched by more than one run: only the newest run may be reversed,
    // or restoring an older snapshot would silently clobber the newer import.
    const newestRunForLead = new Map<string, string>();
    for (const run of runs) {
      for (const record of records) {
        if (record.import_run_id !== run.id) continue;
        if (!newestRunForLead.has(record.local_id)) newestRunForLead.set(record.local_id, run.id);
      }
    }

    return runs.map((run) => {
      const mine = records.filter((r) => r.import_run_id === run.id);
      const blockedReason =
        run.reversed_at ? ALREADY
        : run.status !== "completed" ? NOT_COMPLETED
        : mine.some((r) => inUse.has(r.local_id)) ? IN_USE
        : mine.some((r) => newestRunForLead.get(r.local_id) !== run.id) ? SUPERSEDED
        : null;

      return {
        id: run.id,
        source: run.source,
        status: run.status,
        operator: run.operator,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        imported: run.imported,
        updated: run.updated,
        skipped: run.skipped,
        failed: run.failed,
        errors: Array.isArray(run.errors) ? (run.errors as ImportRunSummary["errors"]) : [],
        reversedAt: run.reversed_at,
        reversible: blockedReason === null && mine.length > 0,
        blockedReason: mine.length === 0 && blockedReason === null ? "This import changed no records." : blockedReason,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Which of these leads downstream work now depends on. Undoing an import that a
 * campaign is built on would leave the campaign pointing at nothing, so those
 * runs stop being reversible — and the operator is told why rather than finding
 * a greyed-out button.
 */
async function leadsInUse(db: SupabaseClient, orgId: string, leadIds: string[]): Promise<Set<string>> {
  const used = new Set<string>();
  for (const table of ["campaigns", "approval_items"] as const) {
    const { data } = await db.from(table).select("lead_id").eq("org_id", orgId).in("lead_id", leadIds);
    for (const row of (data ?? []) as Array<{ lead_id: string | null }>) {
      if (row.lead_id) used.add(row.lead_id);
    }
  }
  return used;
}

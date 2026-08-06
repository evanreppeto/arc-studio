import { type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { listImportRuns } from "./read-model";

/**
 * Undo an import (BSR-643).
 *
 * Two different operations, and conflating them is the bug this design exists to
 * avoid: rows the run CREATED are deleted, rows it UPDATED are restored to the
 * snapshot taken before it wrote. A blanket delete would remove records that
 * existed long before the import and were merely touched by it.
 *
 * Deliberately narrow — it reverses `leads` only:
 *
 *  - Companies and contacts an import created alongside a lead are NOT deleted.
 *    By the time anyone undoes, another lead may reference the same company, and
 *    deleting it would destroy data the run never owned. Leaving a company behind
 *    is untidy; deleting one that is in use is unrecoverable.
 *  - Reversibility is re-checked here, not trusted from the page that rendered
 *    the button. A run can stop being reversible between render and click.
 */

export type ReverseResult =
  | { ok: true; deleted: number; restored: number; skipped: number }
  | { ok: false; error: string };

type RecordRow = { local_id: string; action: string; previous: Record<string, unknown> | null };

export async function reverseImportRun(
  tenant: { orgId: string; workspaceId: string },
  importRunId: string,
  client?: SupabaseClient,
): Promise<ReverseResult> {
  if (!client && !isSupabaseAdminConfigured()) return { ok: false, error: "not_configured" };
  const db = client ?? getSupabaseAdminClient();

  // Re-check rather than trust the caller. The button was rendered from a read
  // that is now seconds or minutes old.
  const runs = await listImportRuns(tenant, db, 50);
  const run = runs.find((r) => r.id === importRunId);
  if (!run) return { ok: false, error: "That import is not in this workspace's history." };
  if (!run.reversible) return { ok: false, error: run.blockedReason ?? "That import can no longer be undone." };

  const { data, error } = await db
    .from("import_run_records")
    .select("local_id,action,previous")
    .eq("import_run_id", importRunId)
    .eq("org_id", tenant.orgId);
  if (error) return { ok: false, error: "Could not read what that import changed." };

  const records = (data ?? []) as RecordRow[];
  const created = records.filter((r) => r.action === "created").map((r) => r.local_id);
  const updated = records.filter((r) => r.action === "updated");

  let deleted = 0;
  let restored = 0;
  let skipped = 0;

  if (created.length) {
    const { error: deleteError, count } = await db
      .from("leads")
      .delete({ count: "exact" })
      .eq("org_id", tenant.orgId)
      .in("id", created);
    if (deleteError) return { ok: false, error: "Could not remove the records that import created." };
    deleted = count ?? created.length;
  }

  for (const record of updated) {
    // An update with no usable snapshot cannot be restored — that happens when the
    // snapshot read failed during the import, or for runs imported before BSR-643
    // existed. Counted and reported rather than silently treated as restored.
    const previous = record.previous;
    if (!previous || typeof previous !== "object" || Object.keys(previous).length === 0) {
      skipped += 1;
      continue;
    }
    // Never write identity or tenancy back from a snapshot: restoring those would
    // let a corrupted snapshot move a row between tenants.
    const { id: _id, org_id: _orgId, created_at: _createdAt, ...restorable } = previous as Record<string, unknown>;
    const { error: updateError } = await db
      .from("leads")
      .update(restorable)
      .eq("id", record.local_id)
      .eq("org_id", tenant.orgId);
    if (updateError) skipped += 1;
    else restored += 1;
  }

  await db
    .from("import_runs")
    .update({ reversed_at: new Date().toISOString(), reversible: false })
    .eq("id", importRunId)
    .eq("org_id", tenant.orgId);

  return { ok: true, deleted, restored, skipped };
}

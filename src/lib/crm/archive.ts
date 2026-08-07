import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import type { CrmObjectKey } from "./read-model";

/**
 * Archive and restore CRM records.
 *
 * This is the product's delete. Nothing is destroyed: `archived_at` is set, the
 * record drops out of every list and count, and clearing the column brings it
 * back whole. That matters more here than in most CRMs — a record is referenced
 * by campaigns, tasks, notes and the revenue ledger, so a hard delete would
 * either cascade through the outcome history or be refused by the FK graph.
 *
 * Org-scoped on the WRITE, not just the read. The id alone is a valid uuid from
 * anywhere; without the org predicate a caller who learned an id could archive
 * another tenant's record, and the write would look perfectly ordinary in the
 * logs. Every statement here carries `.eq("org_id", orgId)`.
 */

export type ArchiveResult =
  | { ok: true; persisted: boolean; count: number }
  | { ok: false; error: string };

const ARCHIVABLE: ReadonlySet<CrmObjectKey> = new Set<CrmObjectKey>([
  "companies",
  "contacts",
  "properties",
  "leads",
  "jobs",
  "outcomes",
]);

export function isArchivableObject(key: string): key is CrmObjectKey {
  return ARCHIVABLE.has(key as CrmObjectKey);
}

async function setArchivedAt(
  objectKey: CrmObjectKey,
  ids: string[],
  orgId: string,
  value: string | null,
): Promise<ArchiveResult> {
  if (!isArchivableObject(objectKey)) return { ok: false, error: "Unknown record type." };
  if (ids.length === 0) return { ok: true, persisted: false, count: 0 };
  // No org means no tenant to scope to. Writing anyway would reach every
  // tenant's rows at once — refuse rather than guess (BSR-626's shape).
  if (!orgId) return { ok: false, error: "No workspace is selected." };
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false, count: 0 };

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from(objectKey)
    .update({ archived_at: value })
    .in("id", ids)
    .eq("org_id", orgId)
    .select("id");

  if (error) {
    return { ok: false, error: error.message || "Could not update those records." };
  }
  // The count is what came BACK, not what was asked for. An id belonging to
  // another org matches the `in` and fails the `eq`, so it silently updates
  // nothing — and reporting the requested length would claim it worked.
  return { ok: true, persisted: true, count: (data ?? []).length };
}

/** Soft-delete: hide from every list, count and Arc read. Reversible. */
export function archiveCrmRecords(objectKey: CrmObjectKey, ids: string[], orgId: string): Promise<ArchiveResult> {
  return setArchivedAt(objectKey, ids, orgId, new Date().toISOString());
}

/** Bring archived records back, exactly as they were. */
export function restoreCrmRecords(objectKey: CrmObjectKey, ids: string[], orgId: string): Promise<ArchiveResult> {
  return setArchivedAt(objectKey, ids, orgId, null);
}

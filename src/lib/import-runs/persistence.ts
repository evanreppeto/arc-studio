import { type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

/**
 * Import runs and per-record provenance (BSR-640).
 *
 * Every import now leaves a record of itself: what it was, which workspace ran it,
 * what it did to each row, and whether it can still be reversed. Before this, an
 * import returned counts to the browser and vanished — which is why "import
 * whenever you want" read as risky, and why there was no way to answer "where did
 * these 400 contacts come from".
 *
 * Everything here is BEST-EFFORT on purpose. Provenance is bookkeeping around the
 * import, not part of it: a failure to record must never fail or partially roll
 * back a customer's data import. Each function therefore swallows its own errors
 * and reports through the return value instead of throwing.
 */

export type ImportSource = "csv" | "hubspot" | "mailchimp" | "salesforce" | "pipedrive" | "jobber" | "google_contacts";

/**
 * `external_systems.system_kind` is the pre-existing `external_system_kind` ENUM,
 * and `status` is `integration_status` — neither has a "crm" or "active" member.
 * These are the real labels, mapped per source, with `other` as the honest answer
 * for a file upload that is not a platform at all. Mocked tests cannot see an enum
 * violation, so this mapping is verified against real Postgres in CI's chain job.
 */
const EXTERNAL_SYSTEM_KIND: Record<ImportSource, string> = {
  csv: "other",
  google_contacts: "other",
  hubspot: "marketing_platform",
  salesforce: "marketing_platform",
  pipedrive: "marketing_platform",
  jobber: "marketing_platform",
  mailchimp: "email_platform",
};

export type ImportRunTenant = { orgId: string; workspaceId: string };

export type StartImportRunInput = ImportRunTenant & {
  source: ImportSource;
  operator?: string | null;
  /** What the run was told to do — persona, mapping, source config. Never credentials. */
  options?: Record<string, unknown>;
  client?: SupabaseClient;
};

export type ImportRunCounts = {
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  enriched: number;
  pages: number;
  errors: Array<{ externalId: string; message: string }>;
};

export type RecordedAction = "created" | "updated";

export type ImportRecordInput = {
  importRunId: string;
  localTable: string;
  localId: string;
  externalId?: string | null;
  action: RecordedAction;
  /** Prior column values, for an update a reversal could restore. */
  previous?: Record<string, unknown> | null;
};

/**
 * Open a run. Returns its id, or null when there is no database or the insert
 * fails — callers treat a null id as "run without provenance" and carry on, because
 * refusing to import because we could not write a log entry would be the wrong
 * trade every time.
 */
export async function startImportRun(input: StartImportRunInput): Promise<string | null> {
  if (!input.client && !isSupabaseAdminConfigured()) return null;
  const client = input.client ?? getSupabaseAdminClient();

  // Catching, not just checking `error`. A returned error is the expected failure;
  // a THROW is the one that would take the customer's import down with it — a
  // missing table, a client that does not implement the call. "Best-effort" has to
  // mean it, or the first unexpected shape turns bookkeeping into an outage.
  try {
    const { data, error } = await client
      .from("import_runs")
      .insert({
        org_id: input.orgId,
        workspace_id: input.workspaceId,
        source: input.source,
        status: "running",
        operator: input.operator ?? null,
        options: input.options ?? {},
      })
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error || !data?.id) return null;
    return data.id;
  } catch {
    return null;
  }
}

/**
 * Close a run with its outcome. `status` is "failed" only when the run itself blew
 * up — a run that completed with some skipped or failed *records* is still
 * "completed", because it did what it was asked and the per-record errors are the
 * report, not an exception.
 */
export async function finishImportRun(
  importRunId: string | null,
  outcome: { status: "completed" | "failed"; counts?: Partial<ImportRunCounts> },
  client?: SupabaseClient,
): Promise<void> {
  if (!importRunId) return;
  if (!client && !isSupabaseAdminConfigured()) return;
  const db = client ?? getSupabaseAdminClient();
  const counts = outcome.counts ?? {};

  try {
    await db
      .from("import_runs")
      .update({
        status: outcome.status,
        finished_at: new Date().toISOString(),
        imported: counts.imported ?? 0,
        updated: counts.updated ?? 0,
        skipped: counts.skipped ?? 0,
        failed: counts.failed ?? 0,
        enriched: counts.enriched ?? 0,
        pages: counts.pages ?? 0,
        errors: counts.errors ?? [],
      })
      .eq("id", importRunId);
  } catch {
    // A run left as "running" is a worse record than none, but it is still far
    // better than failing an import that already succeeded.
  }
}

/**
 * Record what a run did to one row. Two writes, both idempotent-ish and both
 * best-effort:
 *
 *  - `import_run_records` — the per-run event, carrying created-vs-updated. This
 *    is the distinction an undo depends on: a blanket delete would remove rows
 *    that existed before the run and were merely updated by it.
 *  - `external_object_mappings` — the stable external-id ↔ local-row map, upserted
 *    so a re-import points at the same row rather than accumulating duplicates.
 */
export async function recordImportedRecord(
  tenant: ImportRunTenant,
  input: ImportRecordInput,
  externalSystemId: string | null,
  client?: SupabaseClient,
): Promise<void> {
  if (!client && !isSupabaseAdminConfigured()) return;
  const db = client ?? getSupabaseAdminClient();

  try {
    await writeRecord(db, tenant, input, externalSystemId);
  } catch {
    // Same contract as the rest of this module: never fail an import over its log.
  }
}

async function writeRecord(
  db: SupabaseClient,
  tenant: ImportRunTenant,
  input: ImportRecordInput,
  externalSystemId: string | null,
): Promise<void> {
  await db.from("import_run_records").insert({
    import_run_id: input.importRunId,
    org_id: tenant.orgId,
    workspace_id: tenant.workspaceId,
    local_table: input.localTable,
    local_id: input.localId,
    external_id: input.externalId ?? null,
    action: input.action,
    // Only meaningful for an update — there is nothing to restore a created row to.
    previous: input.action === "updated" ? (input.previous ?? {}) : {},
  });

  if (!externalSystemId || !input.externalId) return;

  await db
    .from("external_object_mappings")
    .upsert(
      {
        org_id: tenant.orgId,
        workspace_id: tenant.workspaceId,
        external_system_id: externalSystemId,
        external_object_type: input.localTable,
        external_object_id: input.externalId,
        local_table: input.localTable,
        local_id: input.localId,
        last_modified_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,external_system_id,external_object_type,external_object_id" },
    );
}

/**
 * Resolve (creating if needed) the `external_systems` row for a source in this
 * workspace. Mappings hang off it, so an import needs one before it can record
 * identity — but never at the cost of the import itself, hence the null return.
 */
export async function resolveExternalSystemId(
  tenant: ImportRunTenant,
  source: ImportSource,
  client?: SupabaseClient,
): Promise<string | null> {
  if (!client && !isSupabaseAdminConfigured()) return null;
  const db = client ?? getSupabaseAdminClient();

  try {
    const existing = await db
      .from("external_systems")
      .select("id")
      .eq("workspace_id", tenant.workspaceId)
      .eq("system_key", source)
      .maybeSingle<{ id: string }>();
    if (existing.data?.id) return existing.data.id;

    const { data, error } = await db
      .from("external_systems")
      .insert({
        org_id: tenant.orgId,
        workspace_id: tenant.workspaceId,
        system_key: source,
        system_kind: EXTERNAL_SYSTEM_KIND[source],
        status: "connected",
      })
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error || !data?.id) return null;
    return data.id;
  } catch {
    return null;
  }
}

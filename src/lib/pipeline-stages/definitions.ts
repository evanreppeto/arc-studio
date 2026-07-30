import { type SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_PIPELINE_STAGES,
  findStage,
  type PipelineObjectKey,
  type PipelineStage,
} from "@/domain";

import { getSupabaseAdminClient } from "@/lib/supabase/server";

// Untyped SupabaseClient: `pipeline_stages` isn't in the generated
// database.types yet (that regenerates against a DB with the migration
// applied), matching how the custom-fields/support/vault layers handle theirs.

const TABLE = "pipeline_stages";

/**
 * The record table each pipeline belongs to. The object keys are the table
 * names, but going through a map keeps the string that reaches a query out of
 * the caller's hands — `objectKey` arrives from a form.
 */
const RECORD_TABLE: Record<PipelineObjectKey, string> = {
  leads: "leads",
  jobs: "jobs",
  outcomes: "outcomes",
};

export type StageWriteResult = { ok: true; stages: PipelineStage[] } | { ok: false; error: string };

function rowToStage(row: Record<string, unknown>): PipelineStage {
  return {
    key: String(row.key),
    label: String(row.label),
    sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
    isTerminal: row.is_terminal === true,
    isWon: row.is_won === true,
    isLost: row.is_lost === true,
    isQualified: row.is_qualified === true,
    active: row.active !== false,
  };
}

/**
 * The org's complete stage set for one object, ARCHIVED INCLUDED.
 *
 * Distinct from `getPipelineStages` in read-model.ts on purpose: that one is the
 * hot read path and hands back only active stages, falling back to the defaults
 * so reporting can never read zero. This one is the authoring path, and the
 * settings screen has to see archived stages in order to offer restoring them.
 *
 * An org with no rows yet gets the defaults — workspace onboarding seeds them,
 * but a workspace created before that did not, and the first edit materialises
 * the whole set rather than writing one lonely custom stage into an empty table.
 *
 * Unlike the read path this THROWS on error. A settings screen that renders the
 * defaults after a failed read invites a tenant to "restore" stages they never
 * lost and overwrite the ones they have.
 */
export async function listStageSet(
  orgId: string,
  objectKey: PipelineObjectKey,
  opts: { client?: SupabaseClient } = {},
): Promise<PipelineStage[]> {
  const client = opts.client ?? getSupabaseAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select("key,label,sort_order,is_terminal,is_won,is_lost,is_qualified,active")
    .eq("org_id", orgId)
    .eq("object_key", objectKey)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(`Failed to load pipeline stages: ${error.message}`);
  if (!data || data.length === 0) return [...DEFAULT_PIPELINE_STAGES[objectKey]];

  return data.map((row) => rowToStage(row as Record<string, unknown>));
}

/** Every object's stage set, for the settings screen. */
export async function listAllStageSets(
  orgId: string,
  opts: { client?: SupabaseClient } = {},
): Promise<Record<PipelineObjectKey, PipelineStage[]>> {
  const client = opts.client ?? getSupabaseAdminClient();
  const [leads, jobs, outcomes] = await Promise.all([
    listStageSet(orgId, "leads", { client }),
    listStageSet(orgId, "jobs", { client }),
    listStageSet(orgId, "outcomes", { client }),
  ]);
  return { leads, jobs, outcomes };
}

/**
 * Persist a validated set.
 *
 * Writes the WHOLE set every time, which is what makes materialising the
 * defaults on first edit work, and means a reorder can't leave two stages
 * claiming the same position. Callers must have run the set through the domain
 * transforms first — this does not re-validate, it stores.
 */
export async function saveStageSet(
  orgId: string,
  objectKey: PipelineObjectKey,
  stages: readonly PipelineStage[],
  opts: { client?: SupabaseClient } = {},
): Promise<StageWriteResult> {
  const client = opts.client ?? getSupabaseAdminClient();
  const now = new Date().toISOString();

  const rows = stages.map((s) => ({
    org_id: orgId,
    object_key: objectKey,
    key: s.key,
    label: s.label,
    sort_order: s.sortOrder,
    is_terminal: s.isTerminal,
    is_won: s.isWon,
    is_lost: s.isLost,
    is_qualified: s.isQualified,
    active: s.active,
    updated_at: now,
  }));

  const { error } = await client.from(TABLE).upsert(rows, { onConflict: "org_id,object_key,key" });
  if (error) return { ok: false, error: `Could not save the pipeline: ${error.message}` };

  return { ok: true, stages: [...stages] };
}

/**
 * How many of the org's records currently sit in a stage.
 *
 * The number behind the archive warning. `findStage` returns null by design
 * rather than guessing, so a record left pointing at an archived stage renders
 * blank and drops out of every filter — this is what stops that happening
 * silently.
 */
export async function countRecordsInStage(
  orgId: string,
  objectKey: PipelineObjectKey,
  stageKey: string,
  opts: { client?: SupabaseClient } = {},
): Promise<number> {
  const client = opts.client ?? getSupabaseAdminClient();
  const { count, error } = await client
    .from(RECORD_TABLE[objectKey])
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", stageKey);

  // Fail loud, not low. Reporting zero occupants would let the caller archive a
  // stage full of records without ever showing the warning.
  if (error) throw new Error(`Could not count records in "${stageKey}": ${error.message}`);
  return count ?? 0;
}

/** Occupancy for every stage in one set, so the panel can label each row. */
export async function countRecordsByStage(
  orgId: string,
  objectKey: PipelineObjectKey,
  opts: { client?: SupabaseClient } = {},
): Promise<Record<string, number>> {
  const client = opts.client ?? getSupabaseAdminClient();
  const { data, error } = await client
    .from(RECORD_TABLE[objectKey])
    .select("status")
    .eq("org_id", orgId);

  if (error) throw new Error(`Could not count records by stage: ${error.message}`);

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const status = String((row as { status?: unknown }).status ?? "").trim();
    if (!status) continue;
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

/**
 * Move every record out of one stage and into another.
 *
 * Runs BEFORE the archive is persisted, so a failure here leaves the stage
 * active and the records where they were — the safe direction. Archiving first
 * and moving second would strand them on any error.
 */
export async function moveRecordsToStage(
  orgId: string,
  objectKey: PipelineObjectKey,
  fromKey: string,
  toKey: string,
  opts: { client?: SupabaseClient } = {},
): Promise<{ ok: true; moved: number } | { ok: false; error: string }> {
  if (fromKey === toKey) return { ok: false, error: "Pick a different stage to move these records to." };

  const client = opts.client ?? getSupabaseAdminClient();

  // The target must be a real, active stage of this org's own pipeline. Without
  // this a caller could park records on a key that maps to nothing, which is the
  // exact state the move exists to prevent.
  const stages = await listStageSet(orgId, objectKey, { client });
  const target = findStage(stages, toKey);
  if (!target || !target.active) {
    return { ok: false, error: "That stage is not available to move records into." };
  }

  const { data, error } = await client
    .from(RECORD_TABLE[objectKey])
    .update({ status: toKey, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("status", fromKey)
    .select("id");

  if (error) return { ok: false, error: `Could not move the records: ${error.message}` };
  return { ok: true, moved: (data ?? []).length };
}

/**
 * Seed a new workspace with the default stages.
 *
 * Mirrors `seedDefaultPersonas`: a no-op when the org already has stages, so it
 * is safe to call on every workspace creation and safe to re-run.
 */
export async function seedDefaultPipelineStages(
  { orgId, client }: { orgId: string; client?: SupabaseClient },
): Promise<number> {
  const supabase = client ?? getSupabaseAdminClient();

  const { count, error: countError } = await supabase
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  if (countError) throw new Error(`pipeline stages count failed: ${countError.message}`);
  if ((count ?? 0) > 0) return 0;

  const rows = (Object.keys(DEFAULT_PIPELINE_STAGES) as PipelineObjectKey[]).flatMap((objectKey) =>
    DEFAULT_PIPELINE_STAGES[objectKey].map((s) => ({
      org_id: orgId,
      object_key: objectKey,
      key: s.key,
      label: s.label,
      sort_order: s.sortOrder,
      is_terminal: s.isTerminal,
      is_won: s.isWon,
      is_lost: s.isLost,
      is_qualified: s.isQualified,
      active: s.active,
    })),
  );

  const { error } = await supabase.from(TABLE).insert(rows);
  if (error) throw new Error(`pipeline stages seed failed: ${error.message}`);
  return rows.length;
}

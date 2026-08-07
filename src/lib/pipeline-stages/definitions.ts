import { requireCount } from "@/lib/supabase/count";
import { type SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_PIPELINE_STAGES,
  findStage,
  type PipelineObjectKey,
  type PipelineStage,
  isPipelineObjectKey,
} from "@/domain";

import { getSupabaseAdminClient } from "@/lib/supabase/server";

import { stagesForIndustry } from "./industry-templates";

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

type RecordSource = { table: string; objectId?: string };

async function recordSource(
  orgId: string,
  objectKey: PipelineObjectKey | string,
  client: SupabaseClient,
): Promise<RecordSource | null> {
  if (isPipelineObjectKey(objectKey)) return { table: RECORD_TABLE[objectKey] };

  const { data } = await client
    .from("custom_objects")
    .select("id")
    .eq("org_id", orgId)
    .eq("key", objectKey)
    .maybeSingle();
  const id = (data as { id?: string } | null)?.id;
  return id ? { table: "custom_object_records", objectId: id } : null;
}

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
  // Widened: a tenant-defined record type's key is valid here too, and which
  // keys exist is per-workspace.
  objectKey: PipelineObjectKey | string,
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
  // Same asymmetry as the read-model: the six seed from defaults when the org
  // has no rows yet, a tenant-defined type gets an EMPTY set. Empty is what the
  // settings screen shows as "no pipeline yet, add one" and what the board
  // reads as "leave the status column off" — handing back a lead's stages here
  // would put "Qualified" on a forklift.
  if (!data || data.length === 0) {
    return isPipelineObjectKey(objectKey) ? [...DEFAULT_PIPELINE_STAGES[objectKey]] : [];
  }

  return data.map((row) => rowToStage(row as Record<string, unknown>));
}

/** Every object's stage set, for the settings screen. */
export async function listAllStageSets(
  orgId: string,
  opts: { client?: SupabaseClient; extraObjectKeys?: readonly string[] } = {},
): Promise<Record<string, PipelineStage[]>> {
  const client = opts.client ?? getSupabaseAdminClient();
  const [leads, jobs, outcomes] = await Promise.all([
    listStageSet(orgId, "leads", { client }),
    listStageSet(orgId, "jobs", { client }),
    listStageSet(orgId, "outcomes", { client }),
  ]);
  const sets: Record<string, PipelineStage[]> = { leads, jobs, outcomes };

  // Tenant-defined types, when the caller names them. They are not discovered
  // here because this layer knows nothing about custom_objects, and a stage set
  // is only meaningful next to the object it belongs to.
  //
  // A type with no stages still appears, as an empty set: that is what lets the
  // settings screen offer "add a pipeline to this" rather than hiding every
  // type that does not have one yet — which would make the feature reachable
  // only by workspaces that already had it.
  for (const key of opts.extraObjectKeys ?? []) {
    sets[key] = await listStageSet(orgId, key, { client });
  }
  return sets;
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
  objectKey: PipelineObjectKey | string,
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
  objectKey: PipelineObjectKey | string,
  stageKey: string,
  opts: { client?: SupabaseClient } = {},
): Promise<number> {
  const client = opts.client ?? getSupabaseAdminClient();
  const source = await recordSource(orgId, objectKey, client);
  if (!source) return 0;

  let q = client
    .from(source.table)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", stageKey);
  if (source.objectId) q = q.eq("object_id", source.objectId);
  if (source.table === "custom_object_records") q = q.is("archived_at", null);
  const { count, error } = await q;

  // Fail loud, not low. Reporting zero occupants would let the caller archive a
  // stage full of records without ever showing the warning.
  if (error) throw new Error(`Could not count records in "${stageKey}": ${error.message}`);
  // ...and a null count is exactly that low reading: a missing relation on a
  // HEAD count reports no error at all (BSR-575).
  return requireCount(`records in "${stageKey}"`, { count, error });
}

/**
 * Which table holds this pipeline's records, and how to narrow to them.
 *
 * The three built-ins each own a table. A tenant-defined type shares
 * custom_object_records with every other type, so it narrows by `object_id` —
 * without that narrowing, counting "Equipment" in a stage would count every
 * custom record in the workspace, and the archive guard that reads these counts
 * would refuse or allow on the wrong number.
 */
/** Occupancy for every stage in one set, so the panel can label each row. */
export async function countRecordsByStage(
  orgId: string,
  objectKey: PipelineObjectKey | string,
  opts: { client?: SupabaseClient } = {},
): Promise<Record<string, number>> {
  const client = opts.client ?? getSupabaseAdminClient();
  const source = await recordSource(orgId, objectKey, client);
  // A key naming no known object has no records — zero, not an exception, so a
  // stale deep link cannot take the settings screen down.
  if (!source) return {};

  let query = client.from(source.table).select("status").eq("org_id", orgId);
  if (source.objectId) query = query.eq("object_id", source.objectId);
  // Archived records are gone from the operator's lists, so counting them as
  // stage occupants would block an archive over rows nobody can see.
  if (source.table === "custom_object_records") query = query.is("archived_at", null);
  const { data, error } = await query;

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
  objectKey: PipelineObjectKey | string,
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

  const source = await recordSource(orgId, objectKey, client);
  if (!source) return { ok: false, error: "Unknown pipeline." };

  // `object_id` is not optional here in the way it looks. Every tenant-defined
  // type shares custom_object_records, so an unnarrowed update would move EVERY
  // custom record in the workspace that happens to share this status — a
  // permit's "retired" swept along with a forklift's.
  let q = client
    .from(source.table)
    .update({ status: toKey, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("status", fromKey);
  if (source.objectId) q = q.eq("object_id", source.objectId);
  const { data, error } = await q.select("id");

  if (error) return { ok: false, error: `Could not move the records: ${error.message}` };
  return { ok: true, moved: (data ?? []).length };
}

/**
 * Seed a new workspace with its industry's starter stages.
 *
 * Mirrors `seedDefaultPersonas` in both shape and guarantee: the industry picks
 * the set (`stagesForIndustry`), and this is a no-op when the org already has
 * stages — so it is safe to call on every workspace creation, safe to re-run,
 * and CANNOT move an existing tenant's stages or the reporting built on them.
 */
export async function seedDefaultPipelineStages(
  { orgId, client, industry }: { orgId: string; client?: SupabaseClient; industry?: string | null },
): Promise<number> {
  const supabase = client ?? getSupabaseAdminClient();

  const { count, error: countError } = await supabase
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  // Fail closed: a null count read as 0 would re-seed the default stages.
  if (requireCount("pipeline_stages", { count, error: countError }) > 0) return 0;

  // The workspace's industry picks the starter set; `general` and anything
  // unrecognised fall back to DEFAULT_PIPELINE_STAGES, so this is never empty.
  const starter = stagesForIndustry(industry);
  const rows = (Object.keys(starter) as PipelineObjectKey[]).flatMap((objectKey) =>
    starter[objectKey].map((s) => ({
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

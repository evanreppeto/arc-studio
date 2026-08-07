import { type SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_PIPELINE_STAGES,
  type PipelineObjectKey,
  type PipelineStage,
  isPipelineObjectKey,
} from "@/domain";

import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

// Untyped SupabaseClient: `pipeline_stages` isn't in the generated
// database.types yet (that regenerates against a DB with the migration
// applied), matching how the custom-fields/support/vault layers handle theirs.

const TABLE = "pipeline_stages";

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
 * The org's stages for one pipeline object.
 *
 * Falls back to `DEFAULT_PIPELINE_STAGES` when the org has none — which is what
 * every org had before the seed, and what the offline/demo preview has. The
 * fallback is the SAME set the migration seeds, so a fallback read and a real
 * read agree; it is not a guess at someone else's vocabulary.
 *
 * Org-scoped explicitly — the service-role client bypasses RLS, so the tenant
 * filter is the caller's responsibility (same contract as every other
 * admin-client read in src/lib).
 */
export async function getPipelineStages(
  orgId: string,
  // A built-in pipeline OR a tenant-defined record type's key. Widened from
  // PipelineObjectKey because which keys are valid is per-workspace once a
  // tenant can define its own types.
  objectKey: PipelineObjectKey | string,
  opts: { client?: SupabaseClient } = {},
): Promise<PipelineStage[]> {
  /**
   * A tenant-defined type gets NO fallback, and that asymmetry is the feature.
   *
   * The six have a default pipeline because the product knows the shape of a
   * lead's lifecycle. It has no idea what "Equipment" moves through, and
   * guessing wrong is worse than staying quiet — so an empty result means "this
   * type has no pipeline", which is exactly what the UI keys off to stay out of
   * the way. Handing back a lead's stages here would put "Qualified" on a
   * forklift.
   */
  const fallback = isPipelineObjectKey(objectKey) ? [...DEFAULT_PIPELINE_STAGES[objectKey]] : [];
  if (!orgId) return fallback;

  // No database configured is not a failure to read — it is the backend-less
  // preview, where every other read falls back too. Without this guard
  // `getSupabaseAdminClient()` THROWS, and because this is called while building
  // the CRM bundle it took the whole page down rather than degrading. Callers
  // are entitled to the fallback this function documents, not an exception.
  if (!opts.client && !isSupabaseAdminConfigured()) return fallback;

  const client = opts.client ?? getSupabaseAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select("key,label,sort_order,is_terminal,is_won,is_lost,is_qualified,active")
    .eq("org_id", orgId)
    .eq("object_key", objectKey)
    .eq("active", true)
    .order("sort_order", { ascending: true });

  // Reporting must not break because the stage table is unavailable. The
  // fallback is today's values, so numbers stay correct rather than reading
  // zero — which is the exact failure this whole change exists to prevent.
  if (error || !data || data.length === 0) return fallback;

  return data.map((row) => rowToStage(row as Record<string, unknown>));
}

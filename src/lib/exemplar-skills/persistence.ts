import "server-only";

/**
 * Persistence for generated exemplar skills (`arc_generated_skills`).
 *
 * Rows are upserted on `(org_id, key)` so regenerating a slice replaces it rather
 * than accumulating stale copies of a workspace's voice. Everything is org-scoped
 * and refuses without an org rather than defaulting to one.
 */

import { type SupabaseClient } from "@supabase/supabase-js";

import { type EvidenceTier } from "@/domain";
import { ARC_SKILL_IDS } from "@/lib/arc-skills/catalog";
import { type WorkspaceArcSkill } from "@/lib/arc-skills/custom";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { soleWorkspaceIdForOrg } from "@/lib/tenancy/resolve-workspace";

export const ARC_GENERATED_SKILLS_TABLE = "arc_generated_skills";

export type GeneratedSkillRecord = {
  key: string;
  name: string;
  description: string;
  command: string;
  assetType: string | null;
  persona: string | null;
  evidenceTier: EvidenceTier;
  instructions: string;
  exemplarCount: number;
  sourceAssetIds: string[];
  counterExampleAssetIds: string[];
  generatedAt: string;
};

type GeneratedSkillRow = {
  key: string;
  name: string;
  description: string;
  command: string;
  asset_type: string | null;
  persona: string | null;
  evidence_tier: string;
  instructions: string;
  exemplar_count: number | null;
  source_asset_ids: unknown;
  counter_example_asset_ids: unknown;
  generated_at: string;
};

const COLUMNS =
  "key,name,description,command,asset_type,persona,evidence_tier,instructions,exemplar_count,source_asset_ids,counter_example_asset_ids,generated_at";

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toRecord(row: GeneratedSkillRow): GeneratedSkillRecord {
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    command: row.command,
    assetType: row.asset_type,
    persona: row.persona,
    evidenceTier: row.evidence_tier as EvidenceTier,
    instructions: row.instructions,
    exemplarCount: row.exemplar_count ?? 0,
    sourceAssetIds: stringArray(row.source_asset_ids),
    counterExampleAssetIds: stringArray(row.counter_example_asset_ids),
    generatedAt: row.generated_at,
  };
}

/**
 * Map a stored record onto the shape the runner already knows how to load, so a
 * generated skill flows through the same command routing and read-only
 * instruction injection as an imported one.
 */
export function toWorkspaceArcSkill(record: GeneratedSkillRecord, workspaceName: string): WorkspaceArcSkill {
  return {
    key: record.key,
    id: ARC_SKILL_IDS.approvalGatedDrafting,
    name: record.name,
    description: record.description,
    prompt: record.description,
    commands: [record.command],
    mode: "draft",
    source: "generated",
    publisher: workspaceName,
    instructions: record.instructions,
  };
}

/**
 * `workspaceId` is optional because the caller's workspace context carries it as
 * `string | null`. When it is absent this derives the org's sole workspace rather
 * than writing an unscoped row — same precedence as BSR-712's backfill, so a row
 * written now and a row backfilled then agree. If neither resolves, the column is
 * left unset: nullable through Phase A, and a NULL is what BSR-713's gate is for.
 */
export async function saveGeneratedSkill(
  orgId: string,
  record: GeneratedSkillRecord,
  client?: SupabaseClient,
  workspaceId?: string | null,
): Promise<void> {
  const supabase = client ?? getSupabaseAdminClient();
  const resolved = workspaceId ?? (await soleWorkspaceIdForOrg(supabase, orgId));
  const { error } = await supabase.from(ARC_GENERATED_SKILLS_TABLE).upsert(
    {
      org_id: orgId,
      ...(resolved ? { workspace_id: resolved } : {}),
      key: record.key,
      name: record.name,
      description: record.description,
      command: record.command,
      asset_type: record.assetType,
      persona: record.persona,
      evidence_tier: record.evidenceTier,
      instructions: record.instructions,
      exemplar_count: record.exemplarCount,
      source_asset_ids: record.sourceAssetIds,
      counter_example_asset_ids: record.counterExampleAssetIds,
      generated_at: record.generatedAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,key" },
  );
  if (error) throw new Error(`${ARC_GENERATED_SKILLS_TABLE} upsert: ${error.message}`);
}

export async function listGeneratedSkills(
  orgId: string | null | undefined,
  client?: SupabaseClient,
): Promise<GeneratedSkillRecord[]> {
  if (!orgId) return [];
  const supabase = client ?? (isSupabaseAdminConfigured() ? getSupabaseAdminClient() : null);
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(ARC_GENERATED_SKILLS_TABLE)
    .select(COLUMNS)
    .eq("org_id", orgId)
    .order("generated_at", { ascending: false });
  if (error) return [];
  return ((data ?? []) as GeneratedSkillRow[]).map(toRecord);
}

export async function deleteGeneratedSkill(
  orgId: string,
  key: string,
  client?: SupabaseClient,
): Promise<void> {
  const supabase = client ?? getSupabaseAdminClient();
  const { error } = await supabase.from(ARC_GENERATED_SKILLS_TABLE).delete().eq("org_id", orgId).eq("key", key);
  if (error) throw new Error(`${ARC_GENERATED_SKILLS_TABLE} delete: ${error.message}`);
}

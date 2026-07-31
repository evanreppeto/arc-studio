import { requireCount } from "@/lib/supabase/count";
import { type SupabaseClient } from "@supabase/supabase-js";

import { personasForIndustry } from "./industry-templates";
import { type PersonaSegmentKey, type PersonaStage } from "./demo-personas";
import { getCurrentOrgId } from "@/lib/auth/org";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

import { clampScore, initialsFrom, slugify } from "./console";

export type NewPersonaInput = {
  name: string;
  segment: PersonaSegmentKey;
  stage: PersonaStage;
  score: number;
  angle: string;
  audience: string;
  cta: string;
  channel: string;
};

/**
 * Persist a new org persona. Caller is responsible for the operator gate and
 * the `isSupabaseAdminConfigured()` check. Returns the slug to navigate to.
 */
export async function insertPersona(input: NewPersonaInput): Promise<{ slug: string }> {
  const orgId = await getCurrentOrgId();
  // The `personas` table isn't in the generated types yet (types are regenerated
  // after the migration is applied to the project), so use an untyped client.
  const supabase = getSupabaseAdminClient() as unknown as SupabaseClient;
  const slug = slugify(input.name) || `persona-${Date.now()}`;
  const score = clampScore(input.score);

  const { error } = await supabase.from("personas").insert({
    org_id: orgId,
    slug,
    name: input.name,
    initials: initialsFrom(input.name),
    segment: input.segment,
    stage: input.stage,
    score,
    signals: { engagement: score, fit: score, intent: score },
    score_trend: [score, score],
    angle: input.angle,
    audience: input.audience,
    cta: input.cta,
    channel: input.channel,
  });

  if (error) throw new Error(error.message);
  return { slug };
}

export type PersonaUpdateInput = {
  name?: string;
  segment?: PersonaSegmentKey;
  stage?: PersonaStage;
  angle?: string;
  audience?: string;
  cta?: string;
  channel?: string;
};

/**
 * Update an org persona in place. The `slug` is the stable key that records are
 * tagged with, so it is intentionally immutable — renaming only touches the
 * display name/initials, never the slug. Caller owns the operator gate +
 * `isSupabaseAdminConfigured()` check.
 */
export async function updatePersona(slug: string, patch: PersonaUpdateInput): Promise<void> {
  const orgId = await getCurrentOrgId();
  const supabase = getSupabaseAdminClient() as unknown as SupabaseClient;

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    update.name = patch.name;
    update.initials = initialsFrom(patch.name);
  }
  if (patch.segment !== undefined) update.segment = patch.segment;
  if (patch.stage !== undefined) update.stage = patch.stage;
  if (patch.angle !== undefined) update.angle = patch.angle;
  if (patch.audience !== undefined) update.audience = patch.audience;
  if (patch.cta !== undefined) update.cta = patch.cta;
  if (patch.channel !== undefined) update.channel = patch.channel;
  if (Object.keys(update).length === 0) return;

  const { error } = await supabase.from("personas").update(update).eq("org_id", orgId).eq("slug", slug);
  if (error) throw new Error(error.message);
}

/**
 * Archive (`active = false`) or restore a persona. Archiving hides it from the
 * roster and pickers while leaving existing tagged records + attribution intact.
 */
export async function setPersonaActive(slug: string, active: boolean): Promise<void> {
  const orgId = await getCurrentOrgId();
  const supabase = getSupabaseAdminClient() as unknown as SupabaseClient;
  const { error } = await supabase
    .from("personas")
    .update({ is_active: active })
    .eq("org_id", orgId)
    .eq("slug", slug);
  if (error) throw new Error(error.message);
}

/**
 * Seed a NEW workspace's starter personas. Picks the persona pack for the chosen
 * `industry` (falls back to the neutral, industry-agnostic set for an unknown or
 * unset industry). Idempotent: a no-op once the org has any persona. Runs with an
 * explicit admin client during onboarding, mirroring seedDefaultMediaFolders.
 */
export async function seedDefaultPersonas(
  { orgId, client, industry }: { orgId: string; client?: SupabaseClient; industry?: string },
): Promise<number> {
  const supabase = (client ?? getSupabaseAdminClient()) as unknown as SupabaseClient;

  const { count, error: countError } = await supabase
    .from("personas")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  // Fail closed. This guard makes seeding idempotent, so a null count read as
  // 0 would mean "not seeded yet" and duplicate every default persona (BSR-575).
  if (requireCount("personas", { count, error: countError }) > 0) return 0;

  const rows = personasForIndustry(industry).map((persona) => ({
    org_id: orgId,
    slug: persona.slug,
    name: persona.name,
    initials: initialsFrom(persona.name),
    segment: persona.segment,
    stage: persona.stage,
    score: 60,
    signals: { engagement: 60, fit: 60, intent: 60 },
    score_trend: [60, 60],
    angle: persona.angle,
    audience: persona.audience,
    cta: persona.cta ?? "",
    is_active: true,
  }));

  const { error } = await supabase.from("personas").insert(rows);
  if (error) throw new Error(`personas seed failed: ${error.message}`);
  return rows.length;
}

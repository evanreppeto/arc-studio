import { type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { workspaceIdFields } from "@/lib/tenancy/resolve-workspace";
import {
  parseBusinessProfile,
  type BusinessProfile,
  type PersonaDefinition,
} from "@/domain";

/** Read the Brand Kit for an org, or null if none exists / Supabase unconfigured.
 *  `client` lets a caller already holding a client reuse it (and lets tests inject
 *  a mock); omitted, it falls back to the admin client. */
export async function getBusinessProfile(
  orgId: string,
  client?: SupabaseClient,
): Promise<BusinessProfile | null> {
  if (!client && !isSupabaseAdminConfigured()) return null;
  const supabase = client ?? getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("business_profiles")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle<Record<string, unknown>>();
  if (error) throw new Error(`Failed to read business profile: ${error.message}`);
  return data ? parseBusinessProfile(data) : null;
}

/** Insert or update the Brand Kit for an org. Returns the persisted profile. */
export async function upsertBusinessProfile(
  orgId: string,
  profile: BusinessProfile,
): Promise<BusinessProfile> {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("Supabase is not configured; cannot persist business profile.");
  }
  const supabase = getSupabaseAdminClient();
  const row = {
    org_id: orgId,
    ...(await workspaceIdFields(supabase, orgId)),
    display_name: profile.displayName,
    legal_name: profile.legalName,
    tagline: profile.tagline,
    description: profile.description,
    industry: profile.industry,
    website_url: profile.websiteUrl,
    logo_url: profile.logoUrl,
    favicon_url: profile.faviconUrl,
    short_mark: profile.shortMark,
    service_areas: profile.serviceAreas as never,
    time_zone: profile.timeZone,
    accent: profile.accent,
    density: profile.density,
    motion: profile.motion,
    tone: profile.tone,
    voice_guidance: profile.voiceGuidance,
    preferred_phrases: profile.preferredPhrases as never,
    banned_phrases: profile.bannedPhrases as never,
    services: profile.services as never,
    proof_points: profile.proofPoints as never,
    guardrails: profile.guardrails as never,
    brand_palette: profile.brandPalette as never,
    status: profile.status,
  };
  const { data, error } = await supabase
    .from("business_profiles")
    .upsert(row, { onConflict: "org_id" })
    .select("*")
    .single<Record<string, unknown>>();
  if (error) throw new Error(`Failed to upsert business profile: ${error.message}`);
  return parseBusinessProfile(data);
}

type PersonaRow = {
  slug: string;
  name: string;
  is_active: boolean | null;
  audience: string | null;
  profile: string | null;
  angle: string | null;
  cta: string | null;
  proof_points: string[] | null;
};

/**
 * List an org's personas, name-sorted. Empty if unconfigured.
 *
 * Reads `personas` — the per-org taxonomy the console writes and workspace
 * creation seeds. It used to read `persona_definitions`, a parallel table that
 * nothing has populated since the taxonomy moved (20260713120000): only the
 * original seeded tenant ever had rows there, so every workspace created since
 * reported ZERO personas to the two callers of this function — the workspace
 * summary that drives Arc's per-turn situational awareness, and the business
 * context bundle Arc reasons from. The latter silently substituted
 * NEUTRAL_PERSONAS, so Arc never saw the operator's actual audience and nothing
 * looked broken.
 *
 * `personas` isn't in the generated types yet — same untyped-client cast the
 * personas read-model uses.
 */
export async function listPersonaDefinitions(orgId: string): Promise<PersonaDefinition[]> {
  if (!isSupabaseAdminConfigured()) return [];
  const supabase = getSupabaseAdminClient() as unknown as SupabaseClient;
  const { data, error } = await supabase
    .from("personas")
    .select("slug,name,is_active,audience,profile,angle,cta,proof_points")
    .eq("org_id", orgId)
    .order("name", { ascending: true });
  if (error) throw new Error(`Failed to list personas: ${error.message}`);
  // There is no sort_order on `personas`; the name ordering above IS the order,
  // so hand assembleArcContext a stable index rather than a constant it would
  // then "sort" arbitrarily.
  return ((data ?? []) as PersonaRow[]).map((row, index) => ({
    key: row.slug,
    label: row.name,
    // `personas` has no audience-type column — `segment` is lifecycle stage, not
    // audience. Don't invent one; the neutral default is what callers expect.
    audienceType: "customer",
    sortOrder: index,
    isActive: row.is_active !== false,
    metadata: {
      ...(row.audience || row.profile ? { description: row.audience || row.profile || undefined } : {}),
      ...(row.cta ? { recommendedCta: row.cta } : {}),
      ...(row.angle ? { messageAngle: row.angle } : {}),
      ...(row.proof_points?.length ? { proofPoints: row.proof_points } : {}),
    },
  }));
}

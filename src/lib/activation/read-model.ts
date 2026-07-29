import { type SupabaseClient } from "@supabase/supabase-js";

import { buildActivationChecklist, type ActivationChecklist, type ActivationSignals } from "@/domain";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

export type ActivationState = {
  signals: ActivationSignals;
  checklist: ActivationChecklist;
};

const EMPTY_SIGNALS: ActivationSignals = {
  hasRecords: false,
  brandCaptured: false,
  dismissed: false,
  hasMedia: false,
  hasCampaign: false,
  hasTeammate: false,
};

type OnboardingRow = { brand_captured_at: string | null; dismissed_at: string | null };

type BrandProfileRow = {
  voice_guidance: string | null;
  website_url: string | null;
  logo_url: string | null;
  tagline: string | null;
};

/**
 * Whether the owner has actually taught Arc their brand.
 *
 * Derived from profile CONTENT rather than the `brand_captured_at` flag, because
 * nothing ever writes that flag — `markBrandCaptured` exists and has no callers,
 * so the step could never be ticked off and the checklist would nag forever.
 *
 * Signup creates a business_profiles row carrying only the name it asked for, so
 * the row existing proves nothing. These four fields are ones the owner can only
 * have supplied through /brand — via the form, a logo upload, or website
 * analysis. The flag is still honoured if anything ever starts writing it.
 */
async function readBrandCaptured(db: SupabaseClient, orgId: string): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("business_profiles")
      .select("voice_guidance,website_url,logo_url,tagline")
      .eq("org_id", orgId)
      .maybeSingle<BrandProfileRow>();
    if (error || !data) return false;
    return Boolean(
      data.voice_guidance?.trim() ||
        data.website_url?.trim() ||
        data.logo_url?.trim() ||
        data.tagline?.trim(),
    );
  } catch {
    return false;
  }
}

async function readOnboardingRow(db: SupabaseClient, orgId: string): Promise<OnboardingRow | null> {
  try {
    const { data, error } = await db
      .from("org_onboarding_state")
      .select("brand_captured_at,dismissed_at")
      .eq("org_id", orgId)
      .maybeSingle<OnboardingRow>();
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Best-effort "are there more than `threshold` rows" check. Never throws — a
 * failed count defaults to false so the checklist degrades to "not done" rather
 * than blocking the home page.
 */
type CountQuery = { count: number | null; error: { message: string } | null };

async function countExceeds(
  db: SupabaseClient,
  table: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chainable PostgREST filter builder
  applyFilters: (query: any) => PromiseLike<CountQuery>,
  threshold: number,
): Promise<boolean> {
  try {
    const base = db.from(table).select("id", { count: "exact", head: true });
    const { count, error } = await applyFilters(base);
    if (error || count == null) return false;
    return count > threshold;
  } catch {
    return false;
  }
}

export async function getActivationState(orgId: string, workspaceId: string | null): Promise<ActivationState> {
  if (!isSupabaseAdminConfigured()) {
    return { signals: EMPTY_SIGNALS, checklist: buildActivationChecklist(EMPTY_SIGNALS) };
  }

  const db = getSupabaseAdminClient() as unknown as SupabaseClient;

  const [onboarding, brandFromProfile, hasContacts, hasCompanies, hasMedia, hasCampaign, hasTeammate] = await Promise.all([
    readOnboardingRow(db, orgId),
    readBrandCaptured(db, orgId),
    // Either object counts as "has records" — an owner may start from a company
    // list or a contact list, and requiring both would keep the blocking step
    // unfinished for someone who has already done the useful thing.
    countExceeds(db, "contacts", (q) => q.eq("org_id", orgId), 0),
    countExceeds(db, "companies", (q) => q.eq("org_id", orgId), 0),
    countExceeds(db, "media_assets", (q) => q.eq("org_id", orgId), 0),
    workspaceId
      ? countExceeds(db, "campaigns", (q) => q.eq("workspace_id", workspaceId), 0)
      : Promise.resolve(false),
    workspaceId
      ? countExceeds(db, "workspace_memberships", (q) => q.eq("workspace_id", workspaceId).eq("status", "active"), 1)
      : Promise.resolve(false),
  ]);

  const signals: ActivationSignals = {
    hasRecords: hasContacts || hasCompanies,
    brandCaptured: brandFromProfile || Boolean(onboarding?.brand_captured_at),
    dismissed: Boolean(onboarding?.dismissed_at),
    hasMedia,
    hasCampaign,
    hasTeammate,
  };

  return { signals, checklist: buildActivationChecklist(signals) };
}

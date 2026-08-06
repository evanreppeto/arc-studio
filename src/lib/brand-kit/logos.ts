import "server-only";

import { isBrandLogoRole, primaryBrandLogo, type BrandLogo, type BrandLogoRole } from "@/domain";
import { reportDegraded } from "@/lib/observability/report-degraded";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { setWorkspaceLogo } from "../branding/logo";

type Row = {
  role: string;
  url: string;
  file_name: string | null;
  updated_at: string | null;
};

function toBrandLogo(row: Row): BrandLogo | null {
  // A role outside the vocabulary means the CHECK constraint and this module
  // disagree — drop the row rather than hand the renderer something it cannot
  // branch on. Never silently coerce it to "primary".
  if (!isBrandLogoRole(row.role)) return null;
  return {
    role: row.role,
    url: row.url,
    fileName: row.file_name,
    updatedAt: row.updated_at,
  };
}

/**
 * Every logo variant an org has uploaded.
 *
 * Returns `[]` rather than throwing: the Brand screen and the creative renderer
 * both call this, and a read failure should cost the logo set, not the page or
 * the render. It is reported rather than swallowed.
 */
export async function listBrandLogos(orgId: string, workspaceId?: string | null): Promise<BrandLogo[]> {
  if (!isSupabaseAdminConfigured()) return [];
  try {
    // Scoped to the workspace when the caller knows it. This client is
    // service-role and bypasses RLS, so the policy is not what keeps one
    // workspace's logos out of another's Brand screen — this filter is.
    let query = getSupabaseAdminClient()
      .from("brand_logos")
      .select("role, url, file_name, updated_at")
      .eq("org_id", orgId);
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map(toBrandLogo).filter((l): l is BrandLogo => l !== null);
  } catch (error) {
    reportDegraded(error, { scope: "brand-kit.listBrandLogos", surface: "secondary" });
    return [];
  }
}

/**
 * Store one variant, replacing whatever occupied that role.
 *
 * Upserts on (org_id, role) — the unique index — so uploading a new "on dark"
 * replaces the old one instead of stacking a second row the renderer would pick
 * between arbitrarily.
 */
export async function saveBrandLogoVariant(input: {
  orgId: string;
  /**
   * Stamped on every write. `brand_logos` carries workspace_id from birth
   * (Wave 3 Phase A gave business_profiles the same column), and
   * src/lib/db/workspace-writers.test.ts fails any insert site that omits it —
   * deliberately, because BSR-720 found 15 sites still writing org_id alone
   * after the Wave 1 columns landed, one of which had already broken Arc's
   * campaign runs in production.
   */
  workspaceId: string;
  role: BrandLogoRole;
  url: string;
  fileName?: string | null;
  uploadedBy?: string | null;
}): Promise<void> {
  const { error } = await getSupabaseAdminClient()
    .from("brand_logos")
    .upsert(
      {
        org_id: input.orgId,
        workspace_id: input.workspaceId,
        role: input.role,
        url: input.url,
        file_name: input.fileName ?? null,
        uploaded_by: input.uploadedBy ?? null,
        updated_at: new Date().toISOString(),
      },
      // Must name exactly the columns of brand_logos_workspace_role_key. A
      // conflict target with no matching unique fails at RUNTIME, and a mocked
      // upsert cannot see it — the BSR-720 shape.
      { onConflict: "workspace_id,role" },
    );
  if (error) throw new Error(error.message);
  await syncPrimaryLogoMirror(input.orgId, input.workspaceId);
}

export async function removeBrandLogoVariant(orgId: string, workspaceId: string, role: BrandLogoRole): Promise<void> {
  const { error } = await getSupabaseAdminClient()
    .from("brand_logos")
    .delete()
    .eq("org_id", orgId)
    .eq("workspace_id", workspaceId)
    .eq("role", role);
  if (error) throw new Error(error.message);
  await syncPrimaryLogoMirror(orgId, workspaceId);
}

/**
 * Keep `business_profiles.logo_url` pointing at the primary variant.
 *
 * That column is NOT dead — the nav rail, the workspace switcher, `toBrandTokens`
 * and Arc's brand-profile API all read it, and each renders exactly one image.
 * The set is the source of truth; this mirror is what stops those four surfaces
 * from going blank the moment logos move into their own table.
 *
 * Deriving the mirror from the set on every write (rather than only on primary
 * writes) is deliberate: deleting the primary has to demote the mirror to the
 * next-best lockup, and a mirror that kept pointing at a deleted image would
 * 404 in the rail.
 */
async function syncPrimaryLogoMirror(orgId: string, workspaceId: string): Promise<void> {
  const logos = await listBrandLogos(orgId, workspaceId);
  await setWorkspaceLogo(orgId, primaryBrandLogo(logos)?.url ?? null);
}

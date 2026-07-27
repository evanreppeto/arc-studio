import { NEUTRAL_DEFAULTS } from "@/domain";
import { getBusinessProfile, upsertBusinessProfile } from "@/lib/brand-kit/persistence";
import { saveAppSettings } from "@/lib/settings/store";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * One workspace logo, one place it lives.
 *
 * It used to live in two: `app_settings.brand_logo_url` (written from Settings,
 * drawn in the nav rail) and `business_profiles.logo_url` (written from Brand,
 * stamped on generated creative by `toBrandTokens` → `renderCreative`). Two
 * controls, two stores, and a workspace could end up wearing one logo in the app
 * and a different one on its ads.
 *
 * `business_profiles.logo_url` is canonical — it is a real column on the brand
 * record, and it is the one the renderer reads. `app_settings.brand_logo_url` is
 * kept only as a read fallback for workspaces that uploaded before this change;
 * every write clears it, so the two can never diverge again.
 */

/** Only an absolute URL is usable: the creative renderer FETCHES this value. */
function fetchable(url: string | null | undefined): string | null {
  return url && url.startsWith("http") ? url : null;
}

/**
 * The workspace's logo, preferring the canonical brand-record value and falling
 * back to the legacy settings key. Pure — callers pass what they already loaded.
 */
export function resolveWorkspaceLogoUrl(
  profileLogoUrl: string | null | undefined,
  legacySettingsLogoUrl: string | null | undefined,
): string | null {
  return fetchable(profileLogoUrl) ?? fetchable(legacySettingsLogoUrl);
}

/**
 * Set (or clear, with null) the workspace logo. Writes the canonical brand
 * record and clears the legacy settings key in the same call, so Settings and
 * Brand cannot drift apart no matter which one the operator used.
 *
 * Fetch-merge-upsert: only the logo changes, the rest of the brand profile is
 * left as-is. Throws on failure — callers surface the message rather than
 * reporting a save that didn't happen.
 */
export async function setWorkspaceLogo(orgId: string, url: string | null): Promise<void> {
  const current = (await getBusinessProfile(orgId)) ?? NEUTRAL_DEFAULTS;
  await upsertBusinessProfile(orgId, { ...current, logoUrl: url });
  // Best-effort: the canonical write already succeeded, and a stale legacy value
  // only ever loses to it in resolveWorkspaceLogoUrl.
  await saveAppSettings(getSupabaseAdminClient(), orgId, { brand_logo_url: "" }).catch(() => {});
}

/**
 * Which `media_assets` row a piece of campaign creative IS.
 *
 * Campaign media is a JSON blob on `campaign_assets.audit_payload`, not a row,
 * so it carries no database identity of its own. Everything that wants to say
 * something durable ABOUT a picture — its review state, a decision recorded
 * against it — has to resolve that blob to a `media_assets` row first, and the
 * read side and the write side must resolve it the same way or an operator will
 * approve one picture and watch a different one change state.
 *
 * The rule, in order:
 *   1. `library_asset_id` on the entry, when the producer recorded it.
 *   2. `storage_path`, which is the only key that exists on entries written
 *      before the id was threaded through — on prod today that is all of them.
 *
 * Neither resolving is a real and common answer, not an error: media composited
 * before `compose/route.ts` registered its output has bytes in the bucket and no
 * row anywhere. Callers must handle `null` by saying so, never by inventing a
 * decision or silently doing nothing.
 */

import { type SupabaseClient } from "@supabase/supabase-js";

/** The identity keys an entry can be resolved by, in preference order. */
export type MediaIdentity = {
  libraryAssetId: string | null;
  storagePath: string | null;
};

/**
 * A stable lookup key for one entry. Prefixed by kind so an id and a path can
 * live in the same map without colliding.
 */
export function mediaReviewKey(media: MediaIdentity): string | null {
  if (media.libraryAssetId) return `id:${media.libraryAssetId}`;
  if (media.storagePath) return `path:${media.storagePath}`;
  return null;
}

/** Discriminated on `ok`, not on `assetId`: narrowing a union by the truthiness
 *  of a `string` member does not narrow, so the failure branch would carry no
 *  reason the caller could read. */
export type ResolvedMediaAsset =
  | { ok: true; assetId: string }
  | { ok: false; reason: MediaResolveFailure };

/** Why an entry could not be resolved — the two cases read differently to an operator. */
export type MediaResolveFailure =
  /** The entry carries neither an id nor a storage path; nothing to look up. */
  | "no_identity"
  /** It has a key, but no `media_assets` row matches it in this org. */
  | "not_in_library";

/**
 * Resolve one entry to its `media_assets` id, scoped to the tenant.
 *
 * Scoped on purpose and not optionally: this id is about to become the subject
 * of an approval record, and a storage path is guessable — resolving
 * cross-tenant would let a path from one workspace mint an approval in another.
 *
 * BOTH org and workspace, not org alone. `media_assets` is workspace-owned, and
 * the service role bypasses RLS, so on a server-side read the app-layer filter
 * IS the boundary — `.eq("org_id", …)` by itself returns the whole org the day a
 * second workspace exists in one. Enforced by `src/lib/db/workspace-readers.test.ts`,
 * which caught this function doing exactly that.
 */
export async function resolveMediaAssetId(
  client: SupabaseClient,
  media: MediaIdentity,
  orgId: string,
  workspaceId: string,
): Promise<ResolvedMediaAsset> {
  if (media.libraryAssetId) {
    const { data } = await client
      .from("media_assets")
      .select("id")
      .eq("id", media.libraryAssetId)
      .eq("org_id", orgId)
      .eq("workspace_id", workspaceId)
      .maybeSingle<{ id: string }>();
    if (data) return { ok: true, assetId: data.id };
    // Fall through to the path rather than failing: an id recorded against a
    // since-deleted row should not hide a perfectly good path match.
  }

  if (media.storagePath) {
    const { data } = await client
      .from("media_assets")
      .select("id")
      .eq("storage_path", media.storagePath)
      .eq("org_id", orgId)
      .eq("workspace_id", workspaceId)
      .maybeSingle<{ id: string }>();
    if (data) return { ok: true, assetId: data.id };
  }

  if (!media.libraryAssetId && !media.storagePath) return { ok: false, reason: "no_identity" };
  return { ok: false, reason: "not_in_library" };
}

/** What to tell an operator when the picture in front of them has no row. */
export const MEDIA_RESOLVE_MESSAGE: Record<MediaResolveFailure, string> = {
  no_identity:
    "This image was attached without a Library reference, so there is nothing to record a decision against. Approving the deliverable still works.",
  not_in_library:
    "This image is not in your Library, so a decision can't be recorded against it on its own. Approving the deliverable still works.",
};

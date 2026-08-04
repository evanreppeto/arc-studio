import { type SupabaseClient } from "@supabase/supabase-js";

import { createFolder, moveAsset } from "@/lib/media-library/persistence";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Arc-facing media library writes: create folders and file existing assets into
 * folders. Direct writes (organizing the Library is internal and reversible —
 * not an outbound action), stamped to the token's org.
 *
 * SECURITY: the service-role client bypasses RLS, so every id in the payload
 * (parent folder, asset, target folder) is verified to belong to `deps.orgId`
 * before any write. A forged cross-org id is rejected, never acted on.
 */

export type WriteResult = { ok: true; id: string } | { ok: false; error: string };

export type MediaApiDeps = { orgId: string; client?: SupabaseClient };

const FOLDER_NAME_MAX = 120;

/** Returns the owning org_id for a row, or null if the row doesn't exist. */
async function rowOrgId(client: SupabaseClient, table: string, id: string): Promise<string | null> {
  const { data, error } = await client.from(table).select("org_id").eq("id", id).maybeSingle();
  if (error) throw new Error(`${table} lookup failed: ${error.message}`);
  return (data as { org_id?: string } | null)?.org_id ?? null;
}

export async function arcCreateFolder(payload: Record<string, unknown>, deps: MediaApiDeps): Promise<WriteResult> {
  const client = deps.client ?? getSupabaseAdminClient();

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name) return { ok: false, error: "A folder name is required." };
  if (name.length > FOLDER_NAME_MAX) {
    return { ok: false, error: `Folder name must be ${FOLDER_NAME_MAX} characters or fewer.` };
  }

  const parentId = typeof payload.parent_id === "string" && payload.parent_id ? payload.parent_id : null;
  if (parentId) {
    const owner = await rowOrgId(client, "media_folders", parentId);
    if (owner === null) return { ok: false, error: "Parent folder not found." };
    if (owner !== deps.orgId) return { ok: false, error: "Parent folder belongs to another workspace." };
  }

  const description = typeof payload.description === "string" ? payload.description.trim() : "";

  const id = await createFolder({ orgId: deps.orgId, name, parentId, description: description || null, client });
  return { ok: true, id };
}

export async function arcFileAsset(payload: Record<string, unknown>, deps: MediaApiDeps): Promise<WriteResult> {
  const client = deps.client ?? getSupabaseAdminClient();

  const assetId = typeof payload.asset_id === "string" ? payload.asset_id : "";
  if (!assetId) return { ok: false, error: "An asset_id is required." };

  const assetOwner = await rowOrgId(client, "media_assets", assetId);
  if (assetOwner === null) return { ok: false, error: "Asset not found." };
  if (assetOwner !== deps.orgId) return { ok: false, error: "Asset belongs to another workspace." };

  // Empty / missing folder_id files the asset at the Library root.
  const folderId = typeof payload.folder_id === "string" && payload.folder_id ? payload.folder_id : null;
  if (folderId) {
    const folderOwner = await rowOrgId(client, "media_folders", folderId);
    if (folderOwner === null) return { ok: false, error: "Target folder not found." };
    if (folderOwner !== deps.orgId) return { ok: false, error: "Target folder belongs to another workspace." };
  }

  // The ownership checks above stay: they also cover the TARGET folder, which
  // the org-scoped update cannot (it scopes the asset, not the destination).
  const moved = await moveAsset(assetId, folderId, deps.orgId, client);
  if (!moved) return { ok: false, error: "Asset not found." };
  return { ok: true, id: assetId };
}

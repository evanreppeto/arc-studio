import { type SupabaseClient } from "@supabase/supabase-js";

import { formatByteSize } from "@/domain";
import { getCurrentOrgId, OrgUnavailableError } from "@/lib/auth/org";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import {
  type MediaAssetRow,
  type MediaAssetView,
  type MediaFolderRow,
  type MediaFolderView,
  type MediaLibraryData,
} from "./types";

/** Pure: one DB row → view model. `usedIn` is the count of campaign assets referencing it. */
export function toAssetView(row: MediaAssetRow, usedIn: number): MediaAssetView {
  const badge =
    row.source === "ai_generated"
      ? "AI"
      : row.source === "url"
        ? "URL"
        : row.kind === "document"
          ? "DOC"
          : row.kind === "logo"
            ? "LOGO"
            : row.kind === "video"
              ? "VIDEO"
              : "PHOTO";
  return {
    id: row.id,
    folderId: row.folder_id,
    fileName: row.file_name,
    url: row.public_url,
    kind: row.kind,
    badge,
    dimensions: row.width && row.height ? `${row.width} × ${row.height}` : null,
    size: row.byte_size != null ? formatByteSize(row.byte_size) : null,
    source: row.source,
    tags: row.tags ?? [],
    riskFlags: row.risk_flags ?? [],
    provenance: row.provenance ?? {},
    availableToArc: row.available_to_arc,
    uploadedBy: row.uploaded_by,
    usedInCount: usedIn,
  };
}

/** Count, per library asset, how many campaign-media entries reference it.
 *  Pre-indexes by id/path/url so each asset is O(1); each campaign-media entry
 *  is attributed to at most one asset (matching the prior filter semantics). */
export function countUsage(
  assets: Pick<MediaAssetRow, "id" | "storage_path" | "public_url">[],
  campaignMedia: Array<{ path?: string; url?: string; library_asset_id?: string }>,
): Map<string, number> {
  const idByLibraryId = new Map<string, string>();
  const idByPath = new Map<string, string>();
  const idByUrl = new Map<string, string>();
  for (const a of assets) {
    idByLibraryId.set(a.id, a.id);
    idByPath.set(a.storage_path, a.id);
    idByUrl.set(a.public_url, a.id);
  }
  const counts = new Map<string, number>();
  for (const a of assets) counts.set(a.id, 0);
  for (const m of campaignMedia) {
    const assetId =
      (m.library_asset_id ? idByLibraryId.get(m.library_asset_id) : undefined) ??
      (m.path ? idByPath.get(m.path) : undefined) ??
      (m.url ? idByUrl.get(m.url) : undefined);
    if (assetId) counts.set(assetId, (counts.get(assetId) ?? 0) + 1);
  }
  return counts;
}

export function buildFolderViews(folderRows: MediaFolderRow[], assets: Pick<MediaAssetRow, "folder_id">[]): MediaFolderView[] {
  const knownIds = new Set(folderRows.map((folder) => folder.id));
  const rows = folderRows.map((folder) => ({
    ...folder,
    parent_id: folder.parent_id && folder.parent_id !== folder.id && knownIds.has(folder.parent_id) ? folder.parent_id : null,
  }));
  const children = new Map<string | null, MediaFolderRow[]>();
  const directCounts = new Map<string | null, number>();

  for (const folder of rows) {
    const siblings = children.get(folder.parent_id) ?? [];
    siblings.push(folder);
    children.set(folder.parent_id, siblings);
  }
  for (const asset of assets) {
    directCounts.set(asset.folder_id, (directCounts.get(asset.folder_id) ?? 0) + 1);
  }

  const countSubtree = (folderId: string, trail = new Set<string>()): number => {
    if (trail.has(folderId)) return directCounts.get(folderId) ?? 0;
    const nextTrail = new Set(trail);
    nextTrail.add(folderId);
    return (directCounts.get(folderId) ?? 0) + (children.get(folderId) ?? []).reduce((sum, child) => sum + countSubtree(child.id, nextTrail), 0);
  };

  const views: MediaFolderView[] = [
    { id: "all", name: "All media", parentId: null, depth: 0, count: assets.length, directCount: assets.length, description: null },
  ];
  const visited = new Set<string>();

  const append = (folder: MediaFolderRow, depth: number) => {
    if (visited.has(folder.id)) return;
    visited.add(folder.id);
    views.push({
      id: folder.id,
      name: folder.name,
      parentId: folder.parent_id,
      depth,
      count: countSubtree(folder.id),
      directCount: directCounts.get(folder.id) ?? 0,
      description: folder.description ?? null,
    });
    for (const child of children.get(folder.id) ?? []) append(child, depth + 1);
  };

  for (const folder of children.get(null) ?? []) append(folder, 0);
  for (const folder of rows) append(folder, 0);

  return views;
}

export function folderAndDescendantIds(folders: MediaFolderView[], folderId: string): Set<string> {
  const ids = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }
  return ids;
}

export async function getMediaLibraryData(client?: SupabaseClient, orgIdArg?: string): Promise<MediaLibraryData> {
  if (!client && !isSupabaseAdminConfigured()) {
    return { status: "unavailable", message: "Supabase env vars are not configured." };
  }
  const db = client ?? getSupabaseAdminClient();
  let orgId: string;
  try {
    // Explicit org wins (Arc API token scope); operator/cookie callers fall back
    // to getCurrentOrgId(). A cookieless runner token must pass its scope, else
    // getCurrentOrgId() resolves the DEFAULT org and leaks the wrong tenant.
    orgId = orgIdArg ?? (await getCurrentOrgId());
  } catch (error) {
    if (error instanceof OrgUnavailableError) return { status: "unavailable", message: error.message };
    throw error;
  }

  const { data: folderRows, error: fErr } = await db
    .from("media_folders").select("id, name, parent_id, description").eq("org_id", orgId).order("sort_order");
  if (fErr) return { status: "unavailable", message: fErr.message };

  const { data: assetRows, error: aErr } = await db
    .from("media_assets").select("*").eq("org_id", orgId).order("created_at", { ascending: false });
  if (aErr) return { status: "unavailable", message: aErr.message };
  const assets = (assetRows ?? []) as MediaAssetRow[];

  // Not org-scoped: campaign_assets has no org_id column. Safe because used-in
  // matching keys (library_asset_id, and storage_path/public_url which embed the
  // org id under library/<orgId>/...) only match THIS org's own asset identifiers.
  const { data: caRows } = await db.from("campaign_assets").select("audit_payload");
  const campaignMedia: Array<{ path?: string; url?: string; library_asset_id?: string }> = [];
  for (const ca of (caRows ?? []) as Array<{ audit_payload: { media_assets?: unknown[] } }>) {
    for (const m of ca.audit_payload?.media_assets ?? []) {
      if (m && typeof m === "object") campaignMedia.push(m as { path?: string; url?: string; library_asset_id?: string });
    }
  }
  const usage = countUsage(assets, campaignMedia);

  return {
    status: "live",
    folders: buildFolderViews((folderRows ?? []) as MediaFolderRow[], assets),
    assets: assets.map((a) => toAssetView(a, usage.get(a.id) ?? 0)),
    totalBytes: assets.reduce((sum, a) => sum + (a.byte_size ?? 0), 0),
  };
}

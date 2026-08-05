import { requireCount } from "@/lib/supabase/count";
import { type SupabaseClient } from "@supabase/supabase-js";

import { syncMediaRecordToBrain } from "@/lib/brain-ingestion/sync";
import { getSupabaseAdminClient, type TypedSupabaseClient } from "@/lib/supabase/server";
import { workspaceIdFields } from "@/lib/tenancy/resolve-workspace";

const BUCKET = "campaign-media";

/** Bypass Supabase generated-type narrowing for tables added in later migrations
 *  (media_folders, media_assets). Mirrors the insertOne/insertNoReturn pattern
 *  in src/lib/campaigns/create.ts — passing a `string`-typed variable to
 *  `client.from()` prevents TypeScript from narrowing to a specific schema key. */
async function insertGetId(
  client: SupabaseClient,
  table: string,
  values: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await client.from(table).insert(values).select("id").single();
  if (error) throw new Error(`${table} insert failed: ${error.message}`);
  if (!data?.id) throw new Error(`${table} insert did not return an id`);
  return data.id as string;
}

async function updateRow(
  client: SupabaseClient,
  table: string,
  values: Record<string, unknown>,
  id: string,
): Promise<void> {
  const { error } = await client.from(table).update(values).eq("id", id);
  if (error) throw new Error(`${table} update failed: ${error.message}`);
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const ext = dot > 0 ? base.slice(dot + 1).replace(/[^a-zA-Z0-9]+/g, "") : "";
  return ext ? `${stem || "file"}.${ext}` : stem || "file";
}

export function buildStoragePath(orgId: string, assetId: string, fileName: string): string {
  return `library/${orgId}/${assetId}-${sanitizeFileName(fileName)}`;
}

export type ImageUploader = (path: string, bytes: Uint8Array, contentType: string) => Promise<string>;

export function defaultUploader(client: SupabaseClient): ImageUploader {
  return async (path, bytes, contentType) => {
    const { error } = await client.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
    if (error) throw new Error(`media upload failed: ${error.message}`);
    return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  };
}

export type CreateFolderInput = { orgId: string; name: string; parentId?: string | null; description?: string | null; client?: SupabaseClient };
export async function createFolder({ orgId, name, parentId = null, description = null, client = getSupabaseAdminClient() }: CreateFolderInput): Promise<string> {
  const workspaceFields = await workspaceIdFields(client, orgId);
  return insertGetId(client, "media_folders", { org_id: orgId, ...workspaceFields, name, parent_id: parentId, description });
}

/** Generic starter folders seeded for a new workspace. Names/descriptions are
 *  editable; Arc and operators can add more (e.g. a literal "Damage" folder).
 *  Kept industry-agnostic — this is a multi-tenant product. */
export const DEFAULT_MEDIA_FOLDERS: { name: string; description: string }[] = [
  { name: "Logos & Brand", description: "Official logos, wordmarks, and brand marks — headers, watermarks, co-branding." },
  { name: "Team & People", description: "Staff, crew, and leadership photos for trust-building and about/team pages." },
  { name: "Before & After / Proof", description: "Before/after and proof-of-work photos that show real results." },
  { name: "Facilities & Equipment", description: "Trucks, equipment, signage, and workspace shots." },
  { name: "General", description: "Uncategorized media." },
];

/** Seed the default folder set for an org, but only if it has none yet
 *  (idempotent — safe to call on every onboarding). Returns rows created. */
export async function seedDefaultMediaFolders(
  { orgId, client = getSupabaseAdminClient() }: { orgId: string; client?: SupabaseClient },
): Promise<number> {
  const { count, error: countError } = await client
    .from("media_folders" as string)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  // Fail closed — see personas/persistence: a null count would re-seed (BSR-575).
  if (requireCount("media_folders", { count, error: countError }) > 0) return 0;

  const workspaceFields = await workspaceIdFields(client, orgId);
  const rows = DEFAULT_MEDIA_FOLDERS.map((folder, index) => ({
    org_id: orgId,
    ...workspaceFields,
    name: folder.name,
    description: folder.description,
    sort_order: index,
  }));
  const { error } = await client.from("media_folders" as string).insert(rows);
  if (error) throw new Error(`media_folders seed failed: ${error.message}`);
  return rows.length;
}

// These media-library writes run through the RLS-bypassing service-role client,
// so the org_id filter is the ONLY thing between an operator and another tenant's
// row (same posture as setAvailableToArc). Each is org-scoped and returns whether
// a row actually matched, so the caller can report "not in this workspace".
export async function renameFolder(id: string, name: string, orgId: string, client: SupabaseClient = getSupabaseAdminClient()): Promise<boolean> {
  const { data, error } = await client.from("media_folders").update({ name }).eq("id", id).eq("org_id", orgId).select("id");
  if (error) throw new Error(`media_folders update failed: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function deleteFolder(id: string, orgId: string, client: SupabaseClient = getSupabaseAdminClient()): Promise<boolean> {
  const { data, error } = await client.from("media_folders").delete().eq("id", id).eq("org_id", orgId).select("id");
  if (error) throw new Error(`media_folders delete failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Would filing `id` under `parentId` make the folder its own ancestor?
 *
 * Pure, and separated from the write so it can be tested without a database.
 * Walks UP from the proposed parent: if the chain reaches the folder being
 * moved, the move would close a loop.
 *
 * A chain that revisits a node it has already seen means the stored data is
 * *already* cyclic. That answers "true" — refusing to move anything deeper into
 * a subtree that is broken is the conservative call, and it keeps this function
 * total rather than letting it spin.
 */
export function createsFolderCycle(
  rows: { id: string; parent_id: string | null }[],
  id: string,
  parentId: string,
): boolean {
  const parents = new Map(rows.map((row) => [row.id, row.parent_id]));
  const seen = new Set<string>();
  let cursor: string | null = parentId;
  while (cursor) {
    if (cursor === id) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return false;
}

/**
 * Re-parent a folder — the write behind dragging one folder onto another.
 *
 * Org-scoped like its siblings above, plus one invariant they don't need: a
 * folder may not become its own descendant. That is not cosmetic. Both
 * `buildFolderViews` and the rail's renderer walk children recursively, so a
 * folder made its own ancestor either disappears from the tree (the read
 * model's `visited` set halts the walk) or recurses without end in the browser.
 *
 * `parentId: null` is the root and a real destination — the same reason
 * `moveAsset` accepts it. Distinct return values rather than a boolean, because
 * "that folder isn't in this workspace" and "that would nest it inside itself"
 * need different sentences on screen.
 */
export async function moveFolder(
  id: string,
  parentId: string | null,
  orgId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<"moved" | "not_found" | "cycle"> {
  if (parentId === id) return "cycle";

  const { data, error } = await client.from("media_folders").select("id, parent_id").eq("org_id", orgId);
  if (error) throw new Error(`media_folders read failed: ${error.message}`);
  const rows = (data ?? []) as { id: string; parent_id: string | null }[];

  // Both ends re-checked against the org's own rows: the folder being moved so
  // a foreign id can't be re-filed, and the destination so this workspace's
  // folder can't be parented into another tenant's tree.
  if (!rows.some((row) => row.id === id)) return "not_found";
  if (parentId && !rows.some((row) => row.id === parentId)) return "not_found";
  if (parentId && createsFolderCycle(rows, id, parentId)) return "cycle";

  const { data: updated, error: updateError } = await client
    .from("media_folders")
    .update({ parent_id: parentId })
    .eq("id", id)
    .eq("org_id", orgId)
    .select("id");
  if (updateError) throw new Error(`media_folders update failed: ${updateError.message}`);
  return (updated ?? []).length > 0 ? "moved" : "not_found";
}

export type InsertAssetInput = {
  orgId: string;
  folderId: string | null;
  fileName: string;
  bytes: Uint8Array;
  contentType: string;
  kind: string;
  width?: number | null;
  height?: number | null;
  byteSize: number;
  source?: string;
  provenance?: Record<string, unknown>;
  /** From scanMediaIngest — review concerns surfaced at ingest time. */
  riskFlags?: string[];
  /** From scanMediaIngest — starter tags so imports stay findable. */
  tags?: string[];
  uploadedBy: string;
  /** Whether Arc may reuse this asset. Defaults to false: operator-supplied media is
   *  held for provenance review, and only the Brain mirror below exposes it to Arc.
   *  Brand-kit images pass true — they're fetched for Arc to use by definition. */
  availableToArc?: boolean;
  client?: SupabaseClient;
  uploader?: ImageUploader;
};

export type InsertAssetResult = {
  id: string;
  url: string;
};

/** Insert the media_assets row (placeholder path), upload the bytes, then update
 *  the row with the real storage path + public URL. Returns the new id.
 *
 *  Non-transactional (Supabase JS has no multi-table transaction): if the upload
 *  throws, the row is left with a "pending" path; if the final update throws, a
 *  storage object exists with no row reference. Acceptable for this iteration —
 *  uploads are low-frequency and a cleanup pass can be added if it matters.
 *  Mirrors the same documented tradeoff in src/lib/campaigns/create.ts. */
export async function insertAssetWithUrl(input: InsertAssetInput): Promise<InsertAssetResult> {
  const client = input.client ?? getSupabaseAdminClient();
  const upload = input.uploader ?? defaultUploader(client);
  const id = await insertGetId(client, "media_assets", {
    org_id: input.orgId, ...(await workspaceIdFields(client, input.orgId)), folder_id: input.folderId, file_name: input.fileName,
    storage_path: "pending", public_url: "pending", content_type: input.contentType, kind: input.kind,
    width: input.width ?? null, height: input.height ?? null, byte_size: input.byteSize,
    source: input.source ?? "uploaded", provenance: input.provenance ?? {},
    risk_flags: input.riskFlags ?? [], tags: input.tags ?? [],
    available_to_arc: input.availableToArc ?? false,
    uploaded_by: input.uploadedBy,
  });
  const path = buildStoragePath(input.orgId, id, input.fileName);
  const url = await upload(path, input.bytes, input.contentType);
  await updateRow(client, "media_assets", { storage_path: path, public_url: url }, id);
  // Best-effort: mirror the asset into the Brain so Arc can recall/prefer it.
  await syncMediaRecordToBrain(id, { client: client as unknown as TypedSupabaseClient, orgId: input.orgId }).catch(() => undefined);
  return { id, url };
}

/** Find or create a folder by name for this org. Idempotent, so a generation
 *  path can call it on every run without accumulating duplicates. */
export async function ensureNamedFolder(
  orgId: string,
  name: string,
  description: string | null = null,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<string | null> {
  const { data } = await client
    .from("media_folders" as string)
    .select("id")
    .eq("org_id", orgId)
    .eq("name", name)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (data?.id) return data.id;
  try {
    return await createFolder({ orgId, name, description, client });
  } catch {
    // A folder is organisation, not correctness — never fail the caller over it.
    return null;
  }
}

export type RecordStoredAssetInput = {
  orgId: string;
  folderId?: string | null;
  fileName: string;
  /** Path of the object ALREADY in the bucket. */
  storagePath: string;
  /** Public URL of that object. */
  publicUrl: string;
  contentType: string;
  kind: string;
  byteSize: number;
  width?: number | null;
  height?: number | null;
  source?: string;
  provenance?: Record<string, unknown>;
  riskFlags?: string[];
  tags?: string[];
  uploadedBy: string;
  availableToArc?: boolean;
  client?: SupabaseClient;
};

/**
 * Record a library row for bytes that are ALREADY stored (BSR-634).
 *
 * `insertAssetWithUrl` owns the upload, which is right for an operator dropping a
 * file on `/library`. Generation is the other way round: the media route stores
 * the object under `arc-generated/{org}/{workspace}/…` and hands back a URL, and
 * until now nothing wrote a row for it. The image existed in the bucket, was
 * attached to a campaign asset, and was invisible to `/library`, to Studio's
 * background picker, and to every provenance surface that reads the table.
 *
 * So this takes the path and URL rather than the bytes, and writes the row those
 * surfaces need. It does NOT re-upload and it does NOT move the object — the
 * `arc-generated/` prefix stays exactly where the generator put it.
 */
export async function recordStoredAsset(input: RecordStoredAssetInput): Promise<string> {
  const client = input.client ?? getSupabaseAdminClient();
  const id = await insertGetId(client, "media_assets", {
    org_id: input.orgId,
    ...(await workspaceIdFields(client, input.orgId)),
    folder_id: input.folderId ?? null,
    file_name: input.fileName,
    storage_path: input.storagePath,
    public_url: input.publicUrl,
    content_type: input.contentType,
    kind: input.kind,
    width: input.width ?? null,
    height: input.height ?? null,
    byte_size: input.byteSize,
    source: input.source ?? "ai_generated",
    provenance: input.provenance ?? {},
    risk_flags: input.riskFlags ?? [],
    tags: input.tags ?? [],
    // Default false, exactly as an operator upload does. A generated image is an
    // approval-gated draft; letting Arc reuse it before a human has looked would
    // route unreviewed AI creative straight back into the next campaign.
    available_to_arc: input.availableToArc ?? false,
    uploaded_by: input.uploadedBy,
  });
  await syncMediaRecordToBrain(id, { client: client as unknown as TypedSupabaseClient, orgId: input.orgId }).catch(() => undefined);
  return id;
}

export async function insertAsset(input: InsertAssetInput): Promise<string> {
  const result = await insertAssetWithUrl(input);
  return result.id;
}

export async function renameAsset(id: string, fileName: string, orgId: string, client: SupabaseClient = getSupabaseAdminClient()): Promise<boolean> {
  const { data, error } = await client.from("media_assets" as string).update({ file_name: fileName }).eq("id", id).eq("org_id", orgId).select("id");
  if (error) throw new Error(`media_assets update failed: ${error.message}`);
  return ((data ?? []) as unknown[]).length > 0;
}

export type AssetForLearning = {
  id: string;
  fileName: string;
  kind: string;
  source: string;
  tags: string[];
  availableToArc: boolean;
  url: string;
  contentType: string;
  bytes: Uint8Array;
};

/**
 * Load one asset's row + its stored bytes, org-scoped, for re-learning a brand
 * source. Returns null when the asset is missing, belongs to another tenant, or
 * its object can't be downloaded — the caller reports a per-source error rather
 * than throwing the whole re-sync. Downloads from storage (not the public URL)
 * so it works the same for private buckets.
 */
export async function loadAssetForLearning(
  id: string,
  orgId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<AssetForLearning | null> {
  const { data, error } = await client
    .from("media_assets" as string)
    .select("id, file_name, kind, source, tags, available_to_arc, public_url, content_type, storage_path")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`media_assets lookup failed: ${error.message}`);
  const row = data as {
    id: string; file_name: string; kind: string; source: string; tags: string[] | null;
    available_to_arc: boolean; public_url: string; content_type: string; storage_path: string;
  } | null;
  if (!row) return null;

  const download = await client.storage.from(BUCKET).download(row.storage_path);
  if (download.error || !download.data) return null;
  const bytes = new Uint8Array(await download.data.arrayBuffer());

  return {
    id: row.id,
    fileName: row.file_name,
    kind: row.kind,
    source: row.source,
    tags: row.tags ?? [],
    availableToArc: row.available_to_arc,
    url: row.public_url,
    contentType: row.content_type,
    bytes,
  };
}

/**
 * File an asset into a folder, or to the Library root when `folderId` is null.
 *
 * Org-scoped like every other mutator here, and it was the one that wasn't
 * (BSR-707). It used to take no orgId and update on `id` alone. That was safe
 * only because its single caller — Arc's `arcFileAsset` — checks the asset's
 * and the target folder's owner before calling. Safe by external convention is
 * not the same as safe, and the second caller is where that runs out; this
 * function now refuses a row it does not own on its own terms.
 *
 * Note the ORDER of the two conditions on the target folder: the caller must
 * still verify the folder belongs to the org. Scoping the UPDATE to the asset's
 * org stops you writing another tenant's asset, not writing YOUR asset into
 * their folder.
 *
 * Returns false when nothing matched, so a caller can tell "not yours" from
 * "done" rather than reporting a silent no-op as success.
 */
export async function moveAsset(
  id: string,
  folderId: string | null,
  orgId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<boolean> {
  const { data, error } = await client
    .from("media_assets" as string)
    .update({ folder_id: folderId })
    .eq("id", id)
    .eq("org_id", orgId)
    .select("id");
  if (error) throw new Error(`media_assets update failed: ${error.message}`);
  return ((data ?? []) as unknown[]).length > 0;
}

export async function setAssetTags(id: string, tags: string[], orgId: string, client: SupabaseClient = getSupabaseAdminClient()): Promise<boolean> {
  const { data, error } = await client.from("media_assets" as string).update({ tags }).eq("id", id).eq("org_id", orgId).select("id");
  if (error) throw new Error(`media_assets update failed: ${error.message}`);
  return ((data ?? []) as unknown[]).length > 0;
}

/** Mark whether Arc may reuse this asset. Org-scoped on purpose: this runs through the
 *  RLS-bypassing service-role client, so the org filter is the only thing standing
 *  between an operator and another tenant's row. Returns false when nothing matched. */
export async function setAvailableToArc(
  id: string,
  value: boolean,
  orgId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<boolean> {
  const { data, error } = await client
    .from("media_assets" as string)
    .update({ available_to_arc: value })
    .eq("id", id)
    .eq("org_id", orgId)
    .select("id");
  if (error) throw new Error(`media_assets update failed: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function deleteAsset(id: string, orgId: string, client: SupabaseClient = getSupabaseAdminClient()): Promise<boolean> {
  // Org-scoped lookup: if it isn't this workspace's row, do nothing and report it.
  const { data, error } = await client
    .from("media_assets" as string)
    .select("storage_path")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`delete lookup failed: ${error.message}`);
  if (!data) return false;
  const path = (data as { storage_path?: string }).storage_path;
  // Skip the "pending" placeholder left by a failed upload — there's no object to remove.
  if (path && path !== "pending") {
    const { error: removeError } = await client.storage.from(BUCKET).remove([path]);
    // Don't block the row delete on a storage miss (object may already be gone),
    // but surface other failures so partial-delete problems are visible.
    if (removeError && !/not.?found|does not exist/i.test(removeError.message)) {
      throw new Error(`storage remove failed: ${removeError.message}`);
    }
  }
  const { data: deleted, error: deleteError } = await client
    .from("media_assets" as string)
    .delete()
    .eq("id", id)
    .eq("org_id", orgId)
    .select("id");
  if (deleteError) throw new Error(`media_assets delete failed: ${deleteError.message}`);
  return ((deleted ?? []) as unknown[]).length > 0;
}

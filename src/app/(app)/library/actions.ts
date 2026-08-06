"use server";

import { revalidatePath } from "next/cache";

import { type AssetDecision } from "@/domain";
import { getOperatorActor, requireOperator } from "@/lib/auth/operator";
import { getCurrentOrgId } from "@/lib/auth/org";
import { removeMediaRecordFromBrain, syncMediaRecordToBrain } from "@/lib/brain-ingestion/sync";
import { createFolder, deleteAsset, deleteFolder, insertAssetWithUrl, moveAsset, moveFolder, renameAsset, reorderFolders, setAssetTags, setAvailableToArc, updateFolder } from "@/lib/media-library/persistence";
import { decideAssetApproval } from "@/lib/media-library/approval";
import { getMediaLibraryData } from "@/lib/media-library/read-model";
import { promoteAssetToCampaign } from "@/lib/campaigns/create";
import { MAX_UPLOAD_BYTES, acceptUpload, kindForContentType } from "@/lib/media-library/upload-policy";
import { scanMediaIngest } from "@/lib/media-library/ingest-intelligence";
import { fetchRemoteMedia } from "@/lib/media-library/fetch-remote";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { type Asset } from "./_components/library-view";

/**
 * Real operator write for the Library "New folder" button. A folder is internal
 * organization (never outbound), so it persists directly through
 * requireOperator() + the org-scoped createFolder. `persisted: false` is the
 * honest offline signal so the tree can show it optimistically.
 */
export type CreateFolderResult =
  | { ok: true; persisted: boolean; id?: string }
  | { ok: false; error: string };

/**
 * `parentId` files the new folder INSIDE an existing one — the write behind the
 * rail's per-folder "New subfolder". `media_folders.parent_id` and the read
 * model's recursive walk have supported nesting since the table shipped; the
 * only thing missing was a caller, so every folder an operator made landed at
 * the root however deep they were standing.
 */
export async function createLibraryFolder(name: string, parentId?: string | null): Promise<CreateFolderResult> {
  await requireOperator();

  const trimmed = name?.trim();
  if (!trimmed) return { ok: false, error: "A folder name is required." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  try {
    const orgId = await getCurrentOrgId();
    const parent = parentId?.trim() || null;
    // Re-checked org-scoped: an id from the browser must not parent this
    // workspace's folder into another tenant's tree.
    if (parent) {
      const { data: found } = await getSupabaseAdminClient()
        .from("media_folders")
        .select("id")
        .eq("org_id", orgId)
        .eq("id", parent)
        .maybeSingle<{ id: string }>();
      if (!found) return { ok: false, error: "That parent folder isn't in this workspace." };
    }
    const id = await createFolder({ orgId, name: trimmed, parentId: parent });
    revalidatePath("/library");
    return { ok: true, persisted: true, id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not create the folder." };
  }
}

/**
 * Re-parent a folder — dragging one folder onto another in the rail, or picking
 * a destination from its row menu.
 *
 * `parentId: null` is the root and a real destination: a folder that could only
 * ever move deeper would make the tree a one-way trip, the same reason
 * `moveLibraryAssets` accepts a null folder. The cycle refusal comes back as its
 * own sentence rather than a generic failure, because "you can't put a folder
 * inside itself" is something the operator can act on and "could not move that
 * folder" is not. Internal organization — never outbound.
 */
export async function moveLibraryFolder(input: {
  folderId: string;
  parentId: string | null;
}): Promise<FolderMutationResult> {
  await requireOperator();
  const folderId = input.folderId?.trim();
  const parentId = input.parentId?.trim() || null;
  if (!folderId) return { ok: false, error: "A folder id is required." };
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };
  try {
    const orgId = await getCurrentOrgId();
    const result = await moveFolder(folderId, parentId, orgId);
    if (result === "cycle") return { ok: false, error: "A folder can't be moved inside itself." };
    if (result === "not_found") return { ok: false, error: "That folder isn't in this workspace." };
    revalidatePath("/library");
    return { ok: true, persisted: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not move the folder." };
  }
}

export type FolderMutationResult = { ok: true; persisted: boolean } | { ok: false; error: string };

/**
 * Edit a folder's name and/or its description. Org-scoped (`updateFolder`
 * returns false when the id isn't this workspace's row).
 *
 * One action for both fields rather than a rename action beside a description
 * action: they are the same row, the same gate and the same revalidation, and
 * the inline rename in the rail simply omits `description`. An explicit empty
 * description clears it; an omitted one is left alone. Internal organization —
 * never outbound.
 */
export async function updateLibraryFolder(input: {
  folderId: string;
  name?: string;
  description?: string | null;
}): Promise<FolderMutationResult> {
  await requireOperator();
  const folderId = input.folderId?.trim();
  if (!folderId) return { ok: false, error: "A folder id is required." };

  const patch: { name?: string; description?: string | null } = {};
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) return { ok: false, error: "A folder name is required." };
    patch.name = trimmed;
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (patch.name === undefined && patch.description === undefined) return { ok: true, persisted: false };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };
  try {
    const orgId = await getCurrentOrgId();
    const matched = await updateFolder(folderId, patch, orgId);
    if (!matched) return { ok: false, error: "That folder isn't in this workspace." };
    revalidatePath("/library");
    return { ok: true, persisted: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not update the folder." };
  }
}

/** The rail's inline rename (F2), which is just the name half of the above. */
export async function renameLibraryFolder(folderId: string, name: string): Promise<FolderMutationResult> {
  return updateLibraryFolder({ folderId, name });
}

/**
 * Persist the order of one parent's children — dragging a folder between two
 * others in the rail, or Move up / Move down from its menu.
 *
 * `parentId: null` is the top level. The caller sends the full ordered list it
 * is showing rather than a delta, so what gets stored is what the operator
 * sees; the server still decides membership (see `reorderFolders`).
 */
export async function reorderLibraryFolders(input: {
  parentId: string | null;
  orderedIds: string[];
}): Promise<FolderMutationResult> {
  await requireOperator();
  const orderedIds = (input.orderedIds ?? []).map((id) => id?.trim()).filter(Boolean) as string[];
  if (orderedIds.length === 0) return { ok: false, error: "Nothing to reorder." };
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };
  try {
    const orgId = await getCurrentOrgId();
    await reorderFolders(orgId, input.parentId?.trim() || null, orderedIds);
    revalidatePath("/library");
    return { ok: true, persisted: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not reorder the folders." };
  }
}

/**
 * Delete a folder. Org-scoped. Its assets are not lost — the FK is
 * `ON DELETE SET NULL`, so they fall back to "All assets", and child folders are
 * promoted to the root. Internal organization — never outbound.
 */
export async function deleteLibraryFolder(folderId: string): Promise<FolderMutationResult> {
  await requireOperator();
  if (!folderId?.trim()) return { ok: false, error: "A folder id is required." };
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };
  try {
    const orgId = await getCurrentOrgId();
    const matched = await deleteFolder(folderId, orgId);
    if (!matched) return { ok: false, error: "That folder isn't in this workspace." };
    revalidatePath("/library");
    return { ok: true, persisted: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not delete the folder." };
  }
}

function formatSize(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export type UploadAssetResult =
  | { ok: true; persisted: boolean; asset?: Asset }
  | { ok: false; error: string };

/**
 * Persist an operator-uploaded media file to media_assets (public campaign-media
 * bucket) so it becomes real, reusable library media — not a session-only preview.
 * New uploads are stored with `available_to_arc = false` (passed explicitly, not
 * inherited from the DB default): the operator marks what Arc may reuse via
 * setLibraryAssetArcAvailability. Held media is not mirrored into the Brain.
 * Returns the stored asset in the view's shape so the grid can show it immediately.
 */
export async function uploadLibraryAsset(formData: FormData): Promise<UploadAssetResult> {
  await requireOperator();

  const file = formData.get("file");
  const folderId = (formData.get("folderId") as string | null)?.trim() || null;
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a file first." };
  const accepted = acceptUpload(file.name, file.type);
  if (!accepted.ok) return { ok: false, error: "Unsupported file type — use an image, MP4/MOV/WEBM video, PDF, or a .docx/.md/.csv/.txt document." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "File is too large — keep it under 50MB." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  try {
    const [orgId, uploadedBy] = await Promise.all([getCurrentOrgId(), getOperatorActor()]);
    const contentType = accepted.contentType;
    const kind = kindForContentType(contentType);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const scan = scanMediaIngest({ fileName: file.name, kind });
    const { id, url } = await insertAssetWithUrl({
      orgId,
      folderId,
      fileName: file.name,
      bytes,
      contentType,
      kind,
      byteSize: file.size,
      source: "uploaded",
      provenance: { origin: "operator_upload" },
      riskFlags: scan.riskFlags,
      tags: scan.tags,
      uploadedBy,
    });
    revalidatePath("/library");

    const asset: Asset = {
      id: 0, // reassigned client-side
      rid: id,
      nm: file.name,
      kind: kind === "video" ? "video" : kind === "document" ? "document" : "image",
      pv: "upload",
      sc: kind === "video" ? "video" : kind === "document" ? "doc" : "photo",
      folder: folderId ?? "",
      dim: "—",
      size: formatSize(file.size),
      tags: ["imported"],
      arc: false,
      used: [],
      by: uploadedBy,
      added: "just now",
      recent: 1,
      risk: "Imported — provenance unverified before Arc may reuse.",
      img: url,
      lineage: [["upload", "Uploaded by you"]],
      uses: 0,
    };
    return { ok: true, persisted: true, asset };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not upload the file." };
  }
}

/**
 * Real backend for the Library "Import from URL" modal (previously a
 * session-only preview that persisted nothing). SSRF-guarded https fetch, the
 * shared upload policy, and the same ingest scan every other path gets. Held
 * for provenance review like all imports — never outbound.
 */
export async function importLibraryAssetFromUrl(input: {
  url: string;
  name?: string;
  folderId?: string | null;
}): Promise<UploadAssetResult> {
  await requireOperator();

  const url = input.url?.trim();
  if (!url) return { ok: false, error: "Enter a URL first." };
  const fallbackName = decodeURIComponent(url.split("?")[0]!.split("/").pop() ?? "") || "imported-asset";
  const fileName = input.name?.trim() || fallbackName;

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  try {
    const fetched = await fetchRemoteMedia({ url, fileName });
    if (!fetched.ok) return { ok: false, error: fetched.error };

    const [orgId, uploadedBy] = await Promise.all([getCurrentOrgId(), getOperatorActor()]);
    const kind = kindForContentType(fetched.contentType);
    const scan = scanMediaIngest({ fileName, kind, provenance: { sourceUrl: url } });
    const { id, url: publicUrl } = await insertAssetWithUrl({
      orgId,
      folderId: input.folderId?.trim() || null,
      fileName,
      bytes: fetched.bytes,
      contentType: fetched.contentType,
      kind,
      byteSize: fetched.bytes.byteLength,
      // "url" is the schema's vocabulary — media_assets_source_check on prod
      // allows (uploaded|ai_generated|composite|stock|external|google_drive|url),
      // and the read-model's badge already maps source "url" -> "URL".
      source: "url",
      provenance: { origin: "url_import", sourceUrl: url },
      riskFlags: scan.riskFlags,
      tags: scan.tags,
      uploadedBy,
    });
    revalidatePath("/library");

    const asset: Asset = {
      id: 0, // reassigned client-side
      rid: id,
      nm: fileName,
      kind: kind === "video" ? "video" : kind === "document" ? "document" : "image",
      pv: "upload",
      sc: kind === "video" ? "video" : kind === "document" ? "doc" : "photo",
      folder: input.folderId ?? "",
      dim: "—",
      size: formatSize(fetched.bytes.byteLength),
      tags: scan.tags.length ? scan.tags : ["imported"],
      arc: false,
      used: [],
      by: uploadedBy,
      added: "just now",
      recent: 1,
      risk: "Imported from URL — provenance unverified before Arc may reuse.",
      img: kind === "image" ? publicUrl : undefined,
      lineage: [["upload", "Imported from URL"]],
      uses: 0,
    };
    return { ok: true, persisted: true, asset };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not import that URL." };
  }
}

export type SetArcAvailabilityResult =
  | { ok: true; persisted: boolean }
  | { ok: false; error: string };

/**
 * The operator's provenance decision: whether Arc may reuse a Library asset.
 *
 * This is the gate the Library has always advertised ("Mark what Arc may use") but
 * never enforced — the toggle was local component state, so nothing reached the DB.
 * Granting also mirrors the asset into the Brain; revoking removes that node, so
 * recall can't keep surfacing media the operator just pulled back. Neither direction
 * sends anything outbound.
 */
export async function setLibraryAssetArcAvailability(
  assetId: string,
  value: boolean,
): Promise<SetArcAvailabilityResult> {
  await requireOperator();

  if (!assetId?.trim()) return { ok: false, error: "An asset id is required." };
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  try {
    const orgId = await getCurrentOrgId();
    const matched = await setAvailableToArc(assetId, value, orgId);
    if (!matched) return { ok: false, error: "That asset isn't in this workspace." };

    // Best-effort: the flag is the source of truth, so don't fail the operator's
    // decision if the Brain mirror lags.
    if (value) await syncMediaRecordToBrain(assetId, { orgId }).catch(() => undefined);
    else await removeMediaRecordFromBrain(assetId, { orgId }).catch(() => undefined);

    revalidatePath("/library");
    return { ok: true, persisted: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not update the asset." };
  }
}

export type EditAssetResult = { ok: true; persisted: boolean } | { ok: false; error: string };

/**
 * Rename a Library asset's display name. Org-scoped through the service-role
 * client (renameAsset returns false when the id isn't this workspace's row).
 * Display-only — the storage path/URL are untouched, nothing outbound.
 */
export async function renameLibraryAsset(assetId: string, name: string): Promise<EditAssetResult> {
  await requireOperator();
  const trimmed = name?.trim();
  if (!assetId?.trim()) return { ok: false, error: "An asset id is required." };
  if (!trimmed) return { ok: false, error: "A name is required." };
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };
  try {
    const orgId = await getCurrentOrgId();
    const matched = await renameAsset(assetId, trimmed, orgId);
    if (!matched) return { ok: false, error: "That asset isn't in this workspace." };
    revalidatePath("/library");
    return { ok: true, persisted: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not rename the asset." };
  }
}

/** Replace a Library asset's tags (tags already drive the search/filter). Org-scoped. */
export async function setLibraryAssetTags(assetId: string, tags: string[]): Promise<EditAssetResult> {
  await requireOperator();
  if (!assetId?.trim()) return { ok: false, error: "An asset id is required." };
  const clean = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 24);
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };
  try {
    const orgId = await getCurrentOrgId();
    const matched = await setAssetTags(assetId, clean, orgId);
    if (!matched) return { ok: false, error: "That asset isn't in this workspace." };
    revalidatePath("/library");
    return { ok: true, persisted: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not update the tags." };
  }
}

export type DeleteAssetResult = { ok: true; persisted: boolean } | { ok: false; error: string };

/**
 * Delete a Library asset — removes the storage object + the row, and drops any
 * Brain mirror so recall can't keep surfacing deleted media. Org-scoped through
 * the RLS-bypassing service-role client (deleteAsset returns false when the id
 * isn't this workspace's row). Never outbound. Campaigns that already embedded the
 * media keep their own snapshot (the reference lives in their audit_payload), so
 * deleting here only removes it from the Library.
 */
export async function deleteLibraryAsset(assetId: string): Promise<DeleteAssetResult> {
  await requireOperator();

  if (!assetId?.trim()) return { ok: false, error: "An asset id is required." };
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  try {
    const orgId = await getCurrentOrgId();
    const deleted = await deleteAsset(assetId, orgId);
    if (!deleted) return { ok: false, error: "That asset isn't in this workspace." };

    await removeMediaRecordFromBrain(assetId, { orgId }).catch(() => undefined);

    revalidatePath("/library");
    return { ok: true, persisted: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not delete the asset." };
  }
}

export type AddToCampaignResult =
  | { ok: true; persisted: boolean; added: number; campaignName?: string }
  | { ok: false; error: string };

/**
 * Attach selected Library media to a campaign as approval-gated draft assets.
 *
 * This is the real backing for the Library's "Add to campaign" control, which used
 * to be a bare link to /campaigns: it navigated away and the operator's selection
 * was silently discarded — nothing was ever added.
 *
 * Each asset goes through `promoteAssetToCampaign`, the SAME path Studio uses, so
 * everything lands `pending_approval` + `dispatch_locked` with provenance carried
 * over. Nothing here reaches the outside world; the human gate is untouched.
 */
export async function addLibraryAssetsToCampaign(input: {
  assetIds: string[];
  campaignId: string;
}): Promise<AddToCampaignResult> {
  await requireOperator();

  const assetIds = [...new Set((input.assetIds ?? []).map((id) => id?.trim()).filter(Boolean))] as string[];
  const campaignId = input.campaignId?.trim();
  if (assetIds.length === 0) return { ok: false, error: "Select at least one asset." };
  if (!campaignId) return { ok: false, error: "Pick a campaign to add them to." };
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false, added: assetIds.length };

  try {
    const [orgId, operator] = await Promise.all([getCurrentOrgId(), getOperatorActor()]);
    const client = getSupabaseAdminClient();

    // Re-read the assets org-scoped rather than trusting ids from the browser, so a
    // foreign id can't be promoted into this workspace's campaign.
    const data = await getMediaLibraryData(client, orgId);
    if (data.status !== "live") return { ok: false, error: "The Library isn't available right now." };
    const wanted = data.assets.filter((a) => assetIds.includes(a.id));
    if (wanted.length === 0) return { ok: false, error: "Those assets aren't in this workspace." };

    const { data: campaign } = await client
      .from("campaigns")
      .select("id,name")
      .eq("org_id", orgId)
      .eq("id", campaignId)
      .maybeSingle<{ id: string; name: string }>();
    if (!campaign) return { ok: false, error: "That campaign isn't in this workspace." };

    let added = 0;
    for (const asset of wanted) {
      await promoteAssetToCampaign({
        operator,
        campaignId: campaign.id,
        assetType: asset.kind === "video" ? "video_ad" : "social_ad",
        title: asset.fileName,
        body: null,
        mediaUrl: asset.url,
        media: { source: asset.source, riskFlags: asset.riskFlags },
        client,
      });
      added += 1;
    }

    revalidatePath("/library");
    revalidatePath(`/campaigns/${campaign.id}`);
    revalidatePath("/campaigns");
    return { ok: true, persisted: true, added, campaignName: campaign.name };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not add those assets to the campaign." };
  }
}

export type MoveAssetsResult =
  | { ok: true; persisted: boolean; moved: number; folderName: string | null }
  | { ok: false; error: string };

/**
 * File selected assets into a folder, or back out to the Library root (BSR-707).
 *
 * The Library's folder tree was read-only in practice: folders could be created,
 * renamed and deleted, but `media_assets.folder_id` was only ever set at upload,
 * so an asset stayed wherever it first landed. "Move to folder" sat in the
 * selection bar as a dead <span> because there was nothing to wire it to.
 *
 * `folderId: null` means the root, and is a real destination rather than a
 * missing argument — moving something OUT of a folder has to be possible or the
 * tree becomes a one-way trip.
 *
 * Both sides are re-checked org-scoped rather than trusted from the browser:
 * the assets (so a foreign id cannot be dragged into this workspace) and the
 * destination (so this workspace's asset cannot be filed into another tenant's
 * folder). `moveAsset` scopes the write to the asset's org, which stops the
 * first but cannot stop the second — the destination check is not redundant.
 */
export async function moveLibraryAssets(input: {
  assetIds: string[];
  folderId: string | null;
}): Promise<MoveAssetsResult> {
  await requireOperator();

  const assetIds = [...new Set((input.assetIds ?? []).map((id) => id?.trim()).filter(Boolean))] as string[];
  const folderId = input.folderId?.trim() || null;
  if (assetIds.length === 0) return { ok: false, error: "Select at least one asset." };
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false, moved: assetIds.length, folderName: null };

  try {
    const orgId = await getCurrentOrgId();
    const client = getSupabaseAdminClient();

    let folderName: string | null = null;
    if (folderId) {
      const { data: folder } = await client
        .from("media_folders")
        .select("id,name")
        .eq("org_id", orgId)
        .eq("id", folderId)
        .maybeSingle<{ id: string; name: string }>();
      if (!folder) return { ok: false, error: "That folder isn't in this workspace." };
      folderName = folder.name;
    }

    let moved = 0;
    for (const assetId of assetIds) {
      // eslint-disable-next-line no-await-in-loop -- a handful of ids; sequential keeps the count honest
      if (await moveAsset(assetId, folderId, orgId, client)) moved += 1;
    }
    // Every id was rejected: the selection is not this workspace's, and saying
    // "moved 0" as a success would read as "done".
    if (moved === 0) return { ok: false, error: "Those assets aren't in this workspace." };

    revalidatePath("/library");
    return { ok: true, persisted: true, moved, folderName };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not move those assets." };
  }
}

/**
 * Record a human decision on a media asset (BSR-538).
 *
 * Approval runs through `approval_items` — the same table, vocabulary and audit
 * trail campaigns use — so there is exactly one approval concept and a reviewer
 * asking "why did this go out?" finds assets and campaigns together.
 *
 * Approving marks the asset reviewed. It does NOT send, publish or unlock
 * outbound; that invariant is unchanged.
 *
 * A flagged asset cannot be approved without an acknowledgement, and the gate
 * reads the flags from the database rather than from this call — see
 * `decideAssetApproval`.
 */
export type DecideAssetResult =
  | { ok: true; persisted: boolean; status: AssetDecision }
  | { ok: false; error: string; flags?: string[] };

export async function decideLibraryAsset(input: {
  assetId: string;
  decision: AssetDecision;
  notes?: string | null;
  acknowledgement?: string | null;
}): Promise<DecideAssetResult> {
  await requireOperator();

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false, status: input.decision };

  const orgId = await getCurrentOrgId();
  if (!orgId) return { ok: false, error: "No active workspace." };

  try {
    const result = await decideAssetApproval(
      {
        assetId: input.assetId,
        orgId,
        decision: input.decision,
        operator: await getOperatorActor(),
        notes: input.notes ?? null,
        acknowledgement: input.acknowledgement ?? null,
      },
      getSupabaseAdminClient(),
    );
    if (!result.ok) return { ok: false, error: result.error, flags: result.flags };

    revalidatePath("/library");
    return { ok: true, persisted: true, status: result.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not record the decision." };
  }
}

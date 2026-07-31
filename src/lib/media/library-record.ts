/**
 * Put generated media in the Library (BSR-634).
 *
 * The generation routes stored their bytes and returned a URL, and nothing ever
 * wrote a `media_assets` row. Verified on prod 2026-07-31: the first real
 * generation produced a 959 KB JPEG in the bucket, a campaign asset, an approval
 * item and a metered spend event — while `/library` still read "0 images, 0
 * stored". The creative existed and could not be reused, which also left Studio's
 * compose path permanently gated for a workspace whose only media came from Arc.
 *
 * Best-effort by construction. A library row is how creative becomes reusable; it
 * is not what makes the generation valid. If this fails, the caller still returns
 * the media it just produced rather than turning a successful, already-metered
 * generation into a 502.
 */

import { ensureNamedFolder, recordStoredAsset } from "@/lib/media-library/persistence";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

/** Where Arc's own output lands, kept separate from operator uploads so the
 *  provenance split stays visible in the folder tree. */
export const AI_FOLDER_NAME = "AI-generated";
const AI_FOLDER_DESCRIPTION = "Images and video Arc generated. Review before reuse.";

export type RecordGeneratedMediaInput = {
  orgId: string | null | undefined;
  /** Storage path the generator already wrote to. */
  objectPath: string;
  publicUrl: string;
  contentType: string;
  kind: "image" | "video";
  byteSize: number;
  /** The operator's original prompt — provenance, not the hardened variant. */
  prompt?: string;
  model?: string | null;
  jobId?: string | null;
  format?: string | null;
  riskFlags?: string[];
  uploadedBy?: string;
};

/** A readable file name from the prompt, so the Library is scannable rather than
 *  a wall of UUIDs. Falls back to the object's own basename. */
export function generatedFileName(input: { prompt?: string; objectPath: string; kind: string }): string {
  const ext = input.objectPath.split(".").pop() ?? (input.kind === "video" ? "mp4" : "jpg");
  const stem = (input.prompt ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 7)
    .join(" ")
    .replace(/[^a-zA-Z0-9 ]+/g, "")
    .trim();
  return stem ? `${stem}.${ext}` : (input.objectPath.split("/").pop() ?? `generated.${ext}`);
}

/**
 * Write the Library row for media that is already in the bucket. Returns the new
 * asset id, or null when it could not be recorded — never throws.
 */
export async function recordGeneratedMedia(input: RecordGeneratedMediaInput): Promise<string | null> {
  if (!input.orgId || !isSupabaseAdminConfigured()) return null;
  try {
    // Filing is organisation; the row is the point. A folder lookup that fails
    // must not cost us the asset — it lands at the root and stays reusable.
    const folderId = await ensureNamedFolder(input.orgId, AI_FOLDER_NAME, AI_FOLDER_DESCRIPTION).catch(() => null);
    return await recordStoredAsset({
      orgId: input.orgId,
      folderId,
      fileName: generatedFileName({ prompt: input.prompt, objectPath: input.objectPath, kind: input.kind }),
      storagePath: input.objectPath,
      publicUrl: input.publicUrl,
      contentType: input.contentType,
      kind: input.kind,
      byteSize: input.byteSize,
      source: "ai_generated",
      provenance: {
        generator: "arc",
        ...(input.model ? { model: input.model } : {}),
        ...(input.jobId ? { jobId: input.jobId } : {}),
        ...(input.format ? { format: input.format } : {}),
        ...(input.prompt ? { prompt: input.prompt } : {}),
      },
      riskFlags: input.riskFlags ?? [],
      tags: ["ai-generated"],
      uploadedBy: input.uploadedBy ?? "arc",
      // Held for review like any other unreviewed asset — see recordStoredAsset.
      availableToArc: false,
    });
  } catch {
    return null;
  }
}

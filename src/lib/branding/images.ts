import { randomUUID } from "node:crypto";

import { BRANDING_IMAGE_MAX_BYTES, BRANDING_IMAGE_MAX_LABEL } from "@/domain/branding-image";
import { storeGeneratedMedia } from "@/lib/media/storage";

// Keep uploads small and web-renderable. These are logos/avatars, not media —
// a few MB is plenty and protects the public bucket from large blobs.
//
// The server gate, not a convenience: `file.type` is whatever the browser
// asserted, so this map is the only thing standing between a declared type and
// a permanent public URL. It must stay in step with BRANDING_IMAGE_ACCEPT —
// see the note there for why SVG is not on either list.
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type UploadImageResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Validate + upload a user-provided branding image (workspace logo / user avatar)
 * to the public campaign-media bucket, returning its permanent URL. The path
 * carries a random suffix so a re-upload gets a fresh URL and the CDN can't serve
 * a stale image. Server-only — call from a requireOperator()-gated action.
 */
export async function uploadBrandingImage(prefix: string, file: File): Promise<UploadImageResult> {
  const ext = EXT[file.type];
  if (!ext) return { ok: false, error: "Use a PNG, JPG, WEBP, or GIF image." };
  if (file.size > BRANDING_IMAGE_MAX_BYTES) {
    return { ok: false, error: `Image is too large — keep it under ${BRANDING_IMAGE_MAX_LABEL}.` };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) return { ok: false, error: "That file was empty." };

  const path = `branding/${prefix}/${randomUUID()}.${ext}`;
  try {
    const url = await storeGeneratedMedia(path, bytes, file.type);
    return { ok: true, url };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Upload failed." };
  }
}

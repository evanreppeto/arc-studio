/** Pure media-library helpers. No I/O — unit-tested in domain/__tests__. */

export type MediaKind = "image" | "video" | "logo" | "document";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/x-icon"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const DOC_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

/**
 * What a file IS — deliberately broader than what we accept.
 *
 * The SVG branch stays even though SVG can no longer be uploaded: this answers
 * a question about a file, not about a policy, and the gate lives in
 * `upload-policy.ts`. If an SVG ever arrives by some other route — a backfill,
 * an import, a legacy row — calling it a `logo` is right and calling it a
 * `document` is a silent wrong answer. Prod holds none today (0 in storage,
 * 0 in media_assets), so this is insurance, not upkeep.
 */
export function classifyKind(contentType: string, fileName: string): MediaKind {
  if (contentType === "image/svg+xml" || fileName.toLowerCase().endsWith(".svg")) return "logo";
  if (contentType === "image/x-icon" || fileName.toLowerCase().endsWith(".ico")) return "logo";
  if (IMAGE_TYPES.includes(contentType)) return "image";
  if (VIDEO_TYPES.includes(contentType)) return "video";
  if (DOC_TYPES.includes(contentType)) return "document";
  return "document";
}

export type UploadCheck = { contentType: string; byteSize: number };
export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * ⚠️ NO CALLERS. The live gate is `acceptUpload` in
 * `src/lib/media-library/upload-policy.ts` — that is what the Library action,
 * the Brand action, `/api/v1/media` and the remote-URL fetcher all go through.
 * This function is reachable only from its own test.
 *
 * Kept in step with the real gate rather than left behind: a dead duplicate
 * that stays superficially current is how `decideApprovalItem` preserved a live
 * bug for months (see CLAUDE.md). It should probably be deleted outright, but
 * that is a separate change from a security fix.
 */
export function validateUpload({ contentType, byteSize }: UploadCheck): ValidationResult {
  const allowed = [...IMAGE_TYPES, ...VIDEO_TYPES, ...DOC_TYPES];
  if (!allowed.includes(contentType)) return { ok: false, reason: `Unsupported file type: ${contentType}` };
  if (byteSize > MAX_UPLOAD_BYTES) return { ok: false, reason: "File exceeds the 50 MB limit." };
  return { ok: true };
}

/**
 * Split a filename into its editable stem and its extension (including the
 * leading dot). A leading dot (dotfiles like ".gitignore") and a trailing dot
 * are not treated as extensions, so the stem stays meaningful to edit.
 */
export function splitFileName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot < name.length - 1) {
    return { stem: name.slice(0, dot), ext: name.slice(dot) };
  }
  return { stem: name, ext: "" };
}

/**
 * Combine a user-edited stem with the original name's extension so a rename
 * can't silently drop or change it. Empty stems fall back to the original name,
 * and a stem that already carries the extension isn't doubled up (so passing a
 * full filename here is safe too).
 */
export function applyFileNameStem(originalName: string, newStem: string): string {
  const trimmed = newStem.trim();
  if (!trimmed) return originalName;
  const { ext } = splitFileName(originalName);
  if (ext && trimmed.toLowerCase().endsWith(ext.toLowerCase())) return trimmed;
  return trimmed + ext;
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  const kb = bytes / 1_000;
  if (kb < 1_000) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1_000;
  if (mb < 1_000) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1_000;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}

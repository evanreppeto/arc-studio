// Shared upload policy for media + brand-document uploads. Pure, no I/O — lives
// outside the "use server" action files (whose exports must all be async server
// functions) so both the Library and Brand upload paths can share one gate.

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB — covers photos, short clips, and brand docs.

// SVG is deliberately absent, for the same reason it left BRANDING_IMAGE_ACCEPT
// (#1096): library uploads land in the PUBLIC campaign-media bucket and are
// served from the project's own origin with the content type they arrived as,
// no `Content-Disposition` and no `X-Content-Type-Options: nosniff`. An SVG is
// script-capable, so opening its permanent public url renders it as a document
// and runs whatever is inside. Nothing displays library assets inline — but the
// url is the exposure, not the render.
//
// This gate is the one that matters: it is what `/api/v1/media` and the
// remote-URL fetcher call, not just the Library picker.
const ALLOWED_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif",
  "video/mp4", "video/quicktime", "video/webm", "application/pdf",
  // Text-like brand documents.
  "text/plain", "text/markdown", "text/x-markdown", "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

// Extensions accepted even when the browser sends no (or a wrong) MIME type —
// .md and .csv are routinely delivered as "" or application/octet-stream.
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/**
 * Decide whether an uploaded file is allowed, and return the content type to
 * store. A file passes if its MIME type is known, or its name carries a
 * brand-document extension the browser failed to type — in which case the
 * extension supplies the content type when the browser gave none.
 */
export function acceptUpload(
  fileName: string,
  contentType: string,
): { ok: true; contentType: string } | { ok: false } {
  if (ALLOWED_TYPES.has(contentType)) return { ok: true, contentType };
  const lower = fileName.toLowerCase();
  const ext = Object.keys(EXTENSION_CONTENT_TYPES).find((e) => lower.endsWith(e));
  if (!ext) return { ok: false };
  // We only reach here because the browser's type was unrecognized (missing, or
  // generic like application/octet-stream). Trust the extension over it — a
  // wrong type persisted here would later defeat text extraction.
  return { ok: true, contentType: EXTENSION_CONTENT_TYPES[ext] };
}

/** Media kind for a stored asset, from its (resolved) content type. */
export function kindForContentType(contentType: string): "image" | "video" | "document" {
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("image/")) return "image";
  return "document";
}

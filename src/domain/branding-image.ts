export const BRANDING_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const BRANDING_IMAGE_MAX_LABEL = "4MB";
/**
 * What the file pickers offer, and what the server accepts.
 *
 * SVG is deliberately absent. These uploads land in a PUBLIC Supabase bucket
 * and are served from the project's own origin with the content type they were
 * uploaded as, no `Content-Disposition` and no `X-Content-Type-Options: nosniff`
 * (verified against a live object). Rendering is safe — every call site draws
 * them through `AppImage`/`<img src>`, and a browser will not run script in an
 * SVG loaded that way — but the stored URL is public and permanent, so opening
 * it directly renders the file as a *document* and executes anything inside it.
 * A raster logo cannot carry script; an SVG can, which is the whole difference.
 */
export const BRANDING_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

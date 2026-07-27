/**
 * The origin Supabase should send auth-email traffic back to.
 *
 * Supabase validates every `emailRedirectTo` against the project's **Redirect
 * URLs** allow-list and silently falls back to the project **Site URL** when the
 * value isn't on it — which is how a production confirmation link ends up
 * pointing at localhost. Deriving the origin from the request would make that
 * value vary by host (apex vs. www, the per-deployment *.vercel.app URL, a proxy
 * host), so every variant would need its own allow-list entry and any miss would
 * fail this way. Pinning it to the configured public origin means there is
 * exactly one entry to allow-list.
 *
 * Falls back to the request origin when `NEXT_PUBLIC_APP_URL` is unset so local
 * dev and preview deployments keep working untouched.
 */
export function authEmailRedirectOrigin(requestOrigin: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured && /^https?:\/\//.test(configured)) {
    try {
      return new URL(configured).origin;
    } catch {
      // Malformed value — fall through to the request origin rather than
      // breaking sign-up entirely.
    }
  }
  return requestOrigin;
}

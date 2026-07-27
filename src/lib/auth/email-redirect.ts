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
let warnedUnpinnedOrigin = false;

/**
 * Say so, once, when the pin isn't set. Unset, this function still returns a
 * perfectly plausible origin, the email still sends, and the failure lands two
 * systems away — Supabase drops the unlisted `emailRedirectTo`, substitutes its
 * Site URL, and the confirmation link quietly goes somewhere that isn't this app.
 * Nothing in the request path errors, so the only way to notice was to read the
 * runtime logs and see that /auth/callback was never hit at all.
 */
function warnUnpinnedOriginOnce(requestOrigin: string) {
  if (warnedUnpinnedOrigin) return;
  warnedUnpinnedOrigin = true;
  console.warn(
    `[auth] NEXT_PUBLIC_APP_URL is not set — building auth email links from the request origin ` +
      `(${requestOrigin}). Every host this app answers on then needs its own entry in Supabase's ` +
      `Redirect URLs allow-list, and any miss is silent: Supabase falls back to the project Site URL ` +
      `and the confirmation link never reaches this app. See docs/runbooks/email-invites-setup.md §1b.`,
  );
}

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
  warnUnpinnedOriginOnce(requestOrigin);
  return requestOrigin;
}

/** Test seam: the warn-once latch is module state. */
export function __resetEmailRedirectWarning() {
  warnedUnpinnedOrigin = false;
}

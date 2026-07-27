import { DEFAULT_SUPPORT_EMAIL } from "@/lib/settings/store";

/**
 * Where in-app support requests go.
 *
 * Deliberately NOT `getSupportContactEmail()` from the settings store — that's
 * the address a workspace publishes to *its own* customers. A bug report about
 * Arc must reach whoever runs Arc, not the tenant's own support inbox.
 *
 * Set ARC_SUPPORT_INBOX to route product support somewhere specific; otherwise
 * it falls back to the operator support address, then the built-in default.
 */
export function resolveSupportInbox(env: Record<string, string | undefined> = process.env): string {
  return (
    env.ARC_SUPPORT_INBOX?.trim() ||
    env.OPERATOR_SUPPORT_EMAIL?.trim() ||
    DEFAULT_SUPPORT_EMAIL
  );
}

/** Short build identifier shown in diagnostics so a report can be pinned to a deploy. */
export function resolveAppVersion(env: Record<string, string | undefined> = process.env): string {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (sha) return sha.slice(0, 7);
  return env.NEXT_PUBLIC_APP_VERSION?.trim() || "";
}

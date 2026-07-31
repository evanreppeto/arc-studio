import { type AuthMode } from "./auth-mode";

type WorkspaceAccessDecisionInput = {
  hasWorkspace: boolean;
  isSignedIn: boolean;
  pathname: string;
};

export type WorkspaceAccessDecision = { action: "allow" | "login" | "onboarding" | "app" };

export function getWorkspaceAccessDecision(input: WorkspaceAccessDecisionInput): WorkspaceAccessDecision {
  // Accepting an invite is public: reachable signed-out (create an account that
  // joins the workspace) and signed-in without a workspace (accept to get one).
  // The page itself branches on the session, so allow every state here.
  if (input.pathname === "/accept-invite" || input.pathname.startsWith("/accept-invite/")) {
    return { action: "allow" };
  }
  // A signed-out visitor on the root gets the public marketing landing page
  // served at the root itself (the root page renders it) — not a login wall.
  if (!input.isSignedIn) {
    return input.pathname === "/" ? { action: "allow" } : { action: "login" };
  }
  if (input.hasWorkspace) {
    // A signed-in member hitting the root goes into the app (/home) rather than
    // sitting on the bare redirect page.
    if (input.pathname === "/") return { action: "app" };
    return { action: "allow" };
  }
  if (input.pathname === "/onboarding" || input.pathname.startsWith("/onboarding/")) return { action: "allow" };
  return { action: "onboarding" };
}

const STATIC_ASSET_RE = /\.(?:js|mjs|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|map|json|txt|xml|webmanifest)$/i;

/**
 * Public marketing pages — reachable in every auth mode and every session state.
 *
 * A prospect has to be able to read pricing before they have an account, and a
 * signed-in customer has to be able to re-read it without being bounced to
 * /home. So these are allowed unconditionally rather than branching on session.
 *
 * Matched EXACTLY (plus a real sub-path), never as a bare prefix: `/pricing`
 * must not also exempt a future `/pricing-internal`. Prefix matching on a page
 * name is what previously served a gated page to signed-out visitors — see the
 * matcher comment in `proxy.ts`.
 */
const PUBLIC_MARKETING_PATHS = ["/pricing", "/compare", "/industries"] as const;

function isPublicMarketingPath(pathname: string): boolean {
  return PUBLIC_MARKETING_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Which paths bypass the auth gate.
 *
 * - Static assets (anything with an asset extension) are ALWAYS public, so the
 *   login screen can render its styles, scripts, and images.
 * - Public marketing pages (`PUBLIC_MARKETING_PATHS`, e.g. /pricing) are ALWAYS
 *   public — a prospect reads them before they have an account.
 * - In open / operator mode the root landing stays public (the no-login demo);
 *   the rest of open mode is let through separately in `proxy.ts`.
 * - In supabase mode nothing else here is public: the root and every app route
 *   require a signed-in member, so an unauthenticated visitor is sent to the
 *   standalone `/login` page (the auth pages themselves — /login, /sign-up,
 *   /forgot-password, /reset-password — are exempted by the proxy matcher, not
 *   here).
 *
 * Pure + edge-safe so `proxy.ts` can call it and it can be unit-tested.
 */
export function isPublicPath(pathname: string, authMode: AuthMode): boolean {
  if (STATIC_ASSET_RE.test(pathname)) return true;
  if (isPublicMarketingPath(pathname)) return true;
  if (authMode !== "supabase") return pathname === "/";
  return false;
}

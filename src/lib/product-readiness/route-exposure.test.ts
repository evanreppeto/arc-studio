import { describe, expect, it } from "vitest";

import { isPublicPath } from "@/lib/auth/route-protection";

import { censusApiRoutes, censusPageRoutes, knownTokenGuards } from "./route-census";

/**
 * Route exposure regression suite (BSR-521, test 2).
 *
 * The acceptance criterion is blunt: **adding a route without classifying it
 * fails CI.** Every page and API route is enumerated from the filesystem and
 * checked against the manifests below. A new route that nobody classified is a
 * failure, not a silent pass — which is the difference between this and the
 * hand-written path lists it replaces.
 *
 * The exposure this exists to prevent already happened once: a proxy matcher
 * exemption named after a `public/` asset directory also exempted a page route,
 * and a workspace's brand kit was served to signed-out visitors. Nothing in the
 * suite at the time could have caught it, because nothing enumerated routes.
 *
 * NOT the org resolver's fault, then or now — the matcher was. Don't re-flag it.
 */

/** Pages outside the `(app)` group, each with why it is reachable signed out. */
const PUBLIC_PAGE_MANIFEST: Record<string, string> = {
  "/": "Public landing for signed-out visitors; redirects members into the app.",
  "/landing": "The landing page's own route; same content as `/`, kept out of the index.",
  "/pricing": "A prospect reads pricing before they have an account.",
  "/compare": "Comparison hub — organic search entry point (BSR-583).",
  "/compare/[slug]": "Individual comparison pages — organic search entry points.",
  "/industries": "Industry hub — organic search entry point (BSR-584).",
  "/industries/[slug]": "Individual industry pages — organic search entry points.",
  "/legal": "Legal index; must be readable before signing up (BSR-522).",
  "/legal/terms": "Terms of Service — required reading before purchase, and by Stripe review.",
  "/legal/privacy": "Privacy Policy — same.",
  "/legal/subprocessors": "Subprocessor disclosure — same.",
};

/** Pages that are part of getting an account, so they must work signed out. */
const AUTH_FLOW_PAGE_MANIFEST: Record<string, string> = {
  "/login": "Sign-in screen — the destination the auth gate redirects to.",
  "/sign-up": "Sign-up screen; the route itself refuses when self-serve is closed.",
  "/forgot-password": "Password reset request.",
  "/reset-password": "Password reset completion, reached from an emailed link.",
  "/accept-invite/[code]": "Invite acceptance — works signed out and signed in without a workspace.",
  "/welcome": "Post-signup welcome shown before a workspace exists.",
  "/onboarding": "Workspace creation for a signed-in user who has none yet.",
  "/settings/team": "Legacy redirect stub to /settings; renders nothing of its own.",
};

/**
 * API routes with no detectable guard, each with why that is correct.
 *
 * Anything not listed here MUST carry a guard. A new unguarded route fails.
 */
const PUBLIC_API_MANIFEST: Record<string, string> = {
  "/api/auth/sign-in": "Authenticates — cannot require authentication.",
  "/api/auth/sign-in/google": "Starts the Google OAuth handshake for someone with no session yet.",
  "/api/auth/sign-in/passkey": "Passkey authentication — this IS the authentication step.",
  "/api/auth/sign-up": "Creates accounts; self-serve gate is enforced inside the handler.",
  "/api/auth/sign-out": "Clears the session cookie; requiring a valid session to sign out would strand anyone whose session broke.",
  "/api/auth/status": "Reports whether a session exists; answering that question is its entire purpose.",
  "/api/auth/forgot-password": "Password reset request for someone who cannot sign in.",
  "/api/auth/reset-password": "Password reset completion via emailed token.",
  "/api/auth/resend-confirmation": "Re-sends a confirmation email to an account that cannot yet sign in.",
  "/api/waitlist": "Public landing-page conversion endpoint.",
  "/api/unsubscribe": "One-click unsubscribe. Legally required to work without an account.",
  "/api/v1/journey/collect": "Public visitor-tracking beacon for a tenant's own site.",
  "/api/v1/journey/opt-out": "Visitor opt-out; must work for someone with no account.",
  "/api/v1/journey/snippet.js": "Serves the public tracking snippet.",
};

describe("route exposure census", () => {
  it("derives the token guards instead of hardcoding them", () => {
    // Hardcoding this list undercounted three times while writing the suite —
    // arcGuard, then checkAgentBearer, then checkWorkspaceBearer — each miss
    // reporting a correctly-guarded route as unguarded. Deriving from the
    // defining modules means a fifth helper is picked up automatically.
    const guards = knownTokenGuards();
    for (const required of ["arcGuard", "checkAgentBearer", "checkBearerToken", "checkWorkspaceBearer"]) {
      expect(guards, `${required} should be discovered`).toContain(required);
    }
  });

  it("finds a plausible number of routes (the walker actually walked)", () => {
    // Guards against the census silently returning [] and every other assertion
    // in this file passing vacuously.
    expect(censusPageRoutes().length).toBeGreaterThan(20);
    expect(censusApiRoutes().length).toBeGreaterThan(50);
  });

  it("classifies every page outside the (app) auth boundary", () => {
    const unclassified = censusPageRoutes()
      .filter((p) => !p.inAppGroup)
      .filter((p) => !(p.routePath in PUBLIC_PAGE_MANIFEST) && !(p.routePath in AUTH_FLOW_PAGE_MANIFEST))
      .map((p) => `${p.routePath}  (${p.file})`);

    expect(
      unclassified,
      "New page(s) outside the (app) route group are unclassified. Add each to PUBLIC_PAGE_MANIFEST " +
        "or AUTH_FLOW_PAGE_MANIFEST with a reason, and register genuinely public ones in " +
        "PUBLIC_MARKETING_PATHS. Pages outside (app) do not get the layout's auth boundary.",
    ).toEqual([]);
  });

  it("every page claimed public is actually public in supabase mode", () => {
    // The manifest states intent; isPublicPath is what the proxy enforces. If
    // they disagree, the page 302s to /login and the intent is a lie.
    for (const routePath of Object.keys(PUBLIC_PAGE_MANIFEST)) {
      // `/` and `/landing` are handled by the root's own signed-out branch
      // rather than the marketing-path allowlist.
      if (routePath === "/" || routePath === "/landing") continue;
      const concrete = routePath.replace("[slug]", "example");
      expect(isPublicPath(concrete, "supabase"), `${routePath} should be public`).toBe(true);
    }
  });

  it("no page inside the (app) group is publicly reachable", () => {
    const leaked = censusPageRoutes()
      .filter((p) => p.inAppGroup)
      .filter((p) => {
        const concrete = p.routePath.replace(/\[[^\]]+\]/g, "example");
        return isPublicPath(concrete, "supabase");
      })
      .map((p) => p.routePath);

    expect(leaked, "App-group pages must never be public").toEqual([]);
  });

  it("every API route is guarded or explicitly declared public", () => {
    const unguarded = censusApiRoutes()
      .filter((a) => a.guards.length === 0)
      .filter((a) => !(a.routePath in PUBLIC_API_MANIFEST))
      .map((a) => `${a.routePath}  (${a.file})`);

    expect(
      unguarded,
      "API route(s) have no detectable auth guard and are not declared public. Add a guard, or add " +
        "the route to PUBLIC_API_MANIFEST with the reason it must work without authentication. " +
        "An unauthenticated API route is worse than an exposed page.",
    ).toEqual([]);
  });

  it("has no stale manifest entries", () => {
    // A manifest that outlives its route is how a future reader concludes a
    // deleted exposure is still fine.
    const pagePaths = new Set(censusPageRoutes().map((p) => p.routePath));
    const apiPaths = new Set(censusApiRoutes().map((a) => a.routePath));

    const stalePages = [...Object.keys(PUBLIC_PAGE_MANIFEST), ...Object.keys(AUTH_FLOW_PAGE_MANIFEST)].filter(
      (p) => !pagePaths.has(p),
    );
    const staleApis = Object.keys(PUBLIC_API_MANIFEST).filter((p) => !apiPaths.has(p));

    expect(stalePages, "Manifest lists page routes that no longer exist").toEqual([]);
    expect(staleApis, "Manifest lists API routes that no longer exist").toEqual([]);
  });

  it("every manifest entry carries a real reason", () => {
    for (const [route, reason] of [
      ...Object.entries(PUBLIC_PAGE_MANIFEST),
      ...Object.entries(AUTH_FLOW_PAGE_MANIFEST),
      ...Object.entries(PUBLIC_API_MANIFEST),
    ]) {
      expect(reason.length, `${route} needs a reason, not a placeholder`).toBeGreaterThan(15);
    }
  });
});

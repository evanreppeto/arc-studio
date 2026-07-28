import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getAuthMode, getSupabaseAnonKey, getSupabaseAuthUrl } from "@/lib/auth/auth-mode";
import {
  OPERATOR_COOKIE,
  getSafeOperatorReturnPath,
  isValidOperatorValue,
} from "@/lib/auth/operator-shared";
import { getWorkspaceAccessDecision, isPublicPath } from "@/lib/auth/route-protection";
import { type Database } from "@/lib/supabase/database.types";

async function getSupabaseProxySession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(getSupabaseAuthUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  return {
    response,
    supabase,
    user: error ? null : data.user,
  };
}

async function hasActiveWorkspaceMembership(supabase: Awaited<ReturnType<typeof createServerClient<Database>>>, userId: string) {
  const { data, error } = await supabase
    .from("workspace_memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error) return false;
  return Boolean(data);
}

function redirectToLogin(request: NextRequest) {
  const url = new URL("/login", request.url);
  url.searchParams.set("from", getSafeOperatorReturnPath(`${request.nextUrl.pathname}${request.nextUrl.search}`));
  return NextResponse.redirect(url);
}

function redirectToOnboarding(request: NextRequest) {
  const url = new URL("/onboarding", request.url);
  url.searchParams.set("from", getSafeOperatorReturnPath(`${request.nextUrl.pathname}${request.nextUrl.search}`));
  return NextResponse.redirect(url);
}

// A signed-in member landed on the root → send them into the app (/home).
function redirectToApp(request: NextRequest) {
  return NextResponse.redirect(new URL("/home", request.url));
}

export async function proxy(request: NextRequest) {
  const authMode = getAuthMode();

  // Static assets are always public (so the login screen can load its styles and
  // scripts); in open/operator mode the root landing is public too. In supabase
  // mode everything else falls through to the gate below.
  if (isPublicPath(request.nextUrl.pathname, authMode)) {
    return NextResponse.next();
  }

  // Gate disabled (no token configured): let everything through.
  if (authMode === "open") {
    return NextResponse.next();
  }

  if (authMode === "supabase") {
    const { response, supabase, user } = await getSupabaseProxySession(request);
    const hasWorkspace = user ? await hasActiveWorkspaceMembership(supabase, user.id) : false;
    const decision = getWorkspaceAccessDecision({
      hasWorkspace,
      isSignedIn: Boolean(user),
      pathname: request.nextUrl.pathname,
    });

    if (decision.action === "allow") return response;
    if (decision.action === "app") return redirectToApp(request);
    if (decision.action === "onboarding") return redirectToOnboarding(request);
    return redirectToLogin(request);
  }

  if (isValidOperatorValue(request.cookies.get(OPERATOR_COOKIE)?.value)) {
    return NextResponse.next();
  }

  return redirectToLogin(request);
}

export const config = {
  // Protect page routes only. Skip API routes (own bearer auth), Next internals,
  // auth pages themselves, static/brand assets, and Sentry's ingest tunnel.
  //
  // `monitoring` is the tunnelRoute configured in next.config.ts — the endpoint the
  // browser SDK POSTs error reports to. It is not a page, and gating it broke error
  // reporting silently: the proxy answered each report with a 302 to /login, the SDK
  // saw the login page's 200 and considered the event delivered, and nothing ever
  // reached Sentry. It must stay open to signed-out visitors in particular — /login
  // is exactly where a browser error most needs reporting and nobody has a session
  // yet. The route forwards only to the configured Sentry DSN, so it exposes nothing.
  //
  // ⚠️ Asset-directory entries MUST stay scoped to the directory. `public/brand/`
  // and `public/effects/` hold images, but matcher entries are path PREFIXES, so
  // a bare `brand` would also exempt the `/brand` page — which then never reaches
  // the gate below, and an unprotected page renders exactly like a protected one.
  // `brand/.` excludes only real files inside the asset directory — the trailing
  // `.` requires at least one character after the slash, so the bare `/brand/`
  // stays gated too rather than relying on Next's trailing-slash redirect to
  // hand it back to the gate. Any new exclusion for a public/ directory needs
  // the same shape, and must not share a name with a page route.
  // (`isPublicPath` lets asset EXTENSIONS through anyway, so these entries are
  // belt-and-braces; a page never has one.)
  matcher: ["/((?!api|monitoring|auth/callback|_next/static|_next/image|landing|login|sign-in|sign-up|forgot-password|reset-password|favicon.ico|icon.png|brand/.|effects/.).*)"],
};

import { NextResponse } from "next/server";

import { checkAgentBearer } from "@/lib/auth/api-token";
import { getCurrentWorkspaceContext, resolveWorkspaceScopeById } from "@/lib/auth/workspace";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

/**
 * Shared guards + response helpers for the Arc Operations API
 * (/api/v1/arc/*). Folder is underscore-prefixed so Next.js treats it as a
 * private module, not a route. House response style: { ok, status, ... } and
 * { ok:false, status, message }. Secrets are never echoed back.
 */

/**
 * The body for a refused bearer check.
 *
 * `unavailable` is deliberately NOT phrased as an auth failure: the caller's
 * token may be perfectly valid and we simply could not verify it. Telling a
 * healthy runner its credential is bad is what made a transient blip look like a
 * permanent outage.
 */
function bearerRefusal(auth: Extract<Awaited<ReturnType<typeof checkAgentBearer>>, { ok: false }>) {
  if (auth.reason === "not_configured") {
    return { ok: false, status: "not_configured", message: "Set ARC_AGENT_API_TOKEN before using the Arc Operations API." };
  }
  if (auth.reason === "unavailable") {
    return {
      ok: false,
      status: "unavailable",
      message: "Could not verify the bearer token right now — the token store was unreachable. Retry shortly.",
    };
  }
  return { ok: false, status: "unauthorized", message: "The Arc Operations API requires a valid bearer token." };
}

/** Bearer-token gate. Returns an error response, or null when authorized. */
export async function bearerGuard(request: Request): Promise<NextResponse | null> {
  const auth = await checkAgentBearer(request);
  if (auth.ok) return null;
  return NextResponse.json(bearerRefusal(auth), { status: auth.status });
}

/** Supabase-configured gate. Returns a 503 response, or null when configured. */
export function supabaseGuard(): NextResponse | null {
  if (isSupabaseAdminConfigured()) return null;
  return NextResponse.json(
    {
      ok: false,
      status: "not_configured",
      message: "Supabase admin env vars are required for the Arc Operations API.",
    },
    { status: 503 },
  );
}

export type ArcWorkspaceScope = {
  orgId: string;
  workspaceId: string;
  source: "agent-token" | "env-workspace-asserted" | "legacy-env-token";
};

/** Header the trusted runner sets to declare which workspace a callback acts for. */
export const ARC_WORKSPACE_HEADER = "x-arc-workspace-id";
export const ARC_ORG_HEADER = "x-arc-org-id";

export type ArcGuardResult =
  | { ok: true; scope: ArcWorkspaceScope }
  | { ok: false; response: NextResponse };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function resolveWorkspaceIdForToken(orgId: string, workspaceIdOrKey: string): Promise<string | null> {
  if (UUID_RE.test(workspaceIdOrKey)) {
    return workspaceIdOrKey;
  }

  const { data, error } = await getSupabaseAdminClient()
    .from("workspaces")
    .select("id")
    .eq("org_id", orgId)
    .eq("key", workspaceIdOrKey)
    .maybeSingle<{ id: string }>();

  if (error || !data?.id) {
    return null;
  }

  return data.id;
}

/**
 * Bearer + Supabase guard that also resolves the workspace boundary for this
 * Arc API request. DB-issued tokens are scoped directly; the legacy env token
 * keeps the previous current-workspace fallback for local/dev compatibility.
 */
export async function arcGuard(request: Request): Promise<ArcGuardResult> {
  const auth = await checkAgentBearer(request);
  if (!auth.ok) {
    return { ok: false, response: NextResponse.json(bearerRefusal(auth), { status: auth.status }) };
  }

  const supabaseDenied = supabaseGuard();
  if (supabaseDenied) {
    return { ok: false, response: supabaseDenied };
  }

  // Read once — both branches below need it, and the database branch used to
  // ignore it entirely (see the mismatch check).
  const assertedWorkspace = request.headers.get(ARC_WORKSPACE_HEADER)?.trim();

  if (auth.tokenSource === "database") {
    if (!auth.orgId || !auth.workspaceId) {
      return {
        ok: false,
        response: fail("workspace_required", "The Arc token is not tied to an active workspace.", 409),
      };
    }

    const workspaceId = await resolveWorkspaceIdForToken(auth.orgId, auth.workspaceId);
    if (!workspaceId) {
      return {
        ok: false,
        response: fail("workspace_required", "The Arc token is not tied to an active workspace.", 409),
      };
    }

    // A scoped token pins this request to ITS workspace, which is the point. But
    // the runner also states which workspace each wake is for, and this branch
    // used to discard that: a shared runner holding one workspace's token would
    // accept work destined for another and file it here — no error, wrong tenant.
    // Disagreement means one of the two is wrong, and guessing which is exactly
    // the failure mode scoped tokens exist to remove. Refuse instead.
    if (assertedWorkspace && assertedWorkspace !== workspaceId) {
      return {
        ok: false,
        response: fail(
          "workspace_mismatch",
          "This Arc token is scoped to a different workspace than the one asserted on the request.",
          409,
        ),
      };
    }
    return { ok: true, scope: { orgId: auth.orgId, workspaceId, source: "agent-token" } };
  }

  // Trusted first-party runner path. The shared env token proves "this is our
  // runner"; a shared runner serving many tenants asserts which workspace it is
  // acting for via the ARC_WORKSPACE_HEADER (echoed from the wake payload). We
  // validate that workspace against the DB and derive the authoritative org, so a
  // spoofed ARC_ORG_HEADER can't widen scope. Absent the header, keep the historic
  // default-workspace resolution for single-runner / local back-compat.
  if (assertedWorkspace) {
    const resolved = await resolveWorkspaceScopeById(assertedWorkspace);
    if (!resolved) {
      return {
        ok: false,
        response: fail("workspace_required", "The asserted Arc workspace was not found or is inactive.", 409),
      };
    }
    const assertedOrgId = request.headers.get(ARC_ORG_HEADER)?.trim();
    if (assertedOrgId && assertedOrgId !== resolved.orgId) {
      return {
        ok: false,
        response: fail("workspace_mismatch", "The asserted org does not match the workspace.", 409),
      };
    }
    return {
      ok: true,
      scope: { orgId: resolved.orgId, workspaceId: resolved.workspaceId, source: "env-workspace-asserted" },
    };
  }

  try {
    const context = await getCurrentWorkspaceContext();
    if (!context.workspaceId) {
      return {
        ok: false,
        response: fail("workspace_required", "No active workspace is available for this Arc request.", 409),
      };
    }
    return {
      ok: true,
      scope: { orgId: context.orgId, workspaceId: context.workspaceId, source: "legacy-env-token" },
    };
  } catch (error) {
    return {
      ok: false,
      response: fail("workspace_required", error instanceof Error ? error.message : "No workspace is available.", 409),
    };
  }
}

/** Bearer + Supabase guard in one call (the common case). */
export async function guard(request: Request): Promise<NextResponse | null> {
  return (await bearerGuard(request)) ?? supabaseGuard();
}

export function ok(payload: Record<string, unknown>, httpStatus = 200): NextResponse {
  return NextResponse.json({ ok: true, status: "ok", ...payload }, { status: httpStatus });
}

export function fail(status: string, message: string, httpStatus: number): NextResponse {
  return NextResponse.json({ ok: false, status, message }, { status: httpStatus });
}

/** Parse a JSON body, returning the sentinel `INVALID_JSON` on malformed input. */
export const INVALID_JSON = Symbol("invalid-json");

export async function readJson(request: Request): Promise<unknown | typeof INVALID_JSON> {
  try {
    return await request.json();
  } catch {
    return INVALID_JSON;
  }
}

/**
 * Shared bearer-token auth for the v1 API surface.
 *
 * The agent endpoints (e.g. Arc runs) are `required: true` — they refuse with
 * 503 until a token is configured, then 401 on mismatch. The lead-intake endpoint
 * is `required: false` so it stays open in dev / when no token is set, but is
 * enforced the moment a token IS configured (so configured deployments are closed).
 */

import { TOKEN_SCOPE_ARC_FULL, hasActiveAgentTokens, tokenAllows, verifyAgentToken, type VerifyAgentTokenResult } from "@/lib/agent/tokens";
import { recordAgentSeen } from "@/lib/agent/health";
import { deferAfterResponse } from "@/lib/defer";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

export type BearerTokenResult =
  | { ok: true; orgId?: string; workspaceId?: string; tokenSource: "env" | "database" }
  | { ok: false; status: 401 | 503; reason: "unauthorized" | "not_configured" };

type HeaderCarrier = { headers: { get(name: string): string | null } };

export function checkBearerToken(
  request: HeaderCarrier,
  envVarName: string,
  options: { required?: boolean } = {},
): BearerTokenResult {
  const required = options.required ?? true;
  const configured = process.env[envVarName];

  if (!configured) {
    // No token set: agent endpoints refuse; the public-ish intake endpoint allows.
    return required ? { ok: false, status: 503, reason: "not_configured" } : { ok: true, tokenSource: "env" };
  }

  const authorization = request.headers.get("authorization");

  if (authorization !== `Bearer ${configured}`) {
    return { ok: false, status: 401, reason: "unauthorized" };
  }

  return { ok: true, tokenSource: "env" };
}

/**
 * Workspace-aware bearer gate for tenant-facing v1 endpoints (lead ingest).
 *
 * The difference from `checkBearerToken` matters: the env token proves "you're
 * allowed" but says nothing about WHO you are, so a route using it has to guess
 * the org — which in practice meant `getCurrentOrgId()` and a single-tenant
 * endpoint. A per-workspace DB token carries its own org, so the caller's
 * workspace is a fact rather than a guess. That's what lets any tenant's site
 * post leads into their own workspace.
 *
 * Order: env token first (back-compat, dev/single-tenant — resolves no org), then
 * hashed per-workspace tokens, which must carry `scope`.
 */
export async function checkWorkspaceBearer(
  request: HeaderCarrier,
  envVarName: string,
  options: { required?: boolean; scope: string; verify?: (plaintext: string) => Promise<VerifyAgentTokenResult> } = {
    scope: "",
  },
): Promise<BearerTokenResult> {
  const required = options.required ?? true;
  const envToken = process.env[envVarName];
  const token = bearerValue(request);
  const verify = options.verify ?? verifyConfiguredAgentToken;

  if (token && envToken && token === envToken) {
    // Legacy shared token: authorised, but anonymous — the caller's org is
    // unknown, so the route falls back to the session/default workspace.
    return { ok: true, tokenSource: "env" };
  }

  if (token) {
    const verified = await verify(token);
    if (verified.ok) {
      if (!tokenAllows(verified.scopes, options.scope)) {
        return { ok: false, status: 401, reason: "unauthorized" };
      }
      return { ok: true, tokenSource: "database", orgId: verified.orgId, workspaceId: verified.workspaceId };
    }
    return { ok: false, status: 401, reason: "unauthorized" };
  }

  // No credential presented. Endpoints that aren't `required` (lead intake in
  // dev, before any token is configured) stay open; otherwise refuse.
  if (!envToken && !required) return { ok: true, tokenSource: "env" };
  return required ? { ok: false, status: envToken ? 401 : 503, reason: envToken ? "unauthorized" : "not_configured" } : { ok: true, tokenSource: "env" };
}

type AgentBearerDeps = {
  verify?: (plaintext: string) => Promise<VerifyAgentTokenResult>;
  anyConfigured?: () => Promise<boolean>;
  recordSeen?: () => Promise<void>;
};

function bearerValue(request: HeaderCarrier): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length);
}

async function anyAgentTokenConfigured(): Promise<boolean> {
  if (process.env.ARC_AGENT_API_TOKEN) return true;
  if (!isSupabaseAdminConfigured()) return false;
  try {
    return await hasActiveAgentTokens(getSupabaseAdminClient());
  } catch {
    return false;
  }
}

async function verifyConfiguredAgentToken(plaintext: string): Promise<VerifyAgentTokenResult> {
  if (!isSupabaseAdminConfigured()) return { ok: false };
  try {
    return await verifyAgentToken(plaintext, getSupabaseAdminClient());
  } catch {
    return { ok: false };
  }
}

/**
 * Agent bearer gate for /api/v1/arc. Back-compat env token wins, then
 * app-issued hashed DB tokens are accepted when configured.
 */
export async function checkAgentBearer(request: HeaderCarrier, deps: AgentBearerDeps = {}): Promise<BearerTokenResult> {
  const token = bearerValue(request);
  const envToken = process.env.ARC_AGENT_API_TOKEN;
  const verify = deps.verify ?? verifyConfiguredAgentToken;
  const anyConfigured = deps.anyConfigured ?? anyAgentTokenConfigured;
  const recordSeen = deps.recordSeen ?? recordAgentSeen;

  if (token && envToken && token === envToken) {
    // Telemetry only (last_seen_at) — nothing in the request depends on it, and
    // the runner polls the inbox on every interval, so defer it out of the hot
    // auth path instead of blocking the bearer check on a workspace-context read
    // + connection UPDATE.
    deferAfterResponse(recordSeen);
    return { ok: true, tokenSource: "env" };
  }

  if (token) {
    const verified = await verify(token);
    if (verified.ok) {
      // The Arc Operations API is the whole agent surface, so it takes arc:full —
      // scope was being verified on the ingest routes and nowhere else, which made
      // a narrow token narrow in exactly one direction: a leads:ingest credential
      // handed to a website form or a partner was accepted on every /api/v1/arc
      // route for that workspace. tokenAllows treats NULL scopes as legacy and
      // unrestricted, so pre-scope tokens (and the runner's arc:full) are unchanged.
      if (!tokenAllows(verified.scopes, TOKEN_SCOPE_ARC_FULL)) {
        return { ok: false, status: 401, reason: "unauthorized" };
      }
      deferAfterResponse(recordSeen);
      return { ok: true, tokenSource: "database", orgId: verified.orgId, workspaceId: verified.workspaceId };
    }
  }

  if (!(await anyConfigured())) {
    return { ok: false, status: 503, reason: "not_configured" };
  }

  return { ok: false, status: 401, reason: "unauthorized" };
}

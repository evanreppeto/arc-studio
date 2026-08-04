import { requireCount } from "@/lib/supabase/count";
import { createHash, randomBytes } from "node:crypto";

import { type SupabaseClient } from "@supabase/supabase-js";

import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { DEFAULT_WORKSPACE_ID } from "./connection";

/**
 * Token scopes. A token's `scopes` column is NULL for every token issued before
 * scoping existed — those are legacy tokens and stay unrestricted, so nothing
 * that works today breaks. New narrow tokens name exactly what they may do.
 */
export const TOKEN_SCOPE_ARC_FULL = "arc:full";
export const TOKEN_SCOPE_LEADS_INGEST = "leads:ingest";
export const TOKEN_SCOPE_CAMPAIGN_RESULTS_INGEST = "campaign-results:ingest";
export const TOKEN_SCOPE_MEDIA_INGEST = "media:ingest";

/**
 * Pure: may a token with these scopes perform `required`?
 *
 * NULL/empty scopes = legacy, unrestricted (back-compat). Otherwise the scope
 * must be listed explicitly — `arc:full` is a superset that also implies the
 * narrower scopes, so an existing Arc runner token keeps ingesting leads.
 */
export function tokenAllows(scopes: string[] | null | undefined, required: string): boolean {
  if (!scopes || scopes.length === 0) return true;
  if (scopes.includes(required)) return true;
  return scopes.includes(TOKEN_SCOPE_ARC_FULL);
}

export type AgentTokenSummary = {
  id: string;
  prefix: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** null = legacy token (unrestricted). */
  scopes: string[] | null;
};

type AgentTokenRow = {
  id: string;
  org_id?: string;
  prefix: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  scopes?: string[] | null;
};

/**
 * `not_found` means the token is genuinely not ours — no row, or revoked.
 * `unavailable` means we could not find out, because the lookup itself failed.
 *
 * They were one value, and the caller turned both into 401. A DB-issued token is
 * verified on EVERY request, so one transient Supabase error told the runner its
 * credential was invalid — which is fatal-looking, and orphaned the task it was
 * trying to complete. "I can't check right now" has to be retryable.
 */
export type VerifyAgentTokenResult =
  | { ok: true; workspaceId: string; orgId?: string; scopes: string[] | null }
  | { ok: false; reason: "not_found" | "unavailable" };

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function generateToken(): { plaintext: string; prefix: string; hash: string } {
  const plaintext = `sk_live_${randomBytes(24).toString("base64url")}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, 12),
    hash: hashToken(plaintext),
  };
}

function toSummary(row: AgentTokenRow): AgentTokenSummary {
  return {
    id: row.id,
    prefix: row.prefix,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    scopes: row.scopes ?? null,
  };
}

async function getTokenScope(client?: SupabaseClient): Promise<{ orgId: string | null; workspaceId: string }> {
  const context = await getCurrentWorkspaceContext().catch(() => null);
  return {
    orgId: context?.orgId ?? null,
    workspaceId: context?.workspaceId ?? context?.workspaceKey ?? DEFAULT_WORKSPACE_ID,
  };
}

const TOKEN_COLUMNS = "id,prefix,label,created_at,last_used_at,revoked_at,scopes";
const TOKEN_COLUMNS_LEGACY = "id,prefix,label,created_at,last_used_at,revoked_at";

/**
 * Issue a workspace API token. `scopes` omitted = a legacy unrestricted token
 * (what the Arc runner has always had); pass e.g. [TOKEN_SCOPE_LEADS_INGEST] to
 * mint a narrow one that can do nothing else.
 */
export async function issueAgentToken(
  label: string,
  client?: SupabaseClient,
  scopes?: string[],
): Promise<{ plaintext: string; summary: AgentTokenSummary }> {
  const db = client ?? getSupabaseAdminClient();
  const token = generateToken();
  const scope = await getTokenScope(client);
  const payload = {
    ...(scope.orgId ? { org_id: scope.orgId } : {}),
    ...(scopes && scopes.length > 0 ? { scopes } : {}),
    workspace_id: scope.workspaceId,
    token_hash: token.hash,
    prefix: token.prefix,
    label: label.trim() || null,
  };
  let result = await db.from("agent_api_tokens").insert(payload).select(TOKEN_COLUMNS).single<AgentTokenRow>();

  if (result.error && scope.orgId) {
    // Pre-scopes database: `scopes` is the column that doesn't exist yet, so that's
    // the only thing the retry drops (TOKEN_COLUMNS_LEGACY mirrors it). org_id has
    // been NOT NULL here since the baseline and must still ride along — dropping it
    // would file the token under whatever the column default says.
    const legacyPayload = {
      org_id: scope.orgId,
      workspace_id: payload.workspace_id,
      token_hash: payload.token_hash,
      prefix: payload.prefix,
      label: payload.label,
    };
    result = await db.from("agent_api_tokens").insert(legacyPayload).select(TOKEN_COLUMNS_LEGACY).single<AgentTokenRow>();
  }

  if (result.error || !result.data) throw new Error(`agent_api_tokens insert: ${result.error?.message ?? "no row"}`);
  return { plaintext: token.plaintext, summary: toSummary(result.data) };
}

export async function listAgentTokens(client?: SupabaseClient): Promise<AgentTokenSummary[]> {
  const db = client ?? getSupabaseAdminClient();
  const scope = await getTokenScope(client);
  let query = db.from("agent_api_tokens").select(TOKEN_COLUMNS).eq("workspace_id", scope.workspaceId);

  if (scope.orgId) query = query.eq("org_id", scope.orgId);

  let { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    const legacyResult = await db
      .from("agent_api_tokens")
      .select(TOKEN_COLUMNS_LEGACY)
      .eq("workspace_id", scope.workspaceId)
      .order("created_at", { ascending: false });
    // Pre-scopes rows simply lack the column; toSummary maps the absence to null.
    data = legacyResult.data as typeof data;
    error = legacyResult.error;
  }

  if (error) throw new Error(`agent_api_tokens list: ${error.message}`);
  return ((data ?? []) as AgentTokenRow[]).map(toSummary);
}

export async function hasActiveAgentTokens(client?: SupabaseClient): Promise<boolean> {
  const db = client ?? getSupabaseAdminClient();
  const scope = await getTokenScope(client);
  let query = db
    .from("agent_api_tokens")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", scope.workspaceId)
    .is("revoked_at", null);

  if (scope.orgId) query = query.eq("org_id", scope.orgId);

  let { count, error } = await query;

  if (error && scope.orgId) {
    const legacyResult = await db
      .from("agent_api_tokens")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", scope.workspaceId)
      .is("revoked_at", null);
    count = legacyResult.count;
    error = legacyResult.error;
  }

  if (error) return false;
  // Fail closed: a null count read as 0 claims no token exists (BSR-575).
  return requireCount("agent_tokens", { count, error }) > 0;
}

export async function verifyAgentToken(
  plaintext: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<VerifyAgentTokenResult> {
  const tokenHash = hashToken(plaintext);
  type VerifyRow = { org_id?: string; workspace_id: string; scopes?: string[] | null };
  let { data, error } = await client
    .from("agent_api_tokens")
    .select("org_id,workspace_id,scopes")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle<VerifyRow>();

  // Pre-scopes database (migration not applied yet): fall back to the old shape
  // and treat the token as legacy/unrestricted rather than failing auth.
  if (error) {
    const legacy = await client
      .from("agent_api_tokens")
      .select("org_id,workspace_id")
      .eq("token_hash", tokenHash)
      .is("revoked_at", null)
      .maybeSingle<VerifyRow>();
    data = legacy.data;
    error = legacy.error;
  }

  // Order matters: an error means the question went unanswered, which is not the
  // same answer as "no such token".
  if (error) return { ok: false, reason: "unavailable" };
  if (!data) return { ok: false, reason: "not_found" };

  await client
    .from("agent_api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("token_hash", tokenHash);

  const scopes = data.scopes ?? null;
  return data.org_id
    ? { ok: true, workspaceId: data.workspace_id, orgId: data.org_id, scopes }
    : { ok: true, workspaceId: data.workspace_id, scopes };
}

export async function revokeAgentToken(id: string, client: SupabaseClient = getSupabaseAdminClient()): Promise<void> {
  const { error } = await client.from("agent_api_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`agent_api_tokens revoke: ${error.message}`);
}

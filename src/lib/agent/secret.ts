import { type SupabaseClient } from "@supabase/supabase-js";

import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { createVaultSecret, readVaultSecret } from "@/lib/supabase/vault-secrets";
import { DEFAULT_WORKSPACE_ID } from "./connection";

// Vault access goes through `@/lib/supabase/vault-secrets`. This module carried
// the same broken pair as connectors/credentials.ts — unqualified
// `create_secret` (absent from `public`), then a `vault`-schema retry (a schema
// PostgREST does not expose) — with both errors swallowed. BSR-733.

export async function resolveWebhookSecret(ref: string | null, client?: SupabaseClient): Promise<string | null> {
  const envSecret = process.env.ARC_WEBHOOK_SECRET;
  if (envSecret) return envSecret;
  if (!ref) return null;

  const supabase: SupabaseClient | null = client ?? (isSupabaseAdminConfigured() ? getSupabaseAdminClient() : null);
  if (!supabase) return null;

  return readVaultSecret(supabase, ref);
}

export async function writeWebhookSecret(plaintext: string, client?: SupabaseClient): Promise<string> {
  const db = client ?? getSupabaseAdminClient();
  const context = client ? null : await getCurrentWorkspaceContext().catch(() => null);
  const workspaceId = context?.workspaceKey ?? DEFAULT_WORKSPACE_ID;

  const ref = await createVaultSecret(db, {
    name: `agent_webhook_secret_${workspaceId}`,
    plaintext,
    description: "Agent outbound webhook HMAC signing secret",
  });

  let query = db
    .from("agent_connections")
    .update({ webhook_secret_ref: ref })
    .eq("workspace_id", workspaceId);

  if (context?.orgId) query = query.eq("org_id", context.orgId);

  let { error } = await query;

  if (error && context?.orgId) {
    const legacyResult = await db
      .from("agent_connections")
      .update({ webhook_secret_ref: ref })
      .eq("workspace_id", workspaceId);
    error = legacyResult.error;
  }

  if (error) throw new Error(`agent_connections secret ref: ${error.message}`);
  return ref;
}

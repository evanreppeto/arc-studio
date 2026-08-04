import { type SupabaseClient } from "@supabase/supabase-js";

import { type ConnectorRegistryEntry } from "@/domain";
import { createVaultSecret, readVaultSecret, updateVaultSecret } from "@/lib/supabase/vault-secrets";

// Vault-backed connector credentials. Stores/returns only refs + plaintext on
// demand — the row never holds the secret.
//
// All three operations go through `@/lib/supabase/vault-secrets`, which reaches
// the Vault via the `public.arc_*` SECURITY DEFINER wrappers. This module used to
// call an unqualified `create_secret` (no such function in `public`) and then
// retry through `client.schema("vault")` (a schema PostgREST does not expose),
// swallowing both errors — so every connector connect ended in `store_failed`
// and no secret was ever written. See the header of that module. BSR-733.

export async function writeConnectorCredential(
  client: SupabaseClient,
  input: { workspaceId: string; connectorKey: string; plaintext: string },
): Promise<string> {
  return createVaultSecret(client, {
    name: `connector_${input.connectorKey}_${input.workspaceId}`,
    plaintext: input.plaintext,
    description: `Workspace connector credential: ${input.connectorKey}`,
  });
}

/** Update an existing Vault credential in place. Best-effort: returns false on
 *  any failure, so a refreshed token can still serve the current request. */
export async function updateConnectorCredential(
  client: SupabaseClient,
  ref: string | null,
  plaintext: string,
): Promise<boolean> {
  return updateVaultSecret(client, ref, plaintext);
}

export async function readConnectorCredential(client: SupabaseClient, ref: string | null): Promise<string | null> {
  return readVaultSecret(client, ref);
}

/** The platform's key for this connector, when the entry declares one AND the
 *  deployment sets it (platform-credits mode). Server-only by construction. */
export function platformCredentialFor(entry: Pick<ConnectorRegistryEntry, "platformEnvVar">): string | null {
  if (!entry.platformEnvVar) return null;
  const value = process.env[entry.platformEnvVar]?.trim();
  return value || null;
}

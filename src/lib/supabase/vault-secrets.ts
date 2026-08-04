import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase Vault access, through the `public.arc_*` SECURITY DEFINER wrappers.
 *
 * WHY THIS MODULE EXISTS — read before "simplifying" it back to a direct call.
 *
 * PostgREST only serves the schemas it is configured to expose, and `vault` is
 * not one of them on a stock Supabase project. So `client.schema("vault")` —
 * whether `.rpc("create_secret")` or `.from("decrypted_secrets")` — cannot reach
 * the Vault. There is also no `public.create_secret` to fall back to: the only
 * secret functions in `public` are the `arc_*` wrappers below.
 *
 * Two modules (`connectors/credentials.ts`, `agent/secret.ts`) called exactly
 * that impossible pair — unqualified `create_secret`, then a `vault`-schema
 * retry — and swallowed both failures in bare `catch` blocks. The result was a
 * connector "Connect" that completed OAuth successfully and then died with an
 * opaque `store_failed`, on every attempt, for every connector. `vault.secrets`
 * held ZERO rows on prod: the write path had never once succeeded. BSR-733.
 *
 * `public.arc_create_vault_secret` / `arc_read_vault_secret` exist precisely to
 * bridge this gap — SECURITY DEFINER with `search_path = public, vault`, granted
 * to `service_role` only (`20260715120000_revoke_anon_definer_rpc_grants.sql`).
 * `arc_update_vault_secret` is the same shape, added alongside this module.
 *
 * The `vault`-schema attempt is kept as a SECOND step rather than the first, for
 * a deployment that does expose the schema. It must never be the only path.
 *
 * Errors are reported, not swallowed. A silent credential write is how this
 * stayed invisible; `createVaultSecret` throws with every attempt's reason
 * attached so the next failure names itself.
 */

/** `arc_create_vault_secret` returns a bare uuid; the raw `vault.create_secret`
 *  can come back shaped as a row. Accept both rather than guessing. */
type SecretCreateData = string | { id?: string | null; create_secret?: string | null } | null;

type RpcResult<T> = { data: T | null; error: { message: string } | null };

type VaultClient = SupabaseClient & {
  rpc(fn: "arc_create_vault_secret", args: { new_secret: string; new_name: string; new_description: string }): Promise<RpcResult<SecretCreateData>>;
  rpc(fn: "arc_read_vault_secret", args: { secret_id: string }): Promise<RpcResult<string>>;
  rpc(fn: "arc_update_vault_secret", args: { secret_id: string; new_secret: string }): Promise<RpcResult<boolean>>;
  schema(schema: "vault"): {
    rpc(fn: "create_secret", args: { new_secret: string; new_name: string; new_description: string }): Promise<RpcResult<SecretCreateData>>;
    rpc(fn: "update_secret", args: { secret_id: string; new_secret: string }): Promise<RpcResult<unknown>>;
    from(table: "decrypted_secrets"): SupabaseClient["from"] extends (t: string) => infer R ? R : never;
  };
};

function refFromData(data: SecretCreateData): string | null {
  if (!data) return null;
  if (typeof data === "string") return data;
  return data.id ?? data.create_secret ?? null;
}

function reason(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}

/**
 * Store a new secret and return its ref.
 *
 * Throws — with each attempt's failure reason — rather than returning null. The
 * caller is persisting a credential; a ref it cannot produce is not something to
 * paper over, and the reason is the only thing that makes the next failure
 * diagnosable from a log.
 */
export async function createVaultSecret(
  client: SupabaseClient,
  input: { name: string; plaintext: string; description: string },
): Promise<string> {
  const args = { new_secret: input.plaintext, new_name: input.name, new_description: input.description };
  const failures: string[] = [];

  try {
    const { data, error } = await (client as VaultClient).rpc("arc_create_vault_secret", args);
    if (!error) {
      const ref = refFromData(data);
      if (ref) return ref;
      failures.push("arc_create_vault_secret returned no id");
    } else {
      failures.push(`arc_create_vault_secret: ${error.message}`);
    }
  } catch (error) {
    failures.push(`arc_create_vault_secret threw: ${reason(error)}`);
  }

  if (typeof client.schema === "function") {
    try {
      const { data, error } = await (client as VaultClient).schema("vault").rpc("create_secret", args);
      if (!error) {
        const ref = refFromData(data);
        if (ref) return ref;
        failures.push("vault.create_secret returned no id");
      } else {
        failures.push(`vault.create_secret: ${error.message}`);
      }
    } catch (error) {
      failures.push(`vault.create_secret threw: ${reason(error)}`);
    }
  }

  throw new Error(`Could not store the secret in the Vault. ${failures.join("; ")}`);
}

/** Decrypt a secret by ref. Returns null when there is no ref or it cannot be
 *  read — an absent secret is a legitimate answer here, unlike a failed write. */
export async function readVaultSecret(client: SupabaseClient, ref: string | null): Promise<string | null> {
  if (!ref) return null;

  try {
    const { data, error } = await (client as VaultClient).rpc("arc_read_vault_secret", { secret_id: ref });
    if (!error && data) return data;
  } catch {
    // Fall through to the vault-schema attempt.
  }

  try {
    const scoped = typeof client.schema === "function" ? client.schema("vault") : client;
    const { data, error } = await (scoped as SupabaseClient)
      .from("decrypted_secrets")
      .select("decrypted_secret")
      .eq("id", ref)
      .maybeSingle<{ decrypted_secret: string | null }>();
    if (!error && data?.decrypted_secret) return data.decrypted_secret;
  } catch {
    return null;
  }

  return null;
}

/**
 * Replace a secret's value in place, keeping its ref.
 *
 * Best-effort by design: the OAuth refresh path can still use a freshly-minted
 * access token for the current request even if re-persisting it fails. Returns
 * false rather than throwing so a transient Vault problem degrades into "we will
 * refresh again next time" instead of failing the operator's request.
 */
export async function updateVaultSecret(client: SupabaseClient, ref: string | null, plaintext: string): Promise<boolean> {
  if (!ref) return false;
  const args = { secret_id: ref, new_secret: plaintext };

  try {
    const { error } = await (client as VaultClient).rpc("arc_update_vault_secret", args);
    if (!error) return true;
  } catch {
    // Fall through to the vault-schema attempt.
  }

  if (typeof client.schema === "function") {
    try {
      const { error } = await (client as VaultClient).schema("vault").rpc("update_secret", args);
      if (!error) return true;
    } catch {
      return false;
    }
  }

  return false;
}

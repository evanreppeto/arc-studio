-- `public.arc_update_vault_secret` — the missing third Vault wrapper.
--
-- The baseline ships `arc_create_vault_secret` and `arc_read_vault_secret` as
-- SECURITY DEFINER bridges into the `vault` schema, because PostgREST does not
-- expose `vault` on a stock Supabase project: `client.schema("vault").rpc(...)`
-- cannot reach it, and there is no `public.create_secret` to fall back to.
--
-- There was no update wrapper, so rotating a stored secret in place had no
-- reachable path at all. That matters for OAuth connectors specifically: the
-- refresh flow mints a new access token and re-persists the bundle on every use
-- (`ensureFreshAccessToken`). Without this, each refresh would have to mint a
-- NEW secret and re-point the connector's `credential_ref`, orphaning the old
-- row in `vault.secrets` on every single refresh.
--
-- Signature is deliberately (secret_id, new_secret) only. `vault.update_secret`
-- coalesces name and description (`name = coalesce(new_name, s.name)`), so
-- omitting them preserves both rather than nulling them — verified against the
-- function body on prod before writing this.
--
-- Grants follow 20260715120000: service_role ONLY. These functions have no
-- in-body authorization and decrypt/overwrite workspace credentials, so anon and
-- authenticated must never reach them. Postgres grants EXECUTE to PUBLIC by
-- default, so the REVOKE FROM PUBLIC is required, not decorative.

create or replace function public.arc_update_vault_secret(secret_id uuid, new_secret text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'vault'
as $function$
begin
  if secret_id is null or new_secret is null then
    return false;
  end if;

  -- Refuse silently-successful no-ops: if the ref does not exist, say so rather
  -- than returning true and letting a caller believe a credential was rotated.
  if not exists (select 1 from vault.secrets s where s.id = secret_id) then
    return false;
  end if;

  perform vault.update_secret(secret_id, new_secret);
  return true;
end;
$function$;

revoke execute on function public.arc_update_vault_secret(uuid, text) from public, anon, authenticated;
grant execute on function public.arc_update_vault_secret(uuid, text) to service_role;

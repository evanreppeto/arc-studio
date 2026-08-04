-- Cross-tenant denial on real Postgres (BSR-521, test 1).
--
-- Mocked tests cannot see RLS at all — that is the entire gap this closes. The
-- policies exercised here are the real ones from supabase/migrations, applied to
-- an empty database, and the assertions run AS the `authenticated` role with a
-- real JWT claim rather than as the superuser who bypasses RLS entirely.
--
-- Run by scripts/check-rls-cross-tenant.mjs, which brings up the local Supabase
-- Postgres and replays the chain first. Everything happens inside a transaction
-- that is rolled back, so the database is left exactly as it was found.
--
-- HOW A TENANT IS SIMULATED
--
-- The policies delegate to app_private.is_org_member(org_id), which checks
-- organization_memberships for `user_id = auth.uid()` and status='active'.
-- Supabase's auth.uid() reads the request's JWT claim, so setting
-- `request.jwt.claim.sub` and switching to the `authenticated` role reproduces a
-- real signed-in session faithfully.

begin;

-- ── Seed two tenants ────────────────────────────────────────────────────────
-- As superuser, so RLS does not interfere with setting the scene.

create temporary table _t (
  org_a uuid, org_b uuid, user_a uuid, user_b uuid, ws_a uuid, ws_b uuid
) on commit drop;

insert into _t
select
  gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid();

-- auth.users rows are required: organization_memberships.user_id references them.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select t.user_a, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
       'tenant-a@rls.test', '', now(), now(), now() from _t t
union all
select t.user_b, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
       'tenant-b@rls.test', '', now(), now(), now() from _t t;

-- Only required columns are supplied. Anything with a default is left to the
-- schema, so this seed does not break every time an enum or default changes —
-- which it already did twice while writing it (uuid cast, then org_status).
insert into public.organizations (id, name, slug)
select t.org_a, 'Tenant A', 'rls-tenant-a' from _t t
union all
select t.org_b, 'Tenant B', 'rls-tenant-b' from _t t;

insert into public.workspaces (id, org_id, key, slug, name)
select t.ws_a, t.org_a, 'default', 'rls-a', 'Workspace A' from _t t
union all
select t.ws_b, t.org_b, 'default', 'rls-b', 'Workspace B' from _t t;

insert into public.organization_memberships (org_id, user_id, role, status)
select t.org_a, t.user_a, 'owner', 'active' from _t t
union all
select t.org_b, t.user_b, 'owner', 'active' from _t t;

-- Workspace membership is now load-bearing, not decoration (BSR-639): campaigns
-- are workspace-owned, so their policies key on is_workspace_member(workspace_id)
-- rather than is_org_member(org_id). Org membership alone grants nothing here,
-- which assertion 4 below pins down. The app always writes both rows together
-- (user provisioning + workspace onboarding), and prod agrees — workspace member
-- count equals org member count in every org.
insert into public.workspace_memberships (org_id, workspace_id, user_id, role, status)
select t.org_a, t.ws_a, t.user_a, 'owner', 'active' from _t t
union all
select t.org_b, t.ws_b, t.user_b, 'owner', 'active' from _t t;

-- One row of tenant data on each side, in a table with real member policies.
-- `persona` is NOT NULL and carries a check forbidding 'unassigned_persona'.
insert into public.campaigns (id, org_id, workspace_id, name, persona)
select gen_random_uuid(), t.org_a, t.ws_a, 'A campaign', 'property_manager' from _t t
union all
select gen_random_uuid(), t.org_b, t.ws_b, 'B campaign', 'property_manager' from _t t;

-- ── Assertion 1: a member of A sees only A's rows ───────────────────────────

do $$
declare
  a_user uuid; other_org uuid; visible int; foreign_rows int;
begin
  -- Read the fixture BEFORE dropping to the authenticated role: the temp table
  -- is owned by postgres and `authenticated` has no grant on it, so joining it
  -- under the restricted role fails for a reason that has nothing to do with RLS.
  select user_a, org_b into a_user, other_org from _t;

  perform set_config('request.jwt.claim.sub', a_user::text, true);
  set local role authenticated;

  select count(*) into visible from public.campaigns;
  select count(*) into foreign_rows from public.campaigns where org_id = other_org;

  reset role;

  if foreign_rows <> 0 then
    raise exception 'CROSS-TENANT LEAK: tenant A saw % of tenant B''s campaigns', foreign_rows;
  end if;
  if visible <> 1 then
    raise exception 'Tenant A should see exactly its own 1 campaign, saw % — check the seed, not just the policy', visible;
  end if;
  raise notice 'ok: tenant A sees only its own campaigns';
end $$;

-- ── Assertion 2: symmetric, so a policy that denies everyone cannot pass ─────

do $$
declare
  b_user uuid; other_org uuid; visible int; foreign_rows int;
begin
  select user_b, org_a into b_user, other_org from _t;

  perform set_config('request.jwt.claim.sub', b_user::text, true);
  set local role authenticated;

  select count(*) into visible from public.campaigns;
  select count(*) into foreign_rows from public.campaigns where org_id = other_org;

  reset role;

  if foreign_rows <> 0 then
    raise exception 'CROSS-TENANT LEAK: tenant B saw % of tenant A''s campaigns', foreign_rows;
  end if;
  if visible <> 1 then
    raise exception 'Tenant B should see exactly its own 1 campaign, saw %', visible;
  end if;
  raise notice 'ok: tenant B sees only its own campaigns';
end $$;

-- ── Assertion 3: a non-member sees nothing ──────────────────────────────────

do $$
declare
  visible int;
begin
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  set local role authenticated;
  select count(*) into visible from public.campaigns;
  reset role;

  if visible <> 0 then
    raise exception 'A user who belongs to no org saw % campaigns', visible;
  end if;
  raise notice 'ok: a non-member sees nothing';
end $$;

-- ── Assertion 3b: org membership alone does not open a workspace ────────────
-- The workspace axis, which nothing tested before BSR-639. Campaigns are
-- workspace-owned, so a second user who belongs to tenant A's ORG but to none of
-- its workspaces must see zero campaigns. Without this, the campaigns policy
-- could silently regress to is_org_member() and assertions 1–3 would all still
-- pass — the exact failure mode BSR-637 was written to close.

do $$
declare
  org_only_user uuid := gen_random_uuid();
  a_org uuid;
  visible int;
begin
  select org_a into a_org from _t;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (org_only_user, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated',
          'authenticated', 'tenant-a-org-only@rls.test', '', now(), now(), now());

  insert into public.organization_memberships (org_id, user_id, role, status)
  values (a_org, org_only_user, 'member', 'active');

  perform set_config('request.jwt.claim.sub', org_only_user::text, true);
  set local role authenticated;
  select count(*) into visible from public.campaigns;
  reset role;

  if visible <> 0 then
    raise exception
      'Org membership alone exposed % campaign(s) — the campaigns policy is keying on the org, not the workspace',
      visible;
  end if;
  raise notice 'ok: org membership alone does not open a workspace';
end $$;

-- ── Assertion 4: writes are denied across the tenant boundary ───────────────
-- Reads being scoped is not enough; a tenant must not be able to write into
-- another's org either.

do $$
declare
  a_user uuid; b_org uuid; b_ws uuid; wrote boolean := false;
begin
  select user_a, org_b, ws_b into a_user, b_org, b_ws from _t;

  perform set_config('request.jwt.claim.sub', a_user::text, true);
  set local role authenticated;

  begin
    insert into public.campaigns (id, org_id, workspace_id, name, persona)
    values (gen_random_uuid(), b_org, b_ws, 'A writing into B', 'property_manager');
    wrote := true;
  exception when insufficient_privilege or check_violation then
    wrote := false;
  end;

  reset role;

  if wrote then
    raise exception 'CROSS-TENANT WRITE: tenant A inserted a campaign into tenant B''s org';
  end if;
  raise notice 'ok: cross-tenant write denied';
end $$;

-- ── Assertion 5: every org-scoped table has RLS enabled ─────────────────────
-- The ticket's rule: a new table without RLS fails by default.
--
-- Three categories, and the distinction matters:
--   * RLS off                     → FAIL. The table is readable by any session.
--   * RLS on, with policies       → scoped access, covered by assertions 1–4.
--   * RLS on, no policies         → deny-all. Service-role only, which is a
--                                   legitimate design for secrets and metering.
-- Only the first is a failure. The third is allowed but must stay visible, so
-- it is reported rather than silently accepted.

do $$
declare
  offenders text;
  deny_all text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into offenders
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    and exists (select 1 from pg_attribute a
                 where a.attrelid = c.oid and a.attname = 'org_id'
                   and a.attnum > 0 and not a.attisdropped);

  if offenders is not null then
    raise exception 'Table(s) carry org_id but have RLS DISABLED: %. Enable RLS, or justify the exception explicitly.', offenders;
  end if;

  select string_agg(c.relname, ', ' order by c.relname) into deny_all
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
    and exists (select 1 from pg_attribute a
                 where a.attrelid = c.oid and a.attname = 'org_id'
                   and a.attnum > 0 and not a.attisdropped)
    and not exists (select 1 from pg_policies p
                     where p.schemaname = 'public' and p.tablename = c.relname);

  raise notice 'ok: every org-scoped table has RLS enabled';
  if deny_all is not null then
    raise notice 'note: deny-all (RLS on, no policies, service-role only): %', deny_all;
  end if;
end $$;

rollback;

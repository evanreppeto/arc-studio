-- BSR-639 — make campaigns.workspace_id load-bearing.
--
-- `campaigns` is the only table that half-implemented workspace scoping: the
-- column existed, was nullable, nothing filtered on it, and the write path
-- dropped it on the floor (orgTenantFields returns org_id only). A campaign
-- created in one workspace was therefore listed in every workspace of the org.
--
-- Per the boundary decided in BSR-637 (docs/backend-workspace-data-boundary-audit.md)
-- campaigns are workspace-owned: an org owns the customer record, a workspace owns
-- everything generated from it.
--
-- The backfill below is only unambiguous while every org has exactly one
-- workspace, which is true today and stops being true the first time a customer
-- creates a second one. That is why this runs now rather than later.

-- 1. Backfill from the org's sole workspace. Orgs with zero or several
--    workspaces are deliberately left alone — step 2 turns that into a loud
--    failure rather than a silent partial migration.
update public.campaigns c
set workspace_id = w.id
from public.workspaces w
where c.workspace_id is null
  and w.org_id = c.org_id
  and (select count(*) from public.workspaces w2 where w2.org_id = c.org_id) = 1;

-- 2. Refuse to continue on an ambiguous row. A nullable scoping column is the
--    exact failure this migration exists to remove, so it must not be possible
--    to end up half-applied.
do $$
declare
  orphaned bigint;
begin
  select count(*) into orphaned from public.campaigns where workspace_id is null;
  if orphaned > 0 then
    raise exception
      'BSR-639: % campaign row(s) have no workspace_id and their org does not have exactly one workspace. Assign them explicitly before re-running.',
      orphaned;
  end if;
end $$;

-- 3. The invariant itself.
alter table public.campaigns
  alter column workspace_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'campaigns_workspace_id_fkey' and conrelid = 'public.campaigns'::regclass
  ) then
    alter table public.campaigns
      add constraint campaigns_workspace_id_fkey
      foreign key (workspace_id) references public.workspaces(id) on delete cascade;
  end if;
end $$;

create index if not exists campaigns_org_workspace_idx
  on public.campaigns (org_id, workspace_id);

-- 4. RLS: narrow from "any member of the org" to "a member of this workspace".
--    Safe to tighten — workspace membership currently equals org membership in
--    every org, so no existing user loses access. Note this only binds the
--    user-scoped client; service-role readers (Arc runner, /api/v1 bearer routes)
--    still bypass RLS and rely on the app-layer filter, which is why the read
--    models are updated alongside this migration rather than after it.
drop policy if exists campaigns_org_member_select on public.campaigns;
drop policy if exists campaigns_org_member_insert on public.campaigns;
drop policy if exists campaigns_org_member_update on public.campaigns;
drop policy if exists campaigns_org_member_delete on public.campaigns;

create policy campaigns_workspace_member_select on public.campaigns
  as permissive for select to authenticated
  using ((select app_private.is_workspace_member(campaigns.workspace_id)));

create policy campaigns_workspace_member_insert on public.campaigns
  as permissive for insert to authenticated
  with check ((select app_private.is_workspace_member(campaigns.workspace_id)));

create policy campaigns_workspace_member_update on public.campaigns
  as permissive for update to authenticated
  using ((select app_private.is_workspace_member(campaigns.workspace_id)))
  with check ((select app_private.is_workspace_member(campaigns.workspace_id)));

create policy campaigns_workspace_member_delete on public.campaigns
  as permissive for delete to authenticated
  using ((select app_private.is_workspace_member(campaigns.workspace_id)));

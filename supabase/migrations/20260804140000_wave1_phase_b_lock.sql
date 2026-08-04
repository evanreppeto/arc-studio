-- Wave 1 Phase B — lock the campaign + approval surface (BSR-711).
--
-- Phase A (BSR-710) added the columns nullable and backfilled them; BSR-720 then
-- found and fixed 15 further insert sites it had missed. This is the lock.
--
-- THE GATE, run read-only against prod immediately before writing this:
--
--   table                     rows  nulls  written_since_phase_a  new_nulls
--   campaign_assets             51      0                      0          0
--   approval_items              47      0                      0          0
--   approval_decisions          21      0                      0          0
--   approval_recommendations     6      0                      0          0
--   agent_outputs                9      0                      0          0
--   campaign_events             85      0                      0          0
--   campaign_dispatches          9      0                      0          0
--   campaign_results             0      0                      0          0
--
-- Note `written_since_phase_a = 0` everywhere. The traffic-based half of the gate
-- is VACUOUS here — it reports no new NULLs because nothing was written at all,
-- not because the writers are correct. Recorded plainly rather than presented as
-- a pass.
--
-- What actually justifies the lock is the static gate: every one of the 40 insert
-- sites into these tables stamps a workspace, enforced on every PR by
-- src/lib/db/workspace-writers.test.ts. That check exists because Wave 1's
-- filename-scoped audit missed 15 sites and one of them had already broken
-- production (see docs/GROUP-A-MIGRATION.md).

-- ── 1. Refuse to lock a column that still has a NULL ────────────────────────

do $$
declare
  tbl text;
  remaining bigint;
begin
  foreach tbl in array array[
    'campaign_assets', 'approval_items', 'approval_decisions', 'approval_recommendations',
    'agent_outputs', 'campaign_events', 'campaign_dispatches', 'campaign_results'
  ]
  loop
    execute format('select count(*) from public.%I where workspace_id is null', tbl) into remaining;
    if remaining > 0 then
      raise exception
        'BSR-711: % row(s) in % still have no workspace_id. Backfill them before locking — a failed SET NOT NULL mid-migration leaves the surface half-locked.',
        remaining, tbl;
    end if;
  end loop;
end $$;

-- ── 2. The lock ─────────────────────────────────────────────────────────────

alter table public.campaign_assets          alter column workspace_id set not null;
alter table public.approval_items           alter column workspace_id set not null;
alter table public.approval_decisions       alter column workspace_id set not null;
alter table public.approval_recommendations alter column workspace_id set not null;
alter table public.agent_outputs            alter column workspace_id set not null;
alter table public.campaign_events          alter column workspace_id set not null;
alter table public.campaign_dispatches      alter column workspace_id set not null;
alter table public.campaign_results         alter column workspace_id set not null;

-- ── 3. RLS: narrow from org member to workspace member ──────────────────────
--
-- Safe to tighten, checked rather than assumed: 0 active org members in either
-- org lack an active workspace membership, so nobody loses access. That is the
-- same check BSR-639 ran before narrowing `campaigns`, and the reason it is run
-- every time is that it stops being true the moment someone is invited to an org
-- without a workspace.
--
-- Service-role readers (the Arc runner, /api/v1 bearer routes) bypass RLS
-- entirely, which is why the read models are updated alongside this rather than
-- after it.

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'campaign_assets', 'approval_items', 'approval_decisions', 'approval_recommendations',
    'agent_outputs', 'campaign_events', 'campaign_dispatches', 'campaign_results'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', tbl || '_org_member_select', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_org_member_insert', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_org_member_update', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_org_member_delete', tbl);

    execute format(
      'create policy %I on public.%I as permissive for select to authenticated using ((select app_private.is_workspace_member(workspace_id)))',
      tbl || '_workspace_member_select', tbl);
    execute format(
      'create policy %I on public.%I as permissive for insert to authenticated with check ((select app_private.is_workspace_member(workspace_id)))',
      tbl || '_workspace_member_insert', tbl);
    execute format(
      'create policy %I on public.%I as permissive for update to authenticated using ((select app_private.is_workspace_member(workspace_id))) with check ((select app_private.is_workspace_member(workspace_id)))',
      tbl || '_workspace_member_update', tbl);
    execute format(
      'create policy %I on public.%I as permissive for delete to authenticated using ((select app_private.is_workspace_member(workspace_id)))',
      tbl || '_workspace_member_delete', tbl);
  end loop;
end $$;

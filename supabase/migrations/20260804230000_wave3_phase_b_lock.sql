-- Wave 3 Phase B — lock the Brain, media, brand and opportunity tables (BSR-715).
--
-- Phase A (BSR-714) added the columns nullable and backfilled 1754 rows across 11
-- tables. This is the lock, plus the business_profiles constraint move.
--
-- THE GATE, run read-only against prod immediately before writing this:
--
--   every table: 0 nulls, 0 rows written since Phase A
--
-- `written_since_phase_a = 0` again, and vacuous again for the same reason: prod
-- is idle, so it reports that nothing was written, not that the writers are
-- right. What justifies the lock is the static audit — all 16 insert sites stamp
-- a workspace, enforced every PR. On this wave that check only worked because
-- #914 fixed its detection first: 6 of those 16 sites were invisible to it.

-- ── 1. Refuse to lock a column that still has a NULL ────────────────────────

do $$
declare
  tbl text;
  remaining bigint;
begin
  foreach tbl in array array[
    'knowledge_nodes', 'knowledge_edges', 'vault_notes', 'opportunities',
    'next_best_actions', 'persona_snapshots', 'persona_knowledge_entries',
    'competitor_campaigns', 'business_profiles', 'media_assets', 'media_folders'
  ]
  loop
    execute format('select count(*) from public.%I where workspace_id is null', tbl) into remaining;
    if remaining > 0 then
      raise exception
        'BSR-715: % row(s) in % still have no workspace_id. Backfill before locking.',
        remaining, tbl;
    end if;
  end loop;
end $$;

-- ── 2. The lock ─────────────────────────────────────────────────────────────

alter table public.knowledge_nodes           alter column workspace_id set not null;
alter table public.knowledge_edges           alter column workspace_id set not null;
alter table public.vault_notes               alter column workspace_id set not null;
alter table public.opportunities             alter column workspace_id set not null;
alter table public.next_best_actions         alter column workspace_id set not null;
alter table public.persona_snapshots         alter column workspace_id set not null;
alter table public.persona_knowledge_entries alter column workspace_id set not null;
alter table public.competitor_campaigns      alter column workspace_id set not null;
alter table public.business_profiles         alter column workspace_id set not null;
alter table public.media_assets              alter column workspace_id set not null;
alter table public.media_folders             alter column workspace_id set not null;

-- ── 3. business_profiles: UNIQUE (org_id) -> UNIQUE (workspace_id) ──────────
--
-- Decided rather than deferred (unlike agents' (org_id, key) in BSR-713). That
-- constraint did not merely fail to express workspace ownership — it FORBADE it:
-- with UNIQUE (org_id), two workspaces in one org could never each hold a brand
-- profile, which is exactly what "a workspace owns its brand identity" means.
--
-- Safe: checked on prod first, 2 rows across 2 DISTINCT workspaces and 0 nulls,
-- so the new unique is satisfiable. Both upsert sites move to
-- `onConflict: "workspace_id"` in the same PR — an upsert whose conflict target
-- has no matching unique fails at runtime, and no test would see it because a
-- mocked upsert cannot check constraints. Same class as the BSR-720 outage.

alter table public.business_profiles drop constraint if exists business_profiles_org_id_key;
alter table public.business_profiles add constraint business_profiles_workspace_id_key unique (workspace_id);

-- ── 4. RLS: narrow only where a live policy exists ──────────────────────────
--
-- The policy shape differs per table here — MEASURED, not assumed, because
-- mirroring the previous wave is how a lock migration accidentally loosens
-- something:
--
--   4 org_member policies : media_assets, media_folders, opportunities, vault_notes
--   1 org_member select   : business_profiles, next_best_actions,
--                           persona_snapshots, persona_knowledge_entries
--   dead GUC policy       : knowledge_nodes, knowledge_edges
--   no policy at all      : competitor_campaigns
--
-- The last two groups are DELIBERATELY UNTOUCHED. `knowledge_nodes` and
-- `knowledge_edges` carry an ALL policy keyed on
-- `current_setting('app.current_org')`, and nothing in src/ or apps/ ever sets
-- that GUC — so it evaluates false for every row. Verified as a real workspace
-- member against live prod: knowledge_nodes 0, knowledge_edges 0,
-- competitor_campaigns 0 visible, while opportunities returned 8 and media_assets
-- 5 through their is_org_member policies.
--
-- Those three tables are therefore service-role-only today. Giving them an
-- is_workspace_member policy would OPEN 1603 rows of Brain data to authenticated
-- clients that currently see none — a change of posture, not a narrowing, and not
-- something a lock migration should decide. Left for a deliberate call (BSR-729
-- covers the read side generally).

do $$
declare
  tbl text;
begin
  -- Tables with the full four-policy org_member set.
  foreach tbl in array array['media_assets', 'media_folders', 'opportunities', 'vault_notes']
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

  -- Tables carrying a single select. No write policies are added: that would
  -- open a surface currently closed to authenticated clients.
  foreach tbl in array array[
    'business_profiles', 'next_best_actions', 'persona_snapshots', 'persona_knowledge_entries'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', tbl || '_org_member_select', tbl);
    execute format(
      'create policy %I on public.%I as permissive for select to authenticated using ((select app_private.is_workspace_member(workspace_id)))',
      tbl || '_workspace_member_select', tbl);
  end loop;
end $$;

-- Wave 1 Phase A — workspace_id on the campaign + approval surface (BSR-710).
--
-- ADDITIVE ONLY, and that is the entire point. The column lands NULLABLE, is
-- backfilled, and is indexed — but nothing is locked and no read filters on it
-- yet. `SET NOT NULL`, RLS and the read paths are Phase B (BSR-711).
--
-- The gap between the two phases is the safety margin. `orgTenantFields()` has
-- six copies that take a full {org_id, workspace_id} tenant and return org_id
-- only; this migration ships alongside their replacement, but if one insert site
-- is still missed the result is a NULL we can count, not a 500 a customer sees.
-- Collapsing the phases removes the only chance to notice.
--
-- Backfill is by FK, in tier order — each table derives from the one above it,
-- and `campaigns.workspace_id` has been NOT NULL since BSR-639. Measured on prod
-- with count(*) (not n_live_tup, which is an estimate that reported 0 rows for a
-- table holding 6 during BSR-653) immediately before writing this:
--
--   campaign_assets 51/51   approval_items 47/47   approval_decisions 21/21
--   approval_recommendations 6/6   agent_outputs 9/9   campaign_events 85/85
--   campaign_dispatches 9/9   campaign_results 0/0
--
-- 228 rows, 100% derivable. No row here needs the org's-sole-workspace fallback,
-- so this wave is correct under any future org/workspace topology — unlike Wave 3,
-- where nothing has a parent to derive from.

-- ── Columns (nullable on purpose) ───────────────────────────────────────────

alter table public.campaign_assets          add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.approval_items           add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.approval_decisions       add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.approval_recommendations add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.agent_outputs            add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.campaign_events          add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.campaign_dispatches      add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.campaign_results         add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;

-- ── Tier 1: straight off campaigns ──────────────────────────────────────────

update public.campaign_assets a
set workspace_id = c.workspace_id
from public.campaigns c
where a.campaign_id = c.id and a.workspace_id is null;

-- ── Tier 2: approval_items, by campaign then by asset ───────────────────────

update public.approval_items i
set workspace_id = c.workspace_id
from public.campaigns c
where i.campaign_id = c.id and i.workspace_id is null;

update public.approval_items i
set workspace_id = a.workspace_id
from public.campaign_assets a
where i.campaign_asset_id = a.id and i.workspace_id is null and a.workspace_id is not null;

-- ── Tier 3: children of approval_items ──────────────────────────────────────

update public.approval_decisions d
set workspace_id = i.workspace_id
from public.approval_items i
where d.approval_item_id = i.id and d.workspace_id is null and i.workspace_id is not null;

update public.approval_recommendations r
set workspace_id = i.workspace_id
from public.approval_items i
where r.approval_item_id = i.id and r.workspace_id is null and i.workspace_id is not null;

-- agent_outputs prefers agent_tasks: it is the only parent that carries a
-- workspace of its own rather than inheriting one, so it is the most direct
-- answer where it exists.
update public.agent_outputs o
set workspace_id = t.workspace_id
from public.agent_tasks t
where o.task_id = t.id and o.workspace_id is null;

update public.agent_outputs o
set workspace_id = i.workspace_id
from public.approval_items i
where o.approval_item_id = i.id and o.workspace_id is null and i.workspace_id is not null;

update public.agent_outputs o
set workspace_id = a.workspace_id
from public.campaign_assets a
where o.campaign_asset_id = a.id and o.workspace_id is null and a.workspace_id is not null;

-- ── Tier 4: campaign-adjacent event/dispatch/result rows ────────────────────

do $$
declare
  tbl text;
begin
  foreach tbl in array array['campaign_events', 'campaign_dispatches', 'campaign_results']
  loop
    execute format($f$
      update public.%1$I x set workspace_id = c.workspace_id
      from public.campaigns c where x.campaign_id = c.id and x.workspace_id is null
    $f$, tbl);

    execute format($f$
      update public.%1$I x set workspace_id = a.workspace_id
      from public.campaign_assets a
      where x.campaign_asset_id = a.id and x.workspace_id is null and a.workspace_id is not null
    $f$, tbl);
  end loop;
end $$;

-- campaign_events and campaign_dispatches can also hang off an approval item.
-- campaign_results has no approval_item_id column, so it is not in this loop.
do $$
declare
  tbl text;
begin
  foreach tbl in array array['campaign_events', 'campaign_dispatches']
  loop
    execute format($f$
      update public.%1$I x set workspace_id = i.workspace_id
      from public.approval_items i
      where x.approval_item_id = i.id and x.workspace_id is null and i.workspace_id is not null
    $f$, tbl);
  end loop;
end $$;

-- ── Report, do not enforce ──────────────────────────────────────────────────
-- Phase A must not fail on a row it could not place: a NULL here is information
-- Phase B needs, not a reason to block the deploy. It is raised as a NOTICE so it
-- shows in the migration log, and BSR-711's gate query is what actually acts on it.

do $$
declare
  tbl text;
  remaining bigint;
  total bigint := 0;
begin
  foreach tbl in array array[
    'campaign_assets', 'approval_items', 'approval_decisions', 'approval_recommendations',
    'agent_outputs', 'campaign_events', 'campaign_dispatches', 'campaign_results'
  ]
  loop
    execute format('select count(*) from public.%I where workspace_id is null', tbl) into remaining;
    total := total + remaining;
    if remaining > 0 then
      raise notice 'BSR-710: % row(s) in % have no workspace_id after backfill', remaining, tbl;
    end if;
  end loop;
  raise notice 'BSR-710: backfill complete, % row(s) unresolved across the wave', total;
end $$;

create index if not exists campaign_assets_workspace_idx          on public.campaign_assets (org_id, workspace_id);
create index if not exists approval_items_workspace_idx           on public.approval_items (org_id, workspace_id);
create index if not exists approval_decisions_workspace_idx       on public.approval_decisions (org_id, workspace_id);
create index if not exists approval_recommendations_workspace_idx on public.approval_recommendations (org_id, workspace_id);
create index if not exists agent_outputs_workspace_idx            on public.agent_outputs (org_id, workspace_id);
create index if not exists campaign_events_workspace_idx          on public.campaign_events (org_id, workspace_id);
create index if not exists campaign_dispatches_workspace_idx      on public.campaign_dispatches (org_id, workspace_id);
create index if not exists campaign_results_workspace_idx         on public.campaign_results (org_id, workspace_id);

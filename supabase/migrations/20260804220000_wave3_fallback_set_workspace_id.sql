-- Wave 3 Phase A — workspace_id on the Brain, media, brand and opportunity tables
-- (BSR-714).
--
-- ADDITIVE ONLY. Columns land NULLABLE, backfilled and indexed; SET NOT NULL, RLS
-- and read filters are Phase B (BSR-715).
--
-- ── The plan called this "the fallback set". Measured, that is too pessimistic ──
--
-- docs/GROUP-A-MIGRATION.md says of this wave: "No derivation path; every row
-- takes the org's sole workspace." Counted on prod immediately before writing
-- this (count(*), never n_live_tup):
--
--   table                      rows   derives from
--   knowledge_edges            1076   from_node_id -> knowledge_nodes   (100%)
--   knowledge_nodes             527   fallback
--   opportunities               134   agent_task_id -> agent_tasks (6)
--                                     campaign_id  -> campaigns    (2)
--                                     fallback                     (126)
--   media_folders                10   fallback
--   media_assets                  5   folder_id -> media_folders        (100%)
--   business_profiles             2   fallback
--   competitor_campaigns          0   created_by_agent_id -> agents
--   next_best_actions             0   approval_item_id / campaign_id / persona_snapshot_id
--   persona_snapshots             0   campaign_id -> campaigns
--   persona_knowledge_entries     0   fallback
--   vault_notes                   0   fallback
--
-- 1754 rows. **1081 of them derive** once the parentless tables are placed, not
-- zero — `opportunities.agent_task_id` and the two parent-child pairs were all
-- missed by the plan's summary. That matters because a derived row stays correct
-- under any future org/workspace topology, and an assigned one is only correct
-- under today's.
--
-- The 673 assigned rows are dominated by the Brain (527 nodes) and are almost
-- entirely in the ARCHIVED org: 445 of those nodes are seed data.
--
-- Both orgs hold exactly one workspace, so every fallback below is unambiguous.
-- The `= 1` guard still refuses rather than guessing if that ever stops being
-- true — assigning a row to the wrong workspace is worse than leaving it NULL,
-- because a NULL is visible to Phase B's gate and a wrong answer is not.

-- ── Columns (nullable on purpose) ───────────────────────────────────────────

alter table public.knowledge_nodes           add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.knowledge_edges           add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.vault_notes               add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.opportunities             add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.next_best_actions         add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.persona_snapshots         add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.persona_knowledge_entries add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.competitor_campaigns      add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.business_profiles         add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.media_assets              add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.media_folders             add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;

-- ── Tier 1: derive from tables that already carry a workspace ────────────────
-- Order matters: persona_snapshots is placed before next_best_actions, which can
-- derive from persona_snapshot_id.

update public.opportunities o
set workspace_id = t.workspace_id
from public.agent_tasks t
where o.agent_task_id = t.id and o.workspace_id is null;

update public.opportunities o
set workspace_id = c.workspace_id
from public.campaigns c
where o.campaign_id = c.id and o.workspace_id is null;

update public.persona_snapshots s
set workspace_id = c.workspace_id
from public.campaigns c
where s.campaign_id = c.id and s.workspace_id is null;

update public.competitor_campaigns cc
set workspace_id = a.workspace_id
from public.agents a
where cc.created_by_agent_id = a.id and cc.workspace_id is null and a.workspace_id is not null;

update public.next_best_actions n
set workspace_id = i.workspace_id
from public.approval_items i
where n.approval_item_id = i.id and n.workspace_id is null;

update public.next_best_actions n
set workspace_id = c.workspace_id
from public.campaigns c
where n.campaign_id = c.id and n.workspace_id is null;

update public.next_best_actions n
set workspace_id = s.workspace_id
from public.persona_snapshots s
where n.persona_snapshot_id = s.id and n.workspace_id is null and s.workspace_id is not null;

-- ── Tier 2: the org's sole workspace, for rows with no parent ───────────────

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'knowledge_nodes', 'media_folders', 'business_profiles', 'vault_notes',
    'persona_knowledge_entries', 'opportunities', 'persona_snapshots',
    'competitor_campaigns', 'next_best_actions'
  ]
  loop
    execute format($f$
      update public.%1$I x
      set workspace_id = (select w.id from public.workspaces w where w.org_id = x.org_id)
      where x.workspace_id is null
        and (select count(*) from public.workspaces w where w.org_id = x.org_id) = 1
    $f$, tbl);
  end loop;
end $$;

-- ── Tier 3: children of the rows just placed ────────────────────────────────
-- knowledge_edges and media_assets derive from parents that themselves took the
-- fallback. That is deliberately better than giving them their own fallback: an
-- edge and its node are then guaranteed to agree, whatever the parent was
-- assigned. Consistency is derivable even when correctness is only assigned.

update public.knowledge_edges e
set workspace_id = n.workspace_id
from public.knowledge_nodes n
where e.from_node_id = n.id and e.workspace_id is null and n.workspace_id is not null;

update public.knowledge_edges e
set workspace_id = n.workspace_id
from public.knowledge_nodes n
where e.to_node_id = n.id and e.workspace_id is null and n.workspace_id is not null;

update public.media_assets m
set workspace_id = f.workspace_id
from public.media_folders f
where m.folder_id = f.id and m.workspace_id is null and f.workspace_id is not null;

-- media_assets with no folder fall back to the org's sole workspace.
update public.media_assets m
set workspace_id = (select w.id from public.workspaces w where w.org_id = m.org_id)
where m.workspace_id is null
  and (select count(*) from public.workspaces w where w.org_id = m.org_id) = 1;

-- ── Report, do not enforce ──────────────────────────────────────────────────

do $$
declare
  tbl text;
  remaining bigint;
  total bigint := 0;
begin
  foreach tbl in array array[
    'knowledge_nodes', 'knowledge_edges', 'vault_notes', 'opportunities',
    'next_best_actions', 'persona_snapshots', 'persona_knowledge_entries',
    'competitor_campaigns', 'business_profiles', 'media_assets', 'media_folders'
  ]
  loop
    execute format('select count(*) from public.%I where workspace_id is null', tbl) into remaining;
    total := total + remaining;
    if remaining > 0 then
      raise notice 'BSR-714: % row(s) in % have no workspace_id after backfill', remaining, tbl;
    end if;
  end loop;
  raise notice 'BSR-714: backfill complete, % row(s) unresolved across the wave', total;
end $$;

create index if not exists knowledge_nodes_workspace_idx           on public.knowledge_nodes (org_id, workspace_id);
create index if not exists knowledge_edges_workspace_idx           on public.knowledge_edges (org_id, workspace_id);
create index if not exists vault_notes_workspace_idx               on public.vault_notes (org_id, workspace_id);
create index if not exists opportunities_workspace_idx             on public.opportunities (org_id, workspace_id);
create index if not exists next_best_actions_workspace_idx         on public.next_best_actions (org_id, workspace_id);
create index if not exists persona_snapshots_workspace_idx         on public.persona_snapshots (org_id, workspace_id);
create index if not exists persona_knowledge_entries_workspace_idx on public.persona_knowledge_entries (org_id, workspace_id);
create index if not exists competitor_campaigns_workspace_idx      on public.competitor_campaigns (org_id, workspace_id);
create index if not exists business_profiles_workspace_idx         on public.business_profiles (org_id, workspace_id);
create index if not exists media_assets_workspace_idx              on public.media_assets (org_id, workspace_id);
create index if not exists media_folders_workspace_idx             on public.media_folders (org_id, workspace_id);

-- ── Note for Phase B: business_profiles has UNIQUE (org_id) ─────────────────
--
-- Unlike agents' (org_id, key), that constraint does not merely fail to express
-- workspace ownership — it FORBIDS it. Two workspaces in one org could never each
-- hold a brand profile, which is precisely what "a workspace owns its brand
-- identity" means. Left alone here because a Phase A does not rewrite
-- constraints, but it is a stronger case than agents' and should be decided in
-- BSR-715 rather than deferred again by default.

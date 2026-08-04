-- Wave 2 Phase A — workspace_id on the agent + Arc tables (BSR-712).
--
-- ADDITIVE ONLY. Columns land NULLABLE, backfilled and indexed; `SET NOT NULL`,
-- RLS and read filters are Phase B (BSR-713). See BSR-711's header for why the
-- two phases must not be collapsed.
--
-- Measured on prod with count(*) immediately before writing this:
--
--   table                  rows  derivable  source
--   agent_task_inputs        83     83/83   task_id -> agent_tasks (NOT NULL there)
--   agent_run_logs           10     10/10   task_id -> agent_tasks
--   agent_task_events         0       0/0   task_id -> agent_tasks
--   agents                    8      8/8    org's sole workspace (no FK exists)
--   arc_generated_skills      0       0/0   org's sole workspace (no FK exists)
--
-- 101 rows, all resolvable. Two things this wave does NOT share with Wave 1:
--
-- 1. `agent_run_logs.task_id` is NULLABLE. Every one of the 10 live rows has a
--    task today, so the derivation covers 100% *of current rows* — but the schema
--    permits a parentless row, so deriving alone would leave a hole the moment one
--    appears. The org-fallback below closes it. Checked rather than assumed:
--    agent_task_inputs.task_id and agent_task_events.task_id are both NOT NULL.
--
-- 2. `agents` and `arc_generated_skills` have no FK to derive from and take the
--    org's-sole-workspace fallback. That is sound because no product path creates
--    a second workspace inside an existing org (docs/GROUP-A-MIGRATION.md,
--    finding 1) — but unlike Wave 1 it is an assignment, not a derivation, so the
--    fallback below refuses when an org has anything other than exactly one
--    workspace rather than picking arbitrarily.

-- ── Columns (nullable on purpose) ───────────────────────────────────────────

alter table public.agent_task_inputs    add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.agent_task_events    add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.agent_run_logs       add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.agents               add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.arc_generated_skills add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;

-- ── Derive from agent_tasks, which carries workspace_id NOT NULL ────────────

do $$
declare
  tbl text;
begin
  foreach tbl in array array['agent_task_inputs', 'agent_task_events', 'agent_run_logs']
  loop
    execute format($f$
      update public.%1$I x set workspace_id = t.workspace_id
      from public.agent_tasks t
      where x.task_id = t.id and x.workspace_id is null
    $f$, tbl);
  end loop;
end $$;

-- ── Fallback: the org's sole workspace ──────────────────────────────────────
--
-- Covers `agents`, `arc_generated_skills`, and any `agent_run_logs` row whose
-- nullable task_id is null. The `= 1` guard is the point: an org with two
-- workspaces (or none) is left NULL for a human to place, because guessing there
-- would silently hand one workspace's Arc rows to another. Today no org is in
-- that state; this migration should still be correct on the day one is.

do $$
declare
  tbl text;
begin
  foreach tbl in array array['agents', 'arc_generated_skills', 'agent_run_logs']
  loop
    execute format($f$
      update public.%1$I x
      set workspace_id = (select w.id from public.workspaces w where w.org_id = x.org_id)
      where x.workspace_id is null
        and (select count(*) from public.workspaces w where w.org_id = x.org_id) = 1
    $f$, tbl);
  end loop;
end $$;

-- ── Report, do not enforce ──────────────────────────────────────────────────
-- A row this could not place is information Phase B needs, not a reason to block
-- the deploy. Raised as a NOTICE; BSR-713's gate is what acts on it.

do $$
declare
  tbl text;
  remaining bigint;
  total bigint := 0;
begin
  foreach tbl in array array[
    'agent_task_inputs', 'agent_task_events', 'agent_run_logs', 'agents', 'arc_generated_skills'
  ]
  loop
    execute format('select count(*) from public.%I where workspace_id is null', tbl) into remaining;
    total := total + remaining;
    if remaining > 0 then
      raise notice 'BSR-712: % row(s) in % have no workspace_id after backfill', remaining, tbl;
    end if;
  end loop;
  raise notice 'BSR-712: backfill complete, % row(s) unresolved across the wave', total;
end $$;

create index if not exists agent_task_inputs_workspace_idx    on public.agent_task_inputs (org_id, workspace_id);
create index if not exists agent_task_events_workspace_idx    on public.agent_task_events (org_id, workspace_id);
create index if not exists agent_run_logs_workspace_idx       on public.agent_run_logs (org_id, workspace_id);
create index if not exists agents_workspace_idx               on public.agents (org_id, workspace_id);
create index if not exists arc_generated_skills_workspace_idx on public.arc_generated_skills (org_id, workspace_id);

-- Wave 2 Phase B — lock the agent + Arc tables (BSR-713).
--
-- Phase A (BSR-712) added the columns nullable, backfilled 101 rows and updated
-- all 10 insert sites. This is the lock.
--
-- THE GATE, run read-only against prod immediately before writing this:
--
--   table                  rows  nulls  written_since_phase_a  new_nulls
--   agent_task_inputs        85      0                      0          0
--   agent_run_logs           10      0                      0          0
--   agent_task_events         0      0                      0          0
--   agents                    8      0                      0          0
--   arc_generated_skills      0      0                      0          0
--
-- `written_since_phase_a = 0` again, and again that half of the gate is VACUOUS:
-- it reports no new NULLs because nothing was written, not because the writers
-- are correct. Stated plainly rather than presented as a pass.
--
-- What justifies the lock is the static gate — all 10 insert sites stamp a
-- workspace, enforced on every PR by src/lib/db/workspace-writers.test.ts. On
-- this wave that check earned its place: it found 3 sites the by-table grep had
-- missed, because they read as selects (upsertArcAgent / ensureArcAgentId).
--
-- NOTE the row counts differ from Phase A's measurement (agent_task_inputs 83 ->
-- 85). Those two rows arrived between measuring and migrating, were written by
-- the OLD code with org_id alone, and were caught by the backfill. That is
-- evidence the backfill covers the gap; it is NOT evidence the writers stamp.

-- ── 1. Refuse to lock a column that still has a NULL ────────────────────────

do $$
declare
  tbl text;
  remaining bigint;
begin
  foreach tbl in array array[
    'agent_task_inputs', 'agent_task_events', 'agent_run_logs', 'agents', 'arc_generated_skills'
  ]
  loop
    execute format('select count(*) from public.%I where workspace_id is null', tbl) into remaining;
    if remaining > 0 then
      raise exception
        'BSR-713: % row(s) in % still have no workspace_id. Backfill them before locking — a failed SET NOT NULL mid-migration leaves the surface half-locked.',
        remaining, tbl;
    end if;
  end loop;
end $$;

-- ── 2. The lock ─────────────────────────────────────────────────────────────

alter table public.agent_task_inputs    alter column workspace_id set not null;
alter table public.agent_task_events    alter column workspace_id set not null;
alter table public.agent_run_logs       alter column workspace_id set not null;
alter table public.agents               alter column workspace_id set not null;
alter table public.arc_generated_skills alter column workspace_id set not null;

-- ── 3. RLS: narrow from org member to workspace member ──────────────────────
--
-- Unlike Wave 1, these five tables carry exactly ONE policy each: a SELECT for
-- `authenticated`. Writes reach them only through the service role, which bypasses
-- RLS entirely. So this replaces the select and deliberately does NOT add
-- insert/update/delete policies — adding them would loosen a surface that is
-- currently closed to authenticated clients, which is not what a lock migration
-- is for.
--
-- Safe to tighten, checked rather than assumed: 0 active org members in either
-- org lack an active workspace membership, so nobody loses access. That check is
-- re-run every time because it stops being true the moment someone is invited to
-- an org without a workspace.
--
-- Then proved the other way round — this whole block was applied to prod inside a
-- transaction that rolled back, and a read AS a real workspace member returned
-- 1 agent / 48 task inputs / 1 run log. Not zero, so nobody is shut out.
--
-- ⚠️ WHEN RUNNING THAT CHECK, resolve the user id BEFORE `set role authenticated`.
-- The first attempt did it the other way round, so the lookup that finds the user
-- was itself RLS-restricted, the jwt claim landed NULL, and every count came back
-- 0 — indistinguishable from a total lockout. A verification that can produce a
-- false alarm this cleanly is worth writing down.

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'agent_task_inputs', 'agent_task_events', 'agent_run_logs', 'agents', 'arc_generated_skills'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', tbl || '_org_member_select', tbl);
    execute format(
      'create policy %I on public.%I as permissive for select to authenticated using ((select app_private.is_workspace_member(workspace_id)))',
      tbl || '_workspace_member_select', tbl);
  end loop;
end $$;

-- ── 4. What is deliberately NOT here ────────────────────────────────────────
--
-- `agents` is workspace-owned by the BSR-637 rule, but its unique constraint is
-- still (org_id, key) and five upserts target it via `onConflict: "org_id,key"`.
-- Moving it to (workspace_id, key) means changing that constraint AND ~16 call
-- sites in one step, with no behavioural difference today: no product path puts a
-- second workspace inside an existing org, so the two keys select the same row.
--
-- Deferred on purpose. It becomes REQUIRED the day a multi-workspace-per-org
-- feature is built, and that feature's ticket is the right place for it — doing
-- it here would be a large, untestable change justified by nothing observable.

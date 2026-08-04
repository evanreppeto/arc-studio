-- Wave 4 Phase A — backfill the Group B columns (BSR-716).
--
-- No new columns: every table here already has workspace_id (and, on four of
-- them, org_id) — just nullable. This backfills them. SET NOT NULL is Phase B
-- (BSR-717), for the same reason as every other wave: a missed writer should
-- produce a NULL you can count, not a 500 a customer sees.
--
-- MEASURED ON PROD immediately before writing this (count(*), not n_live_tup):
--
--   table                     rows   workspace_id null   org_id null
--   ai_usage_events            148            59              0
--   arc_messages               128           128              0
--   arc_projects                 7             7              0
--   arc_conversations           25             0              0
--   connector_usage_events       5             0              0
--   workspace_connectors         5             0              0   (ws already NOT NULL)
--   audit_events                 5             0              0
--   arc_saved_items              0             0              0
--   connector_spend_budgets      0             0              0   (ws already NOT NULL)
--   support_requests             0             0              0
--   workspace_media_config       0             0              0   (ws already NOT NULL)
--
-- Only three tables need anything: arc_messages, arc_projects, ai_usage_events.
--
-- ⚠️ ai_usage_events is the metering ledger, and the meter is already known to
-- undercount. Row counts are asserted unchanged at the end — a tenancy backfill
-- must not quietly drop a billing row.

-- Snapshot the metering ledger BEFORE touching anything, so the assertion at the
-- end compares like with like. Deliberately not a hard-coded 148: Arc writes to
-- this table continuously, so a fixed number would fail the deploy for the
-- ordinary reason that time passed. The invariant that matters is "this migration
-- changed no row count", not "the count equals what I measured an hour ago".
create temporary table _bsr716_before on commit drop as
select count(*) as ai_usage_rows from public.ai_usage_events;

-- ── arc_messages: derive from the conversation, not the org ────────────────
-- All 128 resolve this way (arc_conversations.workspace_id is populated on every
-- row), so no message needs the org fallback. Derived beats assigned: these stay
-- correct under any future org/workspace topology.

update public.arc_messages m
set workspace_id = c.workspace_id
from public.arc_conversations c
where m.conversation_id = c.id and m.workspace_id is null and c.workspace_id is not null;

-- ── arc_projects + ai_usage_events: the org's sole workspace ───────────────
-- Neither has a parent to derive from. ai_usage_events HAS task_id and
-- campaign_id, but checked on prod: all 59 unstamped rows have neither, so there
-- is nothing to derive through. The `= 1` guard refuses rather than guessing.

do $$
declare
  tbl text;
begin
  foreach tbl in array array['arc_projects', 'ai_usage_events']
  loop
    execute format($f$
      update public.%1$I x
      set workspace_id = (select w.id from public.workspaces w where w.org_id = x.org_id)
      where x.workspace_id is null
        and x.org_id is not null
        and (select count(*) from public.workspaces w where w.org_id = x.org_id) = 1
    $f$, tbl);
  end loop;
end $$;

-- ── org_id on the workspace-first tables ───────────────────────────────────
-- connector_usage_events, connector_spend_budgets, workspace_connectors and
-- workspace_media_config have a NULLABLE org_id (three of them already have
-- workspace_id NOT NULL — they were built workspace-first). Prod shows 0 nulls,
-- so this is a no-op today and exists so the column is right if one appears
-- before Phase B tightens it.

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'connector_usage_events', 'connector_spend_budgets', 'workspace_connectors', 'workspace_media_config'
  ]
  loop
    execute format($f$
      update public.%1$I x
      set org_id = w.org_id
      from public.workspaces w
      where x.workspace_id = w.id and x.org_id is null
    $f$, tbl);
  end loop;
end $$;

-- ── Report, and hard-assert the metering ledger did not shrink ─────────────

do $$
declare
  tbl text;
  remaining bigint;
  total bigint := 0;
  usage_before bigint;
  usage_after bigint;
begin
  select ai_usage_rows into usage_before from _bsr716_before;
  select count(*) into usage_after from public.ai_usage_events;
  if usage_after <> usage_before then
    raise exception
      'BSR-716: ai_usage_events went from % rows to % during this migration. A tenancy backfill must never change the metering ledger''s row count.',
      usage_before, usage_after;
  end if;

  foreach tbl in array array[
    'arc_conversations', 'arc_messages', 'arc_projects', 'arc_saved_items', 'audit_events',
    'support_requests', 'ai_usage_events', 'connector_usage_events', 'connector_spend_budgets',
    'workspace_connectors', 'workspace_media_config'
  ]
  loop
    execute format('select count(*) from public.%I where workspace_id is null', tbl) into remaining;
    total := total + remaining;
    if remaining > 0 then
      raise notice 'BSR-716: % row(s) in % have no workspace_id after backfill', remaining, tbl;
    end if;
  end loop;
  raise notice 'BSR-716: backfill complete, % row(s) unresolved across the wave', total;
end $$;

create index if not exists arc_messages_workspace_idx    on public.arc_messages (org_id, workspace_id);
create index if not exists arc_projects_workspace_idx    on public.arc_projects (org_id, workspace_id);
create index if not exists ai_usage_events_workspace_idx on public.ai_usage_events (org_id, workspace_id);

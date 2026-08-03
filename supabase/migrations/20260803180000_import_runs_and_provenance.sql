-- Import runs as first-class records (BSR-640).
--
-- Today an import leaves no trace. runCsvImport / runCrmImport return an
-- ImportRunResult straight to the browser, it renders as one line of status text,
-- and then it is gone: no record, no batch id on the written rows, no way to see
-- what a run did or undo it. That single gap is what makes "import whenever you
-- want" feel risky rather than routine, and it blocks the preview (BSR-641),
-- history and undo (BSR-643) work behind it.
--
-- Three pieces:
--   import_runs           one row per run — who, from where, counts, errors
--   import_run_records    one row per affected record — created vs updated
--   external_object_mappings  the stable external-id ↔ local-row identity map
--
-- external_systems / external_object_mappings already existed, empty and wired to
-- nothing (they were built for exactly this and never used). They are revived here
-- rather than reinvented — the only thing they lacked was tenancy, and per the
-- BSR-637 boundary an import artifact is workspace-owned: the run belongs to the
-- workspace that triggered it. Both tables are empty in prod, so the NOT NULL
-- columns need no backfill.

-- ── Tenancy for the revived scaffold ─────────────────────────────────────────

alter table public.external_systems
  add column if not exists org_id uuid not null references public.organizations(id) on delete cascade,
  add column if not exists workspace_id uuid not null references public.workspaces(id) on delete cascade;

alter table public.external_object_mappings
  add column if not exists org_id uuid not null references public.organizations(id) on delete cascade,
  add column if not exists workspace_id uuid not null references public.workspaces(id) on delete cascade;

-- One local row per (workspace, system, external object). This is the constraint
-- that makes a re-import an update instead of a duplicate, and it is what lets a
-- later entity-per-file import (BSR-644) resolve a deal's company reference to a
-- row we already have.
create unique index if not exists external_object_mappings_identity_idx
  on public.external_object_mappings (workspace_id, external_system_id, external_object_type, external_object_id);

create index if not exists external_object_mappings_local_idx
  on public.external_object_mappings (org_id, local_table, local_id);

create unique index if not exists external_systems_workspace_key_idx
  on public.external_systems (workspace_id, system_key);

-- ── import_runs ──────────────────────────────────────────────────────────────

create table if not exists public.import_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- The workspace that triggered the run. Load-bearing rather than decorative:
  -- the connector is configured per workspace but the CRM rows it writes are
  -- org-owned, so without this "where did these 400 contacts come from" has no
  -- answer at all once a company has two workspaces.
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source text not null,
  status text not null default 'running',
  -- Free text: the operator identity the action ran as. Null for system-triggered.
  operator text,
  started_at timestamp with time zone not null default now(),
  finished_at timestamp with time zone,
  imported integer not null default 0,
  updated integer not null default 0,
  skipped integer not null default 0,
  failed integer not null default 0,
  enriched integer not null default 0,
  pages integer not null default 0,
  -- Best-effort per-record errors, [{externalId, message}]. The engine already
  -- collects these and currently throws them away after one status line.
  errors jsonb not null default '[]'::jsonb,
  -- What the run was told to do: default persona, column mapping, source config.
  -- Never credentials — those stay in the vault.
  options jsonb not null default '{}'::jsonb,
  -- Whether an undo is still safe. BSR-643 owns the rule that clears it; it
  -- defaults true and is only ever narrowed.
  reversible boolean not null default true,
  reversed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  constraint import_runs_source_check
    check (source in ('csv', 'hubspot', 'mailchimp', 'salesforce', 'pipedrive', 'jobber', 'google_contacts')),
  constraint import_runs_status_check
    check (status in ('running', 'completed', 'failed'))
);

create index if not exists import_runs_workspace_started_idx
  on public.import_runs (workspace_id, started_at desc);

-- ── import_run_records ───────────────────────────────────────────────────────

create table if not exists public.import_run_records (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.import_runs(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  local_table text not null,
  local_id uuid not null,
  external_id text,
  -- The distinction the whole undo depends on. A blanket delete would take out
  -- rows that existed before the run and were merely updated by it.
  action text not null,
  -- Prior column values for an update, so a reversal can restore rather than
  -- delete. Populated for action='updated'; always empty for 'created', where
  -- there is nothing to restore to.
  previous jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  constraint import_run_records_action_check check (action in ('created', 'updated'))
);

create index if not exists import_run_records_run_idx
  on public.import_run_records (import_run_id, action);

create index if not exists import_run_records_local_idx
  on public.import_run_records (org_id, local_table, local_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Workspace-member scoped, matching campaigns (BSR-639). Imports are written by
-- the service-role client, which bypasses RLS — these policies are what stop a
-- signed-in user reading another workspace's import history.

alter table public.import_runs enable row level security;
alter table public.import_run_records enable row level security;
alter table public.external_systems enable row level security;
alter table public.external_object_mappings enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['import_runs', 'import_run_records', 'external_systems', 'external_object_mappings']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_workspace_member_select', t);
    execute format(
      'create policy %I on public.%I as permissive for select to authenticated using ((select app_private.is_workspace_member(workspace_id)))',
      t || '_workspace_member_select', t
    );
  end loop;
end $$;

-- Writes stay service-role only: an import is a system action behind an operator
-- gate, never a direct client insert.
grant select on public.import_runs to authenticated;
grant select on public.import_run_records to authenticated;
grant select on public.external_systems to authenticated;
grant select on public.external_object_mappings to authenticated;

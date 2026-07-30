-- Per-tenant pipeline stages (BSR-495, part 1 of 2).
--
-- ADDITIVE ONLY. This creates the stage definitions and seeds every existing org
-- with the values it already has, so nothing changes for anyone today. The
-- destructive half — converting lead_status / job_status / outcome_status from
-- enum to text — is deliberately NOT here: `alter column … type` is refused by
-- .github/workflows/migrate-prod.yml by design and must be applied by hand with
-- a backup taken first (BSR-532). Splitting it this way means the foundation can
-- ship and be exercised before anything irreversible happens to the columns.
--
-- Why stages carry semantic flags rather than the app matching on names: about
-- 26 files currently test `status === 'won'` and 19 test `'qualified'`. Once a
-- tenant can rename a stage, every one of those comparisons silently goes false
-- and their revenue reporting quietly reads zero — no error, just wrong numbers.
-- `is_won` / `is_lost` / `is_terminal` / `is_qualified` are what the app asks
-- instead. Mirrored in src/domain/pipeline-stages.ts — keep in sync.

create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  -- Which pipeline. Only the tenant's own sales process is configurable:
  -- approval/agent/campaign statuses are app machinery the code branches on.
  object_key text not null,
  key text not null,
  label text not null,
  sort_order integer not null default 0,
  is_terminal boolean not null default false,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  is_qualified boolean not null default false,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint pipeline_stages_object_key_check
    check (object_key in ('leads', 'jobs', 'outcomes')),
  constraint pipeline_stages_key_format_check
    check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint pipeline_stages_label_length_check
    check (char_length(btrim(label)) between 1 and 80),
  -- A stage cannot be both outcomes at once.
  constraint pipeline_stages_won_xor_lost_check
    check (not (is_won and is_lost)),
  -- An outcome that isn't terminal lets a record be counted as revenue and then
  -- move on, double-counting it.
  constraint pipeline_stages_outcome_is_terminal_check
    check ((not is_won and not is_lost) or is_terminal)
);

create unique index if not exists pipeline_stages_org_object_key_idx
  on public.pipeline_stages (org_id, object_key, key);

create index if not exists pipeline_stages_ordered_idx
  on public.pipeline_stages (org_id, object_key, sort_order)
  where active;

alter table public.pipeline_stages enable row level security;

create policy pipeline_stages_org_member_select on public.pipeline_stages
  as permissive for select to authenticated
  using ((select app_private.is_org_member(pipeline_stages.org_id)));

grant select, insert, update, delete on public.pipeline_stages to service_role;

-- Seed every existing org with exactly today's values, flags included. Day-one
-- behaviour is unchanged: a tenant sees what they see now until they edit it.
-- `on conflict do nothing` keeps this re-runnable and makes it a no-op for any
-- org that has already customised its pipeline.
insert into public.pipeline_stages
  (org_id, object_key, key, label, sort_order, is_terminal, is_won, is_lost, is_qualified)
select o.id, s.object_key, s.key, s.label, s.sort_order, s.is_terminal, s.is_won, s.is_lost, s.is_qualified
from public.organizations o
cross join (values
  -- leads
  ('leads','new','New',0,false,false,false,false),
  ('leads','validated','Validated',1,false,false,false,false),
  ('leads','needs_review','Needs review',2,false,false,false,false),
  ('leads','qualified','Qualified',3,false,false,false,true),
  ('leads','converted','Converted',4,true,true,false,true),
  ('leads','lost','Lost',5,true,false,true,false),
  -- Terminal but neither won nor lost: archiving is a filing action, not an
  -- outcome, and counting it either way would distort conversion rate.
  ('leads','archived','Archived',6,true,false,false,false),
  -- jobs
  ('jobs','pending','Pending',0,false,false,false,false),
  ('jobs','scheduled','Scheduled',1,false,false,false,true),
  ('jobs','in_progress','In progress',2,false,false,false,true),
  ('jobs','completed','Completed',3,true,true,false,true),
  ('jobs','canceled','Canceled',4,true,false,true,false),
  -- outcomes
  ('outcomes','pending','Pending',0,false,false,false,false),
  ('outcomes','won','Won',1,true,true,false,true),
  ('outcomes','lost','Lost',2,true,false,true,false),
  -- Paid is won money that actually landed — still won, not a separate outcome.
  ('outcomes','paid','Paid',3,true,true,false,true),
  ('outcomes','written_off','Written off',4,true,false,true,false)
) as s(object_key, key, label, sort_order, is_terminal, is_won, is_lost, is_qualified)
on conflict (org_id, object_key, key) do nothing;

comment on table public.pipeline_stages is
  'Per-org pipeline stages for leads/jobs/outcomes. Semantic flags (is_won/is_lost/is_terminal/is_qualified) exist so reporting never keys on a renameable label.';

-- supabase/migrations/20260727190000_org_trials.sql
--
-- Trial lifecycle on the per-org plan row (BSR-500, shape decided in BSR-497):
-- 14 days, no card, Pro-level capability with a hard $10 spend allowance. At
-- expiry the workspace goes READ-ONLY — agent work and outbound stop, data stays
-- visible and intact. Nothing is ever deleted by a lapsed trial.
--
-- The trial is keyed on org_id (org_plans' primary key), so "one trial per
-- organization" is a property of the schema rather than something to enforce in
-- application code.
--
-- Backwards compatibility matters here: every org that exists today has NULL
-- trial dates, and the resolver (src/domain/trial.ts) treats "no trial" as
-- phase="none" with readOnly=false. Existing workspaces are unaffected by this
-- migration — they do not retroactively acquire an expired trial.

alter table public.org_plans
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz,
  -- Which one-time trial notices have been emailed, e.g. {trial_t_minus_7,
  -- trial_expired}. Append-only; the keys come from `noticeKey()` in the domain
  -- module. Recording them here is what makes the warning job idempotent — a
  -- cron that runs twice in a day must not email the customer twice.
  add column if not exists trial_notices_sent text[] not null default '{}';

-- Finding trials that need a warning or an expiry notice is the cron's only
-- query: "rows with a trial that hasn't converted". Partial index keeps it off
-- the (eventually much larger) set of rows with no trial at all.
create index if not exists org_plans_trial_ends_at_idx
  on public.org_plans (trial_ends_at)
  where trial_ends_at is not null;

comment on column public.org_plans.trial_started_at is
  'When the free trial began (set at workspace creation). NULL = no trial ever started.';
comment on column public.org_plans.trial_ends_at is
  'When the free trial lapses. Past + no paid subscription = workspace is read-only.';
comment on column public.org_plans.trial_notices_sent is
  'One-time trial notice keys already emailed, so the warning job is idempotent.';

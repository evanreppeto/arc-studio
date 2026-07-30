-- Unlock the pipeline vocabulary: lead/job/outcome status enum -> text
-- (BSR-495, part 2 of 2).
--
-- ⚠️ DESTRUCTIVE DDL. `.github/workflows/migrate-prod.yml` REFUSES this by
-- design (`alter column ... type`). It must be applied by hand, with a backup
-- taken first and the restore path confirmed (BSR-532). Do not expect the
-- automation to pick it up.
--
-- Part 1 (20260729160000) created `pipeline_stages` and seeded every org with
-- today's values and their meanings. This removes the database-level lock so a
-- tenant can actually use its own stages: a firm whose pipeline is
-- Intake -> Conflicts check -> Engaged -> Closed could not store those values
-- at all, because Postgres rejected anything outside BSR's enum.
--
-- Follows 20260713120000_persona_taxonomy_per_org.sql exactly, which did this
-- for the persona columns. Existing values survive the cast verbatim — this is
-- a widening, so no backfill and no data can be lost by the conversion itself.
--
-- Verified before writing: no dependent views, no dependent functions, and the
-- only status check constraint on these tables is `leads_review_status_check`
-- on the separate (already text) `review_status` column. The three
-- `*_status_idx` indexes rebuild automatically.
--
-- Validation moves to the app layer, against the org's `pipeline_stages` — the
-- same place persona validation lives. Deliberately NO new check constraint
-- listing the old values: re-adding one would recreate the lock this removes.

-- 1. Drop the enum-literal defaults. They cannot survive the type change.
alter table public.leads    alter column status drop default;
alter table public.jobs     alter column status drop default;
alter table public.outcomes alter column status drop default;

-- 2. Widen to text. `::text` preserves every existing value exactly.
alter table public.leads    alter column status type text using status::text;
alter table public.jobs     alter column status type text using status::text;
alter table public.outcomes alter column status type text using status::text;

-- 3. Restore the defaults as text, unchanged in meaning. A new record still
--    lands in the same stage it does today.
alter table public.leads    alter column status set default 'new';
alter table public.jobs     alter column status set default 'pending';
alter table public.outcomes alter column status set default 'pending';

-- 4. The columns stay NOT NULL (that survives the type change). Add a
--    non-blank guard so the app cannot write an empty string where a stage key
--    belongs — "" would satisfy NOT NULL and match no stage, leaving a record
--    that renders as nothing and is invisible to every filter.
alter table public.leads
  drop constraint if exists leads_status_not_blank_check;
alter table public.leads
  add constraint leads_status_not_blank_check check (char_length(btrim(status)) > 0);

alter table public.jobs
  drop constraint if exists jobs_status_not_blank_check;
alter table public.jobs
  add constraint jobs_status_not_blank_check check (char_length(btrim(status)) > 0);

alter table public.outcomes
  drop constraint if exists outcomes_status_not_blank_check;
alter table public.outcomes
  add constraint outcomes_status_not_blank_check check (char_length(btrim(status)) > 0);

-- The enum TYPES are deliberately left in place, now unused. Dropping them is a
-- second destructive step with no benefit, and keeping them makes this easier to
-- reason about if the conversion ever has to be reviewed after the fact.

comment on column public.leads.status is
  'Pipeline stage key. Validated against the org''s pipeline_stages in the app layer, not by an enum — see BSR-495.';
comment on column public.jobs.status is
  'Pipeline stage key. Validated against the org''s pipeline_stages in the app layer, not by an enum — see BSR-495.';
comment on column public.outcomes.status is
  'Pipeline stage key. Validated against the org''s pipeline_stages in the app layer, not by an enum — see BSR-495.';

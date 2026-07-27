-- supabase/migrations/20260727200000_org_usage_notices.sql
--
-- Idempotency keys for usage (quota) notices — the 80% warning and the 100%
-- "allowance spent" notice (BSR-501).
--
-- Deliberately a SEPARATE column from `trial_notices_sent` rather than reusing
-- it, because the two have different lifetimes: a trial notice fires once, ever;
-- a usage notice must re-arm every billing period. Usage keys therefore carry
-- the period (e.g. `usage_80_2026-07`), so a new month is naturally a new key
-- and last month's entries simply stop matching.
--
-- Overloading one column would have made "has this been sent?" ambiguous between
-- the two rules and made pruning one set unsafe.

alter table public.org_plans
  add column if not exists usage_notices_sent text[] not null default '{}';

comment on column public.org_plans.usage_notices_sent is
  'Period-keyed usage notice keys already emailed (e.g. usage_80_2026-07), so the warning job is idempotent within a billing period and re-arms the next one.';

-- supabase/migrations/20260804100000_opportunities_dismissed_reason.sql
--
-- Record WHY an opportunity was dismissed (BSR-686).
--
-- Dismiss is the operator's most frequent judgement and it recorded nothing.
-- The table has `dismissed_at` but no reason, and `dismissOpportunity` had no
-- parameter for one, so 46 of prod's 134 opportunities sit dismissed with the
-- judgement behind them thrown away. Arc keeps proposing the same kinds; the
-- operator keeps declining them; nothing learns.
--
-- Text + CHECK rather than a Postgres enum, matching how `approval_items`
-- handles risk_level. An enum would need a migration to add a value, and this
-- vocabulary will grow as we learn which distinctions actually change Arc's
-- behaviour — a CHECK is a one-line edit, an enum is a type alteration.
--
-- The vocabulary is mirrored in `src/domain/dismissal-reasons.ts`. They must
-- stay in sync; the domain module is the source the UI and Arc read from, this
-- constraint is what stops a bad value reaching the row. A test pins the two
-- lists against each other so they cannot drift silently — the same failure
-- shape as BSR-687, where the code wrote a risk_level the CHECK had never
-- allowed and no mocked test could see it.
--
-- Nullable with no backfill and no default: the 46 already-dismissed rows have
-- no recoverable reason, and inventing one would be worse than the gap. They
-- stay NULL and are excluded from the aggregate rather than counted as
-- something they never were.
--
-- Additive: a new nullable column and a CHECK that every existing row satisfies
-- (all NULL). Verified against prod inside BEGIN…ROLLBACK before writing — the
-- constraint accepts all five values on the real 46 rows and rejects an
-- unlisted one with 23514.

alter table public.opportunities
  add column if not exists dismissed_reason text;

alter table public.opportunities
  drop constraint if exists opportunities_dismissed_reason_check;

alter table public.opportunities
  add constraint opportunities_dismissed_reason_check check (
    dismissed_reason is null
    or dismissed_reason = any (array[
      'not_relevant',
      'already_handled',
      'evidence_wrong',
      'not_worth_it',
      'bad_timing'
    ])
  );

comment on column public.opportunities.dismissed_reason is
  'Why the operator dismissed this, from the fixed vocabulary in src/domain/dismissal-reasons.ts. Null for dismissals recorded before the field existed, and for any dismissal where the operator did not say.';

-- The aggregate Arc reads is "this reason, on this kind, N times", so the index
-- covers exactly that grouping. Partial: only dismissed rows carry the column.
create index if not exists opportunities_dismissed_reason_idx
  on public.opportunities (org_id, kind, dismissed_reason)
  where dismissed_reason is not null;

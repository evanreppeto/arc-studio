-- supabase/migrations/20260805100000_guardrail_finding_fix.sql
--
-- What a finding needs from the human, when the answer is one value (BSR-743).
--
-- The claims reviewer already finds these. From the live campaign card: the CTA
-- reads "Call [24/7 line]", the reviewer correctly refuses to let a placeholder
-- ship, and the operator is then told about it in prose and left to go and edit
-- the copy themselves — retyping the value the finding already told them was
-- missing. Robby's note on it was "what is the number that you want there?
-- Okay, cool, here's the number. Sweet, let's do it."
--
-- To close that loop the row has to carry two things the message cannot: the
-- exact substring to replace, and what to ask for. `matched_text` is the wrong
-- source for the first — it quotes the whole sentence the claim lives in
-- ("Call [24/7 line] — answered any hour."), and substituting a phone number
-- for that would delete the sentence.
--
-- Text + CHECK rather than an enum for `fix_kind`, matching
-- `approval_items.risk_level` and `opportunities.dismissed_reason`: adding a
-- sixth input hint should be a one-line edit, not a type alteration. The
-- vocabulary is mirrored in src/domain/inline-fix.ts and a test pins the two
-- lists together so they cannot drift.
--
-- ALL-OR-NOTHING is the load-bearing constraint. A row with a target and no
-- label renders an input asking for nothing; a label with no target renders a
-- button that cannot do anything. Both are the "looks wired, does nothing"
-- failure this app keeps relapsing into, and both are unrepresentable now.
--
-- Nullable and defaulted off, because the 11 findings already in prod were
-- written before any of this existed and no migration can invent a target for
-- them. Absence is the normal case, not a defect — the UI reads it as "this
-- finding is prose, show it the way it always was".

alter table public.guardrail_findings
  add column if not exists fix_target text,
  add column if not exists fix_label text,
  add column if not exists fix_kind text;

comment on column public.guardrail_findings.fix_target is
  'The exact substring of the draft to replace, e.g. "[24/7 line]". NOT matched_text, which quotes the whole claim. Null when the finding does not reduce to one value.';
comment on column public.guardrail_findings.fix_label is
  'What to ask the operator for, in their words: "The real 24/7 phone number".';
comment on column public.guardrail_findings.fix_kind is
  'Input hint only — never validation the app relies on. Mirrored in src/domain/inline-fix.ts.';

alter table public.guardrail_findings
  drop constraint if exists guardrail_findings_fix_kind_check;
alter table public.guardrail_findings
  add constraint guardrail_findings_fix_kind_check
  check (fix_kind is null or fix_kind in ('text', 'phone', 'url', 'date', 'address'));

-- A fix is a target AND a label, or it is nothing at all.
--
-- The `is not null` pair is load-bearing, not belt-and-braces. Written as just
-- `length(btrim(fix_target)) > 0 and length(btrim(fix_label)) > 0`, a row with a
-- target and a NULL label evaluates to `false OR (true AND NULL)` = NULL — and a
-- CHECK constraint ACCEPTS null, it only rejects false. So the first version of
-- this let exactly the row it exists to stop straight through. Caught by running
-- it against real Postgres; no mock can see a constraint at all.
alter table public.guardrail_findings
  drop constraint if exists guardrail_findings_fix_complete_check;
alter table public.guardrail_findings
  add constraint guardrail_findings_fix_complete_check
  check (
    (fix_target is null and fix_label is null)
    or (
      fix_target is not null and fix_label is not null
      and length(btrim(fix_target)) > 0 and length(btrim(fix_label)) > 0
    )
  );

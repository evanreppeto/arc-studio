-- What a campaign IS: outbound work, or a batch of creative.
--
-- ADDITIVE ONLY. One nullable column and a CHECK. No type changes, no backfill,
-- no UPDATE against live rows, so .github/workflows/migrate-prod.yml can apply
-- it unattended.
--
-- ## The problem
--
-- Studio cannot make approval-gated creative without attaching it to a
-- campaign — `generateStudioDraft` hard-fails with `no_campaign`, because the
-- campaign IS the approval gate. So a workspace that generates images
-- accumulates campaign rows holding nothing but generation prompts, and they
-- land in the board's "Needs you" queue beside real outbound work. On the live
-- workspace that was half the queue.
--
-- The board already separates them (#1028) by DERIVING: a campaign whose
-- deliverables are all `image_prompt`/`video_prompt` is a batch. That works and
-- it ships. This column exists because derivation has one failure that cannot
-- be fixed by a better rule.
--
-- ## Why a column, when the rule already works
--
-- Contents change over time, so a contents-derived answer changes with them.
-- Prod has a campaign that held `email, image_prompt, social_ad` yesterday and
-- holds `email, image_prompt, social_ad, video_prompt` today. If Arc writes the
-- creative BEFORE the copy — and it often does — that campaign is briefly
-- all-creative, files itself under "Creative from Studio", and moves to the
-- approval queue later when the email lands. The operator sees work appear in
-- one place and reappear in another.
--
-- Intent does not change. A campaign created to hold submitted variants was a
-- creative batch the moment it existed, whatever it accumulates afterwards.
-- That is what this records.
--
-- ## Why NULLABLE, and why no backfill
--
-- NULL means "nobody declared it — work it out from the contents", which is
-- exactly what the app does today and does correctly. So:
--
--   * every existing row keeps its current, correct classification with no
--     UPDATE run against production;
--   * new rows carry intent where the writing route actually knows it;
--   * a route that does not know stays silent rather than guessing, and the
--     derivation answers.
--
-- A `not null default 'campaign'` would have been worse in a specific way: it
-- makes "nobody said" indistinguishable from "somebody said campaign", so the
-- derivation could never be consulted again and every existing batch would need
-- a backfill UPDATE to avoid regressing into the approval queue.
--
-- ## Not tenant-configurable
--
-- Per src/domain/pipeline-stages.ts: per-org if it describes the tenant's
-- process, never if the code branches on it. The board branches on this to
-- decide which heading a row sits under, so it is app machinery — a fixed pair
-- of values, guarded by a CHECK, not a table a workspace can add rows to.

alter table public.campaigns add column if not exists kind text;

-- Postgres has no `add constraint if not exists`; the guard makes this
-- re-runnable, which matters because the prod ledger and a local reset can
-- apply the same file twice.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'campaigns_kind_check'
  ) then
    alter table public.campaigns
      add constraint campaigns_kind_check
      check (kind is null or kind in ('campaign', 'creative_batch'));
  end if;
end $$;

comment on column public.campaigns.kind is
  'What this campaign is: ''campaign'' (outbound work) or ''creative_batch'' (generated creative only). NULL means undeclared — the app derives it from the deliverables. Set at creation by routes that know; never inferred onto a row after the fact.';

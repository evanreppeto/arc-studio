-- supabase/migrations/20260803220000_approval_items_media_asset_subject.sql
--
-- Let an approval row actually BE about a media asset (BSR-687).
--
-- 20260728150000 added `approval_items.media_asset_id` so assets could be
-- approved through the same table as campaigns. It added the column and its
-- index, and stopped there — `approval_items_subject_check` was never widened
-- to accept the new subject:
--
--   CHECK (campaign_id IS NOT NULL OR campaign_asset_id IS NOT NULL
--       OR company_id IS NOT NULL OR contact_id IS NOT NULL
--       OR property_id IS NOT NULL OR lead_id IS NOT NULL)
--
-- A media-asset approval sets none of those six, so every insert
-- `decideAssetApproval` attempts violates the constraint. Paired with a second
-- bug in the caller (it wrote risk_level 'elevated'/'standard', neither of which
-- passes approval_items_risk_level_check), asset approval could never have
-- succeeded — which is why `approval_items.media_asset_id` has zero rows and
-- always has. Nothing caught it because the unit tests mock the client, and a
-- mock does not enforce check constraints; the feature simply had no caller
-- until the Library's "Resolve & approve" button was wired.
--
-- This is a widening only: every row that satisfied the old predicate satisfies
-- the new one, so it cannot fail on existing data and needs no backfill.
-- Verified against prod inside BEGIN…ROLLBACK before writing: the insert fails
-- without this change and succeeds with it.
--
-- RLS is untouched — approval_items is already org-scoped and this alters a
-- CHECK, not a policy.

alter table public.approval_items
  drop constraint if exists approval_items_subject_check;

alter table public.approval_items
  add constraint approval_items_subject_check check (
    campaign_id is not null
    or campaign_asset_id is not null
    or company_id is not null
    or contact_id is not null
    or property_id is not null
    or lead_id is not null
    or media_asset_id is not null
  );

comment on constraint approval_items_subject_check on public.approval_items is
  'An approval row must be about something: a campaign, a campaign asset, a CRM record, or a media asset.';

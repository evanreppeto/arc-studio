-- supabase/migrations/20260728150000_approval_items_media_asset.sql
--
-- Asset approval reuses `approval_items` (BSR-538, decided on BSR-514 as
-- Option A) rather than adding review columns to `media_assets`.
--
-- The approval gate is the product's core invariant and gets exactly ONE
-- implementation: a reviewer asking "why did this go out?" must find assets and
-- campaigns in the same audit trail. Per-table review columns would have been a
-- second copy of the concept, and second copies drift.
--
-- `approval_items` already carries item_type, status, reviewed_by, reviewed_at,
-- decision_notes, risk_level, compliance_notes and org_id. It has
-- campaign_asset_id but no media_asset_id — that single FK is the only
-- structural gap, which is why this migration is one column and an index rather
-- than a new subsystem.
--
-- RLS is inherited: adding a column to an existing table does not change its
-- policies, and approval_items is already org-scoped.

alter table public.approval_items
  add column if not exists media_asset_id uuid references public.media_assets(id) on delete cascade;

-- The only lookup this adds: "the approval row(s) for this asset, newest first".
-- Partial, because the overwhelming majority of approval_items are campaign work
-- and carry NULL here.
create index if not exists approval_items_media_asset_idx
  on public.approval_items (media_asset_id, created_at desc)
  where media_asset_id is not null;

comment on column public.approval_items.media_asset_id is
  'The media asset under review, when item_type = ''media_asset''. Null for campaign approvals.';

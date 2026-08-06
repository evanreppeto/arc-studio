-- supabase/migrations/20260805210000_backfill_campaign_media_library_rows.sql
--
-- Give already-produced campaign creative a Library row, so it can be reviewed.
--
-- A picture attached to a campaign is a JSON entry on
-- `campaign_assets.audit_payload.media_assets[]`, which carries no database
-- identity. Everything durable said ABOUT an image — its review state, an
-- operator's decision on it — hangs off a `media_assets` row, resolved from the
-- entry by `library_asset_id` when recorded and otherwise by `storage_path`.
--
-- `recordGeneratedMedia` (BSR-634) writes that row, and until today only
-- `generate-image` and `generate-video` called it. `compose/route.ts` and all
-- three Studio writers stored their bytes and promoted a campaign asset without
-- one. Measured here before writing this: of the campaign media on prod, every
-- generated image resolved to a row and no composite did — so composites were
-- the creative an operator could look at and could not act on, which is exactly
-- the image that prompted the work.
--
-- The code fix is forward-only. This is the backfill for what already exists.
--
-- Deriving, not inventing:
--   * bytes and mime come from `storage.objects` — the object itself, so no
--     number here is a guess. An entry whose object is gone is skipped by the
--     join rather than given a fabricated size.
--   * org and workspace come from the owning `campaign_assets` row (both NOT
--     NULL on every row), never parsed out of the storage path.
--   * `available_to_arc` is FALSE, matching `recordStoredAsset`: this creative
--     has not been reviewed, and letting Arc reuse it would route unreviewed
--     output straight into the next campaign.
--
-- Idempotent: skips any path that already has a row, so a re-run is a no-op and
-- it cannot double-insert if a generator races it. Inserts only — nothing here
-- updates or deletes an existing row.
--
-- Verified against prod inside BEGIN…ROLLBACK before being written: it inserts
-- exactly the missing composites, leaves already-resolved media untouched, and
-- the campaign surface's own join then reports them as reviewable.

insert into public.media_assets (
  org_id,
  workspace_id,
  file_name,
  storage_path,
  public_url,
  content_type,
  kind,
  byte_size,
  source,
  provenance,
  risk_flags,
  tags,
  available_to_arc,
  uploaded_by
)
select distinct on (entry.path)
  ca.org_id,
  ca.workspace_id,
  -- The deliverable's own title, which is what the operator already calls this
  -- picture, with the object's extension. Falls back to the file's basename.
  -- Trailing dots are trimmed off the title first: several real titles end in a
  -- full stop, and "One team, from mitigation to rebuild..png" is not a name
  -- anyone wants to see in their Library.
  coalesce(nullif(btrim(btrim(ca.title), '.'), ''), split_part(entry.path, '/', -1))
    || case
         when position('.' in split_part(entry.path, '/', -1)) > 0
           then '.' || split_part(split_part(entry.path, '/', -1), '.', 2)
         else ''
       end as file_name,
  entry.path,
  entry.url,
  coalesce(obj.metadata ->> 'mimetype', 'image/png') as content_type,
  case when coalesce(obj.metadata ->> 'mimetype', '') like 'video/%' then 'video' else 'image' end as kind,
  nullif(obj.metadata ->> 'size', '')::bigint as byte_size,
  -- Constrained by media_assets_source_check; anything unexpected in the blob
  -- becomes 'composite' rather than failing the migration on one odd row.
  case
    when entry.source = 'ai_generated' then 'ai_generated'
    when entry.source = 'uploaded' then 'uploaded'
    else 'composite'
  end as source,
  jsonb_strip_nulls(jsonb_build_object(
    'generator', 'arc',
    'model', entry.model,
    'jobId', entry.job_id,
    'format', entry.format,
    'backfilled_from', 'campaign_assets.audit_payload'
  )) as provenance,
  coalesce(entry.risk_flags, '{}'::text[]) as risk_flags,
  array[case when entry.source = 'ai_generated' then 'ai-generated' else 'composite' end]::text[] as tags,
  false as available_to_arc,
  'arc' as uploaded_by
from public.campaign_assets ca
cross join lateral (
  select
    m ->> 'path' as path,
    m ->> 'url' as url,
    m ->> 'source' as source,
    m ->> 'model' as model,
    m ->> 'job_id' as job_id,
    m ->> 'format' as format,
    case
      when jsonb_typeof(m -> 'risk_flags') = 'array'
        then array(select jsonb_array_elements_text(m -> 'risk_flags'))
      else null
    end as risk_flags
  from jsonb_array_elements(ca.audit_payload -> 'media_assets') m
) entry
join storage.objects obj
  on obj.bucket_id = 'campaign-media'
 and obj.name = entry.path
where jsonb_typeof(ca.audit_payload -> 'media_assets') = 'array'
  and entry.path is not null
  and entry.url is not null
  -- The idempotency guard, and the reason a re-run is a no-op.
  and not exists (
    select 1 from public.media_assets ma where ma.storage_path = entry.path
  )
order by entry.path, ca.created_at;

comment on table public.media_assets is
  'Library rows for stored media. Every producer that writes an object must write one of these too — without it the picture has no identity, so nothing can record its review state or a decision on it.';

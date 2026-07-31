-- Signup-source attribution (BSR-586): which channel produced a waitlist signup
-- or a workspace.
--
-- Stored as jsonb rather than a column per UTM param. The shape is owned and
-- validated by `src/domain/signup-attribution.ts` (parseAttributionRecord), the
-- fields are always read together, and a jsonb column means adding a dimension
-- later is not a migration on two tables.
--
-- Shape: { firstTouch: Touch, lastTouch: Touch } where Touch is
--   { source, medium, campaign, term, content, referrerHost, landingPath, at }
--
-- PRIVACY: this holds CHANNEL data, not people. The referrer is reduced to its
-- host and the landing path drops its query string before it ever reaches here
-- (see the privacy note at the top of the domain module). No email, name, or IP
-- is written into these columns.
--
-- Default '{}' rather than null so every read gets an object and callers do not
-- branch on null; an empty object parses to null in the domain layer, which is
-- the "unattributed" case.

alter table public.waitlist_signups
  add column if not exists attribution jsonb not null default '{}'::jsonb;

alter table public.workspaces
  add column if not exists attribution jsonb not null default '{}'::jsonb;

-- Reporting groups by first-touch channel. A GIN index on the whole column
-- serves that and any later dimension without another migration; these tables
-- are small enough that the write cost is irrelevant.
create index if not exists waitlist_signups_attribution_idx
  on public.waitlist_signups using gin (attribution);

create index if not exists workspaces_attribution_idx
  on public.workspaces using gin (attribution);

comment on column public.waitlist_signups.attribution is
  'Signup-source attribution (BSR-586). Channel data only — never PII. Shape owned by src/domain/signup-attribution.ts.';

comment on column public.workspaces.attribution is
  'Signup-source attribution (BSR-586). Channel data only — never PII. Shape owned by src/domain/signup-attribution.ts.';

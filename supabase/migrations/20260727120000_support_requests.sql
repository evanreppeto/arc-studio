-- In-app support requests: the "something's broken / I need a human" path.
--
-- Org-scoped (unlike waitlist_signups, which is deliberately platform-level):
-- a request belongs to the workspace that raised it, so teammates can see what
-- their own workspace has already reported and nobody sees another tenant's.
--
-- Writes go through the service-role admin client from a requireOperator()-gated
-- server action. Reads from the authenticated UI are gated by RLS +
-- app_private.is_org_member, matching the journey tables. No anon grants.
--
-- The category/impact/status values below are mirrored in src/domain/support.ts
-- (SUPPORT_CATEGORIES / SUPPORT_IMPACTS / SUPPORT_STATUSES) — keep them in sync.

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid,
  -- Who raised it. Denormalized on purpose: a request must stay readable and
  -- repliable even if the member is later removed from the workspace.
  submitted_by_user_id uuid,
  submitted_by_email text,
  submitted_by_name text,
  category text not null,
  impact text not null default 'slowing',
  subject text not null,
  body text not null,
  -- The in-app route the operator was on, when they let us capture it.
  page_path text,
  -- Volunteered browser/build context (user agent, viewport, timezone, build
  -- sha). Shown to the operator before they submit — never collected silently.
  diagnostics jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  -- False when the notification email couldn't be sent (Resend unconfigured or
  -- failing). The row is still the durable record; this flags what needs a sweep.
  notified boolean not null default false,
  resolution_note text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone,
  constraint support_requests_category_check
    check (category in ('bug', 'question', 'feature', 'billing', 'other')),
  constraint support_requests_impact_check
    check (impact in ('blocking', 'slowing', 'minor')),
  constraint support_requests_status_check
    check (status in ('open', 'acknowledged', 'resolved', 'closed'))
);

create index if not exists support_requests_org_created_idx
  on public.support_requests (org_id, created_at desc);
create index if not exists support_requests_open_idx
  on public.support_requests (org_id, status)
  where status in ('open', 'acknowledged');

alter table public.support_requests enable row level security;

create policy support_requests_org_member_select on public.support_requests
  as permissive for select to authenticated
  using ((select app_private.is_org_member(support_requests.org_id)));

grant select, insert, update, delete on public.support_requests to service_role;
grant select on public.support_requests to authenticated;

-- Address-keyed email suppression register (BSR-482).
--
-- WHY A TABLE AND NOT THE COLUMN WE ALREADY HAD
--
-- Suppression has lived since 2026-07-10 in one nullable column,
-- `contacts.email_unsubscribed_at`. That column is keyed by CONTACT, and an
-- opt-out is a fact about an ADDRESS. The difference is not academic:
--
--   * Re-import a contact and the new row has a NULL timestamp — the person who
--     opted out is emailable again. BSR-481 is about to load real recipients,
--     and re-importing is expected to be routine.
--   * Two contact rows sharing one address (a shared office inbox, a duplicate)
--     suppress independently. One of them still sends.
--   * A bounce or complaint arrives from the provider identified by address,
--     not by our contact id.
--
-- It also cannot answer "why". The operator UI this ticket requires has to say
-- "unsubscribed 3 weeks ago" versus "the mailbox hard-bounced" versus "you added
-- them by hand after a phone call", and a lone timestamp carries none of that.
--
-- `contacts.email_unsubscribed_at` is deliberately KEPT and dual-written: it
-- still backs the `contacts_emailable_idx` partial index and reads as the
-- contact-level flag in the CRM. This table is the authority; the column is a
-- denormalization of it.
--
-- ORG-OWNED, NOT WORKSPACE-OWNED
--
-- Classified "org" in supabase/tenancy-contract.mjs alongside `contacts`. This
-- is a correctness argument, not a convention: if two workspaces in one company
-- could disagree about whether someone opted out, one of them is emailing a
-- person who said stop. An opt-out holds company-wide.

create table if not exists public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  -- Normalized lowercase, trimmed. `normalizeEmailAddress` in
  -- src/domain/email-suppression.ts owns the normalization and MUST agree with
  -- resolveCampaignAudience, or a suppressed address slips past a case
  -- difference.
  email text not null,
  reason text not null,
  -- Who or what suppressed it: 'recipient' (clicked unsubscribe), 'resend'
  -- (provider webhook), or an operator's name for a manual add.
  source text not null default 'system',
  -- Free text shown under the reason, e.g. the provider's bounce classification.
  detail text,
  -- Best-effort link back to the CRM record. ON DELETE SET NULL on purpose:
  -- deleting the contact must NOT delete the suppression, or removing someone
  -- from the CRM would silently make them emailable again.
  contact_id uuid references public.contacts (id) on delete set null,
  created_at timestamp with time zone not null default now(),
  constraint email_suppressions_reason_check
    check (reason in ('unsubscribe', 'bounce', 'complaint', 'manual')),
  constraint email_suppressions_org_email_uniq unique (org_id, email)
);

-- The operator register reads newest-first within an org.
create index if not exists email_suppressions_org_created_idx
  on public.email_suppressions (org_id, created_at desc);

alter table public.email_suppressions enable row level security;

create policy email_suppressions_org_member_select on public.email_suppressions
  as permissive for select to authenticated
  using ((select app_private.is_org_member(email_suppressions.org_id)));

grant select, insert, update, delete on public.email_suppressions to service_role;
grant select on public.email_suppressions to authenticated;

-- Backfill every existing opt-out. Contacts with no address can't be keyed by
-- one, so they keep working through the contact-id half of the check.
insert into public.email_suppressions (org_id, email, reason, source, detail, contact_id, created_at)
select c.org_id,
       lower(btrim(c.email)),
       'unsubscribe',
       'recipient',
       'Backfilled from contacts.email_unsubscribed_at.',
       c.id,
       c.email_unsubscribed_at
from public.contacts c
where c.email_unsubscribed_at is not null
  and c.email is not null
  and btrim(c.email) <> ''
on conflict (org_id, email) do nothing;

-- supabase/migrations/20260728160000_campaign_package_fields.sql
--
-- The last two fields of the campaign package contract (CLAUDE.md priority 3).
-- Package Builder v1 (BSR-358/359) delivered the brief, target audience, persona
-- logic, per-channel drafts, asset list, media references, guardrail result and
-- approval status. These two were never built:
--
-- 1. considered_audiences — the audiences Arc WEIGHED AND REJECTED, with the
--    reason. The package already says who it targets; it has never said who it
--    passed over. That is the difference between a recommendation and a
--    recommendation you can check: an operator approving a campaign should be
--    able to see that the obvious alternative was considered and why it lost,
--    rather than trusting that it was. Same "show the evidence" principle the
--    opportunity cards already follow.
--
-- 2. handoff_note — the note for the human who picks this up offline. Distinct
--    from the Arc deploy handoff in `lib/campaigns/launch.ts`: this is written
--    FOR a salesperson or referral partner ("lead with the moisture reading,
--    don't open on price"), not a machine signal.
--
-- Both are additive and nullable/defaulted, so existing campaigns are unchanged
-- and render exactly as before.

alter table public.campaigns
  add column if not exists considered_audiences jsonb not null default '[]'::jsonb,
  add column if not exists handoff_note text;

comment on column public.campaigns.considered_audiences is
  'Audiences weighed and not chosen, as [{label, reason, sizeEstimate?}]. Shows the operator what was passed over and why, so a targeting decision can be checked rather than trusted.';
comment on column public.campaigns.handoff_note is
  'Note for the human who continues this offline (sales or referral partner). Not the Arc deploy handoff — see lib/campaigns/launch.ts for that.';

-- Index the lookup every inbound Resend event performs.
--
-- `recordResendWebhookEvent` resolves an event to a dispatch with
--   select ... from campaign_dispatches where provider_message_id = <id>
-- and there was no index on that column, so every event was a sequential scan.
--
-- This matters more than the row count suggests, for a reason that isn't
-- obvious: the Resend webhook is registered per ACCOUNT, not per domain. Arc
-- Studio and the Big Shoulders Manager app send from different domains but
-- share one Resend account, so Arc Studio receives an event for every email
-- EITHER app sends. Each foreign event runs this same lookup, finds nothing,
-- and correctly declines to record — but it pays for the scan first.
--
-- So the scan count grows with total email volume across both apps, while the
-- table it scans grows with every dispatch ever made. Cheap now (9 rows),
-- quietly quadratic later.
--
-- Partial: rows without a provider_message_id can never match an inbound event,
-- and today most rows have none (2 of 9).

create index if not exists campaign_dispatches_provider_message_id_idx
  on public.campaign_dispatches (provider_message_id)
  where provider_message_id is not null;

comment on index public.campaign_dispatches_provider_message_id_idx is
  'Resolves inbound Resend webhook events to their dispatch. Hot path: fires for every email sent from the shared Resend account, including other apps.';

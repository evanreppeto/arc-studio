-- BSR-502 / Finding 5: every sub-half-cent call recorded as free.
--
-- `estimateClaudeCostCents` ended in `Math.round(cents)`, applied PER EVENT. Any
-- call costing under half a cent therefore stored zero. 13 of the 36 repriced
-- claude-sonnet-5 rows still hold $0.00 for exactly that reason — priced, just
-- individually too small to register.
--
-- It is not a rounding wobble that averages out over volume: it only ever rounds
-- DOWN to zero, never up, so the error is a systematic floor that grows with the
-- number of small calls. Short turns are what a chat-heavy product makes most of.
--
-- Cost is now computed and stored in microcents (1 cent = 1,000 microcents) and
-- rounded to cents exactly once, after summing, at display or at the cap check.
alter table public.ai_usage_events
  add column if not exists cost_microcents bigint;

-- DELIBERATELY NULLABLE, AND DELIBERATELY NOT BACKFILLED.
--
-- Backfilling `cost_estimate_cents * 1000` would look tidy and would be a lie:
-- it would stamp a precise-looking number onto rows whose precision was destroyed
-- at write time, and the 13 rows that floored to zero would be frozen at zero
-- forever while *appearing* exact. NULL honestly means "written before precision
-- was recorded". Readers coalesce to `cost_estimate_cents * 1000`, which gives the
-- same arithmetic without claiming the rows were measured that way.
--
-- Rows whose tokens and model rate allow an EXACT recomputation can be repaired
-- separately, as a deliberate data operation with an audit trail — the way the
-- claude-sonnet-5 reprice was done — not silently inside a schema migration.
comment on column public.ai_usage_events.cost_microcents is
  'Cost in microcents (1 cent = 1000). The precise value; `cost_estimate_cents` is this rounded. NULL = written before 2026-07-31, when only rounded cents existed — read as coalesce(cost_microcents, cost_estimate_cents * 1000). Never backfill it from cents and call it measured.';

comment on column public.ai_usage_events.cost_estimate_cents is
  'Whole cents, rounded from cost_microcents. Kept for existing readers. Do NOT sum this across events for billing — per-event rounding floors every sub-half-cent call to zero (BSR-502 Finding 5). Sum cost_microcents and round once.';

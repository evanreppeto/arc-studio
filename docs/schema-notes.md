# Arc Studio Schema Notes

## Core Objects

The initial Supabase migration creates the six-object CRM foundation for Arc Studio:

- `companies`
- `contacts`
- `properties`
- `leads`
- `jobs`
- `outcomes`

The schema keeps relationship fields nullable where real-world intake may arrive incomplete, but every foreign-key column has an index so dashboard joins and attribution queries have a sensible starting point.

## Persona Mapping

**Personas are per-org data, not a database enum.** Migration
`20260713120000_persona_taxonomy_per_org.sql` converted all 15 persona columns
from the `persona_mapping` enum to `text`, so each org's own `personas.slug` rows
define what is valid. Read them with `getOrgPersonaKeys` /
`getOrgPersonaOptions` (`src/lib/personas/read-model.ts`) and validate with
`isAllowedPersona(persona, allowedKeys)`.

New workspaces are seeded a starter pack chosen by the industry picked at
onboarding (`src/lib/personas/industry-templates.ts` — 8 verticals plus a neutral
`general` fallback), and the operator can add, rename, and archive them from the
Personas console.

The original 12 restoration personas survive in `OFFICIAL_PERSONA_MAPPINGS`
(`src/domain/personas.ts`) as the **demo-tenant seed and offline fallback only**.
They are not the validation authority — don't extend that list and don't validate
against it. The `persona_mapping` enum type still exists in the baseline
migration but no live column uses it.

`unassigned_persona` remains a reserved internal sentinel for legacy/admin
records.

## Ingestion Boundary

New lead ingestion must reject `unassigned_persona`. The database also enforces this with `leads_persona_not_unassigned_check` — re-created as a text check by the per-org persona migration and confirmed live on prod — so API code cannot accidentally persist a newly ingested lead without a verified persona.

`companies`, `contacts`, `properties`, `jobs`, and `outcomes` may temporarily use `unassigned_persona` for backfilled, legacy, or admin-created records where attribution is still being reconciled. AI routing and outbound messaging should treat this value as ineligible.

## Routing and Scoring Fields

`leads` includes fields for deterministic routing and scoring:

- `routing_recommendation`
- `loss_signals`
- `matched_target_keywords`
- `matched_non_target_keywords`
- `lead_score`

These fields are intentionally simple database primitives. The application layer should own the flood/water keyword classifier and scoring function so they remain deterministic, unit-testable, and easy to audit.

## Attribution Path

`outcomes` can link back through `job_id`, `lead_id`, `company_id`, `contact_id`, `property_id`, and `persona`. This supports later revenue attribution by persona, referring company, contact, property, and originating lead.

## Backend-First Growth Layer

The next schema layer turns the app into a Hermes-ready backend without requiring Hermes to exist yet.

Core operating tables:

- `persona_snapshots` stores the living hyper-persona profile for companies, contacts, properties, leads, jobs, outcomes, and campaigns.
- `persona_knowledge_entries` stores the base persona knowledge used for prompt grounding: fears, frustrations, desires, messaging angles, do-not-say rules, trigger signals, CTAs, and proof points.
- `personalization_rules` and `visitor_persona_contexts` store website/message personalization rules and the temporary session context created by URL/referral source detection.
- `engagement_events` stores the timeline feed for calls, forms, email, SMS, ads, reviews, website activity, partner referrals, and internal events.
- `campaigns`, `campaign_assets`, `campaign_audiences`, `campaign_events`, and `campaign_results` make campaigns first-class records from draft through attribution.
- `social_accounts` and `social_posts` cover the ContentStudio-style planner model: connected channels, scheduled posts, approval state, publish attempts, and calendar-ready dates.
- `approval_items` stores the active human review item, while `approval_decisions` stores every approve, decline, revision, archive, or block decision.
- `outbound_dispatches` is the dispatch gate. A public-facing send/publish attempt should be represented here with an idempotency key and must not be treated as safe just because UI state changed.
- `guardrail_rules` and `guardrail_findings` store coverage-neutral language checks, loss-classification blockers, and post-generation compliance findings.
- `agents`, `agent_tasks`, `agent_task_inputs`, `agent_outputs`, `agent_run_logs`, `agent_permissions`, and `agent_tool_requests` model agent work as queued backend records.
- `partner_health_snapshots`, `next_best_actions`, and `score_weight_configs` support explainable recommendations without hard-coding every scoring detail in the UI.
- `partner_referral_tokens` and `partner_referral_submissions` support authenticated partner intake and anomaly-friendly referral auditing.
- `nurture_sequences`, `nurture_enrollments`, and `tracking_links` support per-persona nurture sequences (one per persona in the org's own taxonomy), encrypted/signed recipient tracking, and 14-day suppression logic for weather-triggered messaging.
- `weather_events` and `weather_event_targets` store qualified weather alerts and the contacts/properties selected for geofenced response.
- `capacity_snapshots`, `ad_spend_decisions`, and `ad_platform_actions` store Manager-app capacity signals and deterministic budget throttle/re-route actions before any ad API write occurs.
- `external_systems`, `platform_events`, `external_object_mappings`, and `sync_conflicts` are the cross-platform event bus/interoperability layer for Marketing, Manager, and Business Development apps.
- `analytics_snapshots` stores precomputed reporting payloads for the dashboard and revenue views that need sub-500ms reads.
- `rejected_intake_events` preserves malformed or ineligible intake payloads for audit without creating `leads`.
- `integration_registry`, `competitor_apps`, `competitor_features`, and `software_research_notes` keep external tools, Linear research, app comparisons, and product decisions visible.

## Approval State Model

Approval is a backend state machine, not a UI decoration.

Useful states:

- `draft`
- `needs_compliance`
- `pending_approval`
- `pending_owner_approval`
- `approved`
- `declined`
- `rejected`
- `revision_requested`
- `needs_revision`
- `blocked`
- `archived`

`approval_items.status` is the current state. `approval_decisions` is the history. Approved assets may become eligible for export, scheduling, or launch later. Declined, rejected, blocked, or archived assets must stay unavailable.

Approval alone should not send anything. The later dispatch worker should create or claim an `outbound_dispatches` row with a unique `idempotency_key`, verify the approval item is still approved, and only then call an external provider. That is the backend equivalent of the ContentStudio planner/approval wall.

## Hyper-Persona Details

`persona_snapshots` should stay explainable rather than becoming a black box.

Important fields:

- `persona`
- `hyper_persona_summary`
- `relationship_stage`
- `value_tier`
- `dominant_loss_pattern`
- `preferred_channel`
- `message_posture`
- `recommended_offer`
- `next_best_action`
- `confidence_score`
- `risk_flags`
- `situation_context`
- `relationship_context`
- `behavior_context`
- `value_context`
- `channel_context`
- `message_context`
- `capacity_context`
- `reasoning_payload`

Only official personas are allowed for new AI routing. `unassigned_persona` remains internal-only.

## Hermes Integration Boundaries

Hermes should be added last, after the backend tables and APIs are stable.

The first Hermes-facing API layer should expose:

- CRM reads and validated intake writes.
- Approval queue reads, decision writes, and dispatch eligibility checks.
- Persona knowledge and current snapshot reads.
- Campaign, social planner, and nurture sequence drafts in locked states.
- Weather/capacity events as inputs, not direct external actions.
- Platform events and object mappings for cross-app synchronization.

Hermes should not get direct permission to publish, send, spend, or alter public pages until those actions are represented as approved backend state transitions.

## Security Default

All public-schema tables should have RLS enabled from the first migration. The app can still use server-side service-role access while real user roles and policies are designed later, but tables should not be left openly exposed by accident.

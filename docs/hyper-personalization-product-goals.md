# Hyper-Personalization Product Goals

## Working Prompt

Use this prompt when asking an AI agent to enhance Arc Studio:

```text
You are helping build the Big Shoulders Restoration Arc Studio, a standalone Next.js and Supabase martech application for a restoration company.

Before proposing or writing code, inspect the current app and preserve its existing product boundaries:
- The core data foundation is companies, contacts, properties, leads, jobs, and outcomes.
- The official persona system must remain the base taxonomy.
- `unassigned_persona` is internal-only and must never be accepted for new lead ingestion or AI routing.
- The product should stay focused on flood, water backup, burst pipe, storm surge, standing water, mold, sewage, fire, and related restoration demand. Hail-only, wind-only, exterior-only roof, and unrelated remodeling workflows should be downgraded, isolated, or blocked from campaign generation.
- Outbound marketing must remain coverage-neutral. Do not generate or publish copy that promises insurance coverage, claim approval, or payout outcomes.

Goal:
Enhance Arc Studio from a static persona CRM into a hyper-personalized marketing operating system. The app should understand each person, company, property, partner, lead, and campaign at a living profile level, then recommend the next best message, channel, offer, and action with human approval before anything external is sent.

Research and incorporate useful patterns from modern marketing, home-service, and local-service software such as HubSpot, ServiceTitan Marketing Pro, CallRail, Podium, Hatch, Birdeye, HighLevel, ActiveCampaign, Google Business Profile workflows, Google Ads, and weather intelligence tools. Do not copy their generic product model blindly. Translate the useful ideas into a restoration-specific system for Big Shoulders Restoration.

Design and implementation priorities:
1. Add a persona intelligence layer above the official base personas.
2. Add hyper-persona snapshots for contacts, companies, properties, leads, jobs, outcomes, and campaigns.
3. Add engagement events and timeline views for email, SMS, call, form, website, review, social, ad, and partner-referral activity.
4. Add campaign objects that connect persona, loss focus, offer, channel, assets, approval state, and attribution.
5. Add next-best-action logic that uses urgency, relationship stage, engagement, revenue, partner health, and current business capacity.
6. Add a human approval queue with prompt inputs, generated output, compliance status, edit controls, and dispatch lock.
7. Add competitor/software intelligence so the team can track what other apps do, what tools they use, what features are worth adapting, and what demos or screenshots still need review.
8. Add integration readiness for call tracking, form tracking, SMS, email, reviews, ads, Google Business Profile, Linear, Google Drive, Supabase, and analytics.
9. Add reporting that ties campaigns, personas, partners, sources, jobs, outcomes, margin, and response time together.

When proposing changes, return:
- A concise product thesis.
- The exact app modules or routes to add/change.
- The proposed data model additions.
- The user workflows enabled.
- The competitor/app pattern being adapted.
- The safest implementation sequence.
- Tests or verification needed.
- Risks, open questions, and what should stay out of scope.
```

## North Star

The Arc Studio should become a restoration-specific persona intelligence and campaign execution system.

The app should not stop at assigning a contact to `persona_insurance_agent` or `persona_plumbing_partner`. It should create a living, explainable profile that answers:

- Who is this person or organization?
- What do they care about right now?
- What loss situation, property context, or partner context are they connected to?
- What have they done recently?
- How valuable is the relationship?
- What is the safest next action?
- What message, channel, offer, and proof point should be used?
- What must be reviewed by a human before anything is sent?

## Product Thesis

Generic marketing apps automate campaigns. The Arc Studio should understand restoration context.

The differentiator is not "AI marketing." The differentiator is a system that knows the difference between an emergency homeowner with standing water, an insurance agent needing coverage-neutral documentation, a plumbing partner who has not referred in 42 days, and a property manager watching multiple buildings after a storm.

## Current Foundation

The current application already has the right base layer:

- Six CRM objects: companies, contacts, properties, leads, jobs, and outcomes.
- Official persona mappings.
- Internal-only `unassigned_persona` fallback.
- Lead ingestion validation.
- Flood and water-loss routing.
- Deterministic lead and partner scoring.
- AI Studio campaign workspace mockups.
- Reports and attribution mockups.
- Supabase schema foundation.

The next phase should build on this foundation rather than replacing it.

## Hyper-Persona Model

A base persona is the top-level category. A hyper-persona is the current operating profile.

Example:

```json
{
  "basePersona": "persona_insurance_agent",
  "relationshipStage": "warm_partner",
  "valueTier": "high",
  "recentBehavior": "dormant_30_days",
  "dominantLossPattern": "basement_water_backup",
  "preferredChannel": "email",
  "messagePosture": "concise_documentation_first",
  "recommendedOffer": "coverage_neutral_referral_packet",
  "nextBestAction": "send_agent_documentation_packet",
  "riskFlags": ["coverage_neutral_language_required"],
  "generatedAt": "ISO timestamp"
}
```

## Persona Intelligence Dimensions

The app should score or classify each record across these dimensions:

- Base persona: official persona enum.
- Situation context: active water, standing water, burst pipe, storm event, property type, urgency, after-hours signal.
- Relationship context: cold lead, warm referral, active partner, dormant partner, high-value source, low-quality source.
- Behavior context: email opens, SMS replies, form submissions, call activity, referral submissions, review activity, document downloads.
- Value context: revenue, margin, conversion rate, referral quality, job outcomes, response time.
- Channel context: preferred channel, last successful channel, blocked channel, compliance risk.
- Message context: CTA, offer, proof points, tone, forbidden claims, approval status.
- Capacity context: business state such as high capacity with low volume or low capacity with high volume.

## App Modules To Add Or Enhance

### Persona Intelligence

Goal: Make hyper-personalization visible and editable.

Needed:

- Add a Persona Intelligence route or section.
- Show base persona, hyper-persona snapshot, confidence, last updated time, and reasoning.
- Add snapshot panels to CRM detail pages.
- Add controls for admins to correct or override profile assumptions.

### Engagement Timeline

Goal: Give every contact, company, lead, and campaign a unified activity stream.

Needed:

- Add `engagement_events`.
- Add `/api/v1/events/ingest`.
- Track email, SMS, call, form, web, ad, review, social, document, and partner referral events.
- Deduplicate scanner-like email opens.
- Render reverse-chronological timeline components.

### Campaign Objects

Goal: Treat campaigns as first-class operating records, not static mock data.

Needed:

- Add campaigns, campaign assets, campaign audiences, campaign events, and campaign results.
- Link campaigns to personas, loss focus, channels, assets, approvals, jobs, and outcomes.
- Track status from brief to approved to active to archived.

### Next Best Action

Goal: Recommend what the team should do next for each person, partner, lead, or campaign.

Needed:

- Combine lead score, partner score, engagement score, relationship score, revenue value, and capacity state.
- Output explainable actions such as call now, send partner packet, enter nurture stream, pause broad outreach, or request owner approval.
- Store the reason behind each recommendation.

### Approval And Guardrails

Goal: Keep AI useful without allowing unsafe outbound messages.

Needed:

- Add generated asset records with prompt input metadata.
- Run post-generation phrase filters and scope filters.
- Require human approval before dispatch.
- Allow owner edits before approval.
- Block insurance coverage promises and off-scope hail/wind-only campaigns.

### Competitor And Software Intelligence

Goal: Fulfill the BSR-163 research loop inside the product.

Needed:

- Track competitor apps, category, target user, features, screenshots, pricing notes, integrations, demo status, and takeaways.
- Add a feature matrix for HubSpot, ServiceTitan, CallRail, Podium, Hatch, Birdeye, HighLevel, ActiveCampaign, and other researched tools.
- Mark each feature as adapt, ignore, later, or already covered.
- Store demo notes and product screenshots as reference artifacts.

### Integration Registry

Goal: Make external tools visible as part of the operating system.

Needed:

- Add a registry for connected or planned tools.
- Track provider, purpose, sync direction, last event, auth status, owner, and risk.
- Initial categories: call tracking, form tracking, SMS, email, ads, reviews, Google Business Profile, CRM, analytics, weather intelligence, Linear, Google Drive, Supabase.

### Reporting And Attribution

Goal: Tie marketing activity to real business results.

Needed:

- Report revenue by persona, partner, source, campaign, and loss type.
- Track conversion from lead to job to outcome.
- Track response time by urgency tier.
- Track partner health over trailing 90 days.
- Track campaign asset performance by channel and audience.

## Useful Patterns From Other Apps

- HubSpot: object model, campaign workspace, workflows, record timelines, marketing attribution.
- ServiceTitan Marketing Pro: trades-specific customer and job data powering targeted campaigns and revenue attribution.
- CallRail: call/form attribution, source tracking, keyword tracking, lead journey.
- Podium: unified inbox, AI-assisted follow-up, reviews, fast local-service communication.
- Hatch: speed-to-lead, SMS/email automation, home-service sales follow-up.
- Birdeye: review generation, review marketing, local reputation, social proof.
- HighLevel: funnels, forms, messaging, automations, pipelines, agency-style campaign operations.
- ActiveCampaign: lead scoring, segmentation, site tracking, email automation.
- Google Business Profile and Ads: local demand capture, calls, forms, reviews, maps intent.
- Weather intelligence: storm and water-risk signals that inform readiness, targeting, and operational focus.

## Proposed Data Model Additions

Potential new tables:

- `persona_snapshots`
- `engagement_events`
- `campaigns`
- `campaign_assets`
- `campaign_audiences`
- `approval_items`
- `next_best_actions`
- `score_weight_configs`
- `partner_health_snapshots`
- `integration_registry`
- `competitor_apps`
- `competitor_features`
- `software_research_notes`

Potential important fields:

- `base_persona`
- `hyper_persona_summary`
- `confidence_score`
- `reasoning_json`
- `relationship_stage`
- `value_tier`
- `preferred_channel`
- `dominant_loss_pattern`
- `next_best_action`
- `approval_status`
- `compliance_status`
- `source_system`
- `external_event_id`
- `campaign_phase`
- `sync_status`

## Implementation Sequence

### Phase 1: Strategy And Research Capture

- Add this document as the working product goals file.
- Add a competitor/software intelligence schema draft.
- Create a research page or markdown matrix for apps and features.
- Decide which external systems matter first.

### Phase 2: Event And Timeline Foundation

- Add `engagement_events`.
- Add event ingestion validation.
- Render timeline previews on CRM detail pages.
- Add deduplication rules for noisy events.

### Phase 3: Persona Snapshots

- Add `persona_snapshots`.
- Generate deterministic snapshots from existing CRM, lead, score, loss, and event data.
- Show snapshot cards on contact, company, lead, and campaign views.
- Store reasoning JSON for auditability.

### Phase 4: Campaigns And Approvals

- Promote AI Studio campaign mockups into real campaign records.
- Add campaign assets and approval items.
- Add prompt input metadata views.
- Enforce human approval before activation.

### Phase 5: Next Best Action

- Add deterministic recommendation logic.
- Connect recommendations to CRM detail views and dashboard queues.
- Add admin-tunable score weights.
- Add executive capacity state inputs.

### Phase 6: Integration And Attribution

- Add integration registry.
- Connect call/form/SMS/email/review/ad events as integrations become available.
- Replace sample reports with live joins.
- Add revenue and margin attribution by persona, campaign, partner, and source.

## Open Questions

- Which external systems will Big Shoulders actually use first for calls, SMS, email, reviews, and ads?
- Should campaigns publish externally from this app, or should the app only prepare and approve assets?
- Which personas should get active nurture first?
- What is the minimum owner approval workflow that feels useful but not heavy?
- Which competitor tools should be demoed first?
- What weather data source is practical for the first version?
- How much auto-personalization is acceptable before a human must review?

## Backlog

Add new ideas below this line as they come up.

### New Ideas

- 

### Research Targets

- 

### Decisions Made

- 

### Deferred Ideas

- 

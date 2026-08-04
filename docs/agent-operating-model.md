# Agent Operating Model

## Goal

Build Arc Studio as a backend-first operating layer for the Hermes agent, with visible, accountable AI work that humans can inspect, approve, decline, revise, and measure.

Hermes is the primary operator. The web UI is the control room: it helps Hermes, Robby, and the team see the work, understand why it happened, and intervene when a human decision is required.

The app should not hide AI behind a generic "generate" button. It should show agent work clearly:

- What the agent is trying to do.
- Which records, personas, campaigns, and events it used.
- What it produced.
- What risk flags were found.
- What still needs human approval.
- What happened after the work was approved or rejected.

## Product Thesis

The Arc Studio should become an agentic marketing operations system for restoration.

Generic marketing software automates tasks. The Big Shoulders system should coordinate specialized agents that understand water-loss urgency, partner relationships, persona context, local demand, compliance rules, and owner approval gates.

The important difference is accountability. Every agent output should be inspectable, editable, and tied back to source data.

This app should not be designed as a traditional dashboard where humans drive every workflow. Most value should live in the backend contract: durable records, task queues, approvals, reasoning logs, compliance checks, and integration-ready APIs that Hermes can call. The UI exists for detailed views, approvals, debugging, and occasional operator control.

## Hermes Backend Contract

Hermes should be able to use the app as an operational backend:

- Read CRM, persona, campaign, approval, and task context through stable APIs.
- Create or update draft tasks, campaign briefs, and generated assets in non-public states.
- Attach prompt inputs, source records, reasoning summaries, compliance flags, and draft outputs.
- Route anything public-facing into approval instead of dispatching it directly.
- Receive clear machine-readable decisions after humans approve, decline, request revision, or archive an item.
- Treat UI actions as state transitions that update backend records, not as cosmetic preview actions once persistence is enabled.

The UI should expose the same contract humans need:

- What Hermes or a sub-agent did.
- Which data it used.
- What it produced.
- Why the output is recommended or blocked.
- What approval decision is needed.
- What happens after approval, decline, revision, or archive.

## ContentEngine-Style Approval Pattern

Use the ContentEngine-style review model for campaigns, ads, and other generated assets:

1. Hermes or an agent creates a draft campaign, ad, script, one-pager, post, or message.
2. The draft enters an approval queue with prompt input, source records, generated output, risk flags, and compliance notes.
3. A human can approve, decline, request revision, or archive.
4. Approve unlocks the asset for the next backend step, such as export, scheduling, dispatch eligibility, or campaign activation.
5. Decline keeps the asset blocked and records decision notes.
6. Request revision creates a new agent task linked to the original draft and approval item.
7. Archive removes the item from active review without making it usable.

Approval and decline are product-critical state changes. They should eventually be persisted as auditable records, not only URL query previews.

## Core Principle

Agents can recommend, draft, research, score, summarize, and prepare work.

Agents should not independently publish ads, send emails, send SMS, alter public landing pages, or make coverage-related claims without explicit approval.

## Agent Roles

### Persona Intelligence Agent

Purpose:

- Create and refresh hyper-persona snapshots.
- Explain who a contact, company, lead, or campaign is for.
- Identify relationship stage, value tier, recent behavior, preferred channel, message posture, and next best action.

Inputs:

- `companies`
- `contacts`
- `properties`
- `leads`
- `jobs`
- `outcomes`
- `engagement_events`
- persona taxonomy
- lead and partner scores

Outputs:

- `persona_snapshots`
- persona confidence score
- reasoning JSON
- recommended message posture
- next best action candidate

Human review:

- Required when a snapshot changes an outbound campaign or message.
- Optional when the snapshot is only used for internal prioritization.

### Campaign Strategy Agent

Purpose:

- Turn persona and business goals into campaign briefs.
- Recommend audiences, offers, channels, and proof points.
- Keep campaigns aligned to flood, water, sewage, mold, fire, and restoration demand.

Inputs:

- persona snapshots
- report metrics
- current campaign records
- lead source trends
- partner health
- weather or demand signals

Outputs:

- campaign brief
- target audience
- loss focus
- offer
- channels
- asset list
- expected measurement plan

Human review:

- Required before asset generation starts.

### Content Production Agent

Purpose:

- Draft campaign assets from approved briefs.
- Generate email, SMS, ad copy, landing-page copy, one-pagers, call scripts, review responses, Google Business posts, and creative prompts.

Inputs:

- approved campaign brief
- persona snapshot
- channel requirements
- approved tone and CTA
- guardrails

Outputs:

- `campaign_assets`
- asset variants
- prompt input metadata
- draft status

Human review:

- Required before any external dispatch or publishing.

### Compliance Agent

Purpose:

- Check every generated asset against BSR language rules.
- Block unsafe language before owner approval.
- Enforce coverage-neutral messaging.
- Block off-scope hail-only, wind-only, exterior-only roof, or unrelated remodeling campaigns.

Inputs:

- generated copy
- prompt metadata
- loss classification
- campaign loss focus
- persona snapshot
- restricted phrase rules

Outputs:

- compliance status
- risk flags
- blocked phrases
- suggested edits
- approval recommendation

Human review:

- Required for any medium or high risk item.

### Referral Growth Agent

Purpose:

- Grow insurance agent, plumbing partner, property manager, HOA, and other professional referral sources.
- Recommend partner packets, follow-ups, scripts, one-pagers, and reactivation campaigns.

Inputs:

- companies
- contacts
- partner score
- partner health snapshots
- closed outcome attribution
- engagement timeline
- referral history

Outputs:

- partner next best action
- referral campaign recommendation
- partner packet draft
- dormant-partner reactivation plan

Human review:

- Required before outbound communication.

### Local SEO Agent

Purpose:

- Recommend location and service content for BSR.
- Connect local search intent to actual restoration services.
- Generate Google Business post ideas and local page briefs.

Inputs:

- target loss keywords
- service area priorities
- lead source data
- Google Business events
- campaign performance
- competitor research

Outputs:

- page briefs
- Google Business post drafts
- local FAQ ideas
- internal linking recommendations
- review-response drafts

Human review:

- Required before publication.

### Paid Ads Agent

Purpose:

- Recommend paid search and paid social campaigns.
- Align ad groups with persona, loss focus, offer, and landing page.
- Avoid wasting spend on off-scope loss types.

Inputs:

- campaign brief
- loss routing rules
- reports
- call/form attribution
- weather and demand signals
- approval status

Outputs:

- ad group plan
- keyword list
- negative keyword list
- headline variants
- description variants
- landing page recommendation

Human review:

- Required before export or launch.

### Website Personalization Agent

Purpose:

- Recommend landing-page copy variations based on persona and source.
- Personalize CTAs and proof points for insurance agents, plumbing partners, homeowners, property managers, and other approved personas.

Inputs:

- URL parameters
- source channel
- persona snapshot
- campaign brief
- approved copy blocks

Outputs:

- personalization rules
- copy block recommendations
- CTA variants
- proof point variants

Human review:

- Required before new copy blocks become active.

### Reporting Agent

Purpose:

- Summarize campaign, persona, partner, and source performance.
- Explain why a campaign is winning or losing.
- Recommend budget, content, and partner follow-up changes.

Inputs:

- campaigns
- campaign assets
- engagement events
- leads
- jobs
- outcomes
- partner health
- response time

Outputs:

- performance summaries
- attribution notes
- recommended changes
- anomaly alerts

Human review:

- Required before strategy changes are applied.

### Competitor Intelligence Agent

Purpose:

- Track what other marketing apps, restoration apps, and local-service tools do well.
- Convert research into product decisions.

Inputs:

- competitor app records
- feature matrix
- demo notes
- screenshots
- pricing notes
- user observations

Outputs:

- feature recommendations
- adapt / ignore / later decision
- implementation notes
- competitor gap analysis

Human review:

- Required before adding features to the roadmap.

## Primary App Modules

### Agent Operations

Route:

- `/agent-operations`

Purpose:

- The central command center for all agent work.

Core UI:

- Agent cards.
- Active tasks.
- Blocked tasks.
- Awaiting approval.
- Recent outputs.
- Risk flags.
- Impact metrics.

Expected panels:

- Active agents.
- Agent work queue.
- Approval required.
- Recent completed work.
- Risk and compliance flags.
- Agent performance.

### Agent Detail

Route:

- `/agent-operations/[agentKey]`

Purpose:

- Show one agent's configuration, task history, outputs, and permissions.

Core UI:

- Agent purpose.
- Allowed actions.
- Blocked actions.
- Data sources.
- Recent task runs.
- Current prompts or instruction profile.
- Approval requirements.
- Output history.

### Agent Task Detail

Route:

- `/agent-operations/tasks/[taskId]`

Purpose:

- Show the complete audit trail for one agent task.

Core UI:

- Task objective.
- Input records.
- Prompt metadata.
- Agent reasoning summary.
- Output draft.
- Compliance checks.
- Approval status.
- Linked campaign, persona, CRM record, or asset.

### Approval Queue

Route:

- `/approvals`

Purpose:

- Centralize human review.

Core UI:

- Pending generated assets.
- Compliance warnings.
- Prompt inputs.
- Editable output.
- Approve, reject, request revision, or archive.

### Competitor Intelligence

Route:

- `/competitor-intelligence`

Purpose:

- Capture BSR-163 style research.

Core UI:

- Competitor apps.
- Feature matrix.
- Demo notes.
- Screenshot references.
- Feature decision status.
- Roadmap impact.

## Data Model

### `agents`

Stores the configured agent roles.

Fields:

- `id`
- `key`
- `name`
- `description`
- `status`
- `allowed_actions`
- `blocked_actions`
- `default_approval_policy`
- `system_instructions`
- `metadata`
- `created_at`
- `updated_at`

### `agent_tasks`

Stores each unit of work assigned to an agent.

Fields:

- `id`
- `agent_id`
- `status`
- `priority`
- `objective`
- `task_type`
- `source_type`
- `source_id`
- `campaign_id`
- `persona_snapshot_id`
- `approval_item_id`
- `due_at`
- `started_at`
- `completed_at`
- `metadata`
- `created_at`
- `updated_at`

Suggested statuses:

- `queued`
- `running`
- `blocked`
- `needs_approval`
- `completed`
- `failed`
- `canceled`

### `agent_task_inputs`

Stores source context used by the agent.

Fields:

- `id`
- `task_id`
- `input_type`
- `source_table`
- `source_id`
- `summary`
- `payload`
- `created_at`

### `agent_outputs`

Stores generated output.

Fields:

- `id`
- `task_id`
- `output_type`
- `title`
- `body`
- `structured_payload`
- `risk_level`
- `compliance_status`
- `approval_status`
- `created_at`
- `updated_at`

### `agent_run_logs`

Stores audit metadata.

Fields:

- `id`
- `task_id`
- `agent_id`
- `run_status`
- `model_provider`
- `model_name`
- `input_token_count`
- `output_token_count`
- `cost_estimate_cents`
- `reasoning_summary`
- `error_message`
- `started_at`
- `completed_at`
- `metadata`

### `approval_items`

Stores human review records.

Fields:

- `id`
- `source_type`
- `source_id`
- `status`
- `risk_level`
- `reviewer_id`
- `submitted_at`
- `reviewed_at`
- `prompt_inputs`
- `draft_output`
- `edited_output`
- `compliance_flags`
- `decision_notes`
- `created_at`
- `updated_at`

Suggested statuses:

- `draft`
- `needs_compliance`
- `pending_owner_approval`
- `approved`
- `rejected`
- `revision_requested`
- `archived`

### `agent_permissions`

Stores what each agent can and cannot do.

Fields:

- `id`
- `agent_id`
- `permission_key`
- `permission_type`
- `requires_approval`
- `created_at`

Examples:

- `create_campaign_brief`
- `generate_email_draft`
- `generate_sms_draft`
- `recommend_google_business_post`
- `recommend_ad_keywords`
- `publish_asset`
- `send_sms`
- `send_email`

Publishing and sending permissions should default to blocked.

## Agent Safety Rules

### Hard Blocks

Agents must not:

- Promise insurance coverage.
- State that a claim will be approved.
- Guarantee payouts.
- Publish client-facing messages without approval.
- Send SMS or email without approval.
- Generate hail-only or wind-only campaign assets unless the task is explicitly to reject, block, or route them out of scope.
- Modify core CRM records without a preview and explicit user action.

### Required Review

Human approval is required for:

- Public website copy.
- Paid ad copy.
- Email campaigns.
- SMS campaigns.
- Review responses.
- Partner packets.
- One-pagers.
- Any content that references insurance, claims, coverage, timelines, pricing, or urgency.

### Allowed Without Approval

Agents may do these internally:

- Summarize records.
- Recommend next actions.
- Draft content.
- Flag risks.
- Create internal task suggestions.
- Generate campaign briefs in draft state.
- Score confidence.
- Suggest competitor features to research.

## Key Workflows

### Workflow 1: Hyper-Persona Refresh

1. New lead, engagement event, job, outcome, or partner update arrives.
2. Persona Intelligence Agent evaluates the record.
3. Agent updates or drafts a `persona_snapshot`.
4. Snapshot stores base persona, hyper-persona traits, confidence, and reasoning JSON.
5. If the snapshot changes outbound messaging, create an approval item.
6. CRM detail pages display the latest snapshot.

### Workflow 2: Campaign Brief Creation

1. Campaign Strategy Agent identifies an opportunity.
2. Agent links opportunity to persona, source, loss focus, and business goal.
3. Agent drafts a campaign brief.
4. Compliance Agent checks scope.
5. Owner approves or revises.
6. Approved brief unlocks content generation tasks.

### Workflow 3: Content Generation And Approval

1. Content Production Agent creates asset variants.
2. Compliance Agent checks restricted phrases and scope.
3. Approval item is created.
4. Owner reviews prompt inputs and output side by side.
5. Owner edits, approves, rejects, or requests revision.
6. Only approved assets become eligible for dispatch or publishing.

### Workflow 4: Partner Reactivation

1. Referral Growth Agent detects a dormant high-value partner.
2. Agent reviews prior referrals, outcomes, engagement, and persona snapshot.
3. Agent recommends a partner-specific next action.
4. Agent drafts an email, call script, or one-pager.
5. Compliance Agent checks it.
6. Owner approves.
7. Engagement events track response and update partner health.

### Workflow 5: Competitor Feature Intake

1. Competitor Intelligence Agent reviews a competitor or app.
2. Agent records features, screenshots, demo notes, pricing, and integrations.
3. Agent marks each feature as adapt, ignore, later, or already covered.
4. Product owner reviews.
5. Accepted features become roadmap candidates or implementation tasks.

## UI Implementation Details

### Agent Operations Dashboard

Top metrics:

- Active agents.
- Tasks running.
- Tasks awaiting approval.
- Blocked outputs.
- Approved assets this week.
- Risk flags.

Main table:

- Task.
- Agent.
- Linked persona/campaign/record.
- Status.
- Risk.
- Approval requirement.
- Last updated.

Right rail:

- Top blocked task.
- Recent output.
- Compliance queue.
- Next recommended build.

### Agent Card

Each card should show:

- Agent name.
- Purpose.
- Current task.
- Status.
- Last output.
- Risk flags.
- Approval policy.
- Open detail button.

### Task Detail

Sections:

- Objective.
- Source records.
- Prompt input metadata.
- Output.
- Compliance result.
- Approval state.
- Linked app objects.
- Audit log.

### Approval Review

The approval screen should show:

- Asset or task name.
- Campaign.
- Persona.
- Channel.
- Prompt inputs.
- Generated output.
- Editable output.
- Compliance flags.
- Risk level.
- Approve button.
- Reject button.
- Request revision button.

## Implementation Phases

### Phase 1: Agent Scaffolding

Build visible agent operations without live AI calls.

Tasks:

- Add `/agent-operations`.
- Add mock agent cards.
- Add mock task queue.
- Add mock approval queue.
- Add agent model docs.
- Add schema migration draft.

Acceptance:

- Team can see the proposed agent workforce.
- No external messages can be sent.
- All actions are preview-only.

### Phase 2: Agent Data Model

Persist agent definitions and task records.

Tasks:

- Add `agents`.
- Add `agent_tasks`.
- Add `agent_task_inputs`.
- Add `agent_outputs`.
- Add `agent_run_logs`.
- Add `agent_permissions`.
- Add indexes and foreign keys.

Acceptance:

- Agent tasks can be created and displayed.
- Outputs can be attached to approvals.
- Every output has audit metadata.

### Phase 3: Approval Queue

Make human review real.

Tasks:

- Add `approval_items`.
- Create `/approvals`.
- Add status transitions.
- Add editable output.
- Add compliance flags.

Acceptance:

- Generated drafts cannot become active without approval.
- Rejected assets stay blocked.
- Revision requests create new agent tasks.

### Phase 4: Persona Agent

Implement first useful agent.

Tasks:

- Generate persona snapshots deterministically from existing data.
- Store reasoning JSON.
- Show snapshots on CRM records.
- Create next best action recommendations.

Acceptance:

- Every sample CRM lead/contact/company can show a profile.
- Snapshot updates are explainable.
- No outbound actions are taken.

### Phase 5: Campaign And Content Agents

Connect agents to AI Studio.

Tasks:

- Create campaign brief records.
- Generate draft assets from approved briefs.
- Run compliance checks.
- Route outputs to approval queue.

Acceptance:

- AI Studio becomes a controlled agent workspace.
- Drafts are traceable from prompt inputs to approval.

### Phase 6: Integrations And Measurement

Connect external signals.

Tasks:

- Ingest events from forms, calls, SMS, email, reviews, ads, and Google Business Profile.
- Feed events into persona snapshots and reports.
- Track campaign outcomes.

Acceptance:

- Agent recommendations improve as real activity enters the system.
- Reports can explain which agents/campaigns/personas influenced outcomes.

## Suggested Initial Agents For The App

Start with these:

1. Persona Intelligence Agent.
2. Compliance Agent.
3. Campaign Strategy Agent.
4. Content Production Agent.
5. Referral Growth Agent.

Add later:

1. Local SEO Agent.
2. Paid Ads Agent.
3. Website Personalization Agent.
4. Reporting Agent.
5. Competitor Intelligence Agent.

## Open Questions

- Should agents run only when a user clicks a button, or also on schedules?
- Which outputs should require owner approval versus manager approval?
- Should approved assets be dispatched by this app or exported to external tools?
- Which external AI provider should run the first live agent?
- How much agent reasoning should be stored in `reasoning_json`?
- Should competitor research become its own agent before content production?
- What is the first real integration: CallRail, Google Business Profile, email, SMS, or forms?

## Backlog

Add new agent ideas below this line.

### New Agent Ideas

- 

### Agent Risks

- 

### Approved Agent Behaviors

- 

### Blocked Agent Behaviors

- 

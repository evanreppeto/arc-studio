# Agent Integration With GCP And Gemma

## Purpose

This document captures the current direction for integrating AI agents into Arc Studio without immediately depending on expensive third-party per-token API calls.

The working idea is:

Build a team of logical agents inside Arc Studio, but run them through one shared, self-hosted model backend on GCP.

This should stay editable as the implementation changes.

## Current Recommendation

Use a team of agents at the product level, but do not run a separate model service for every agent.

Instead:

- Define agents as database/config records.
- Store their roles, tools, permissions, prompts, and approval policies.
- Put requested work into an `agent_tasks` queue.
- Run those tasks through one shared inference worker.
- Host the model worker on GCP using Gemma or another open-weight model.
- Write outputs back to Supabase.
- Require human approval before any customer-facing action.

This gives the product the feeling of an agent team without the cost and complexity of many separate AI services.

## Model Routing Principle

Gemma should be the cheap in-house worker.

Gemini should be the specialist or supervisor model when the task needs stronger reasoning, multimodal understanding, or tool orchestration.

The app should not treat every agent task the same. Each task should be routed to the cheapest capable model or tool.

Suggested policy:

```text
Default: self-hosted Gemma worker
Use Gemini Flash: medium-value strategy, summaries, multimodal review, better drafts
Use Gemini Pro: high-value campaign planning, final creative review, complex reasoning
Use Codex or Claude Code: engineering implementation handoffs
Use Higgsfield: approved video or creative generation prompts
Use deterministic code: scoring, routing, blocking, deduplication, approval states
```

The Arc Studio should become the agent control room. Agents propose, route, and prepare work. Humans approve. Specialized tools execute.

## Core Architecture

```text
Next.js Arc Studio
  |
  | creates tasks, displays outputs, handles approvals
  v
Supabase
  agents
  agent_tasks
  agent_task_inputs
  agent_outputs
  approval_items
  persona_snapshots
  engagement_events
  campaigns
  |
  | worker polls queued tasks
  v
GCP Cloud Run Agent Worker
  shared model runtime
  Gemma / Gemma 4 / compatible open model
  deterministic tools
  agent prompt runner
  |
  | writes result + audit trail
  v
Supabase
  |
  v
Arc Studio UI
  Agent Operations
  Persona Intelligence
  AI Studio
  Approval Queue
  CRM Detail Pages
  Reports
```

## Expanded Tool Architecture

The agent system should support multiple execution targets:

```text
Agent Task
  |
  | choose best execution path
  v
Model / Tool Router
  |
  |-- Gemma self-hosted worker
  |-- Gemini Flash / Gemini Pro
  |-- Codex handoff
  |-- Claude Code handoff
  |-- Higgsfield handoff
  |-- deterministic code path
```

The first implementation should not let agents freely run external tools. Agents should prepare structured handoffs, then wait for human approval.

Example:

```text
Creative Agent creates a Higgsfield video prompt
Compliance Agent checks the prompt
Owner approves
User manually runs or exports to Higgsfield
Result is attached back to the campaign
```

Example:

```text
Engineering Agent creates a Codex implementation prompt
Owner approves
Prompt is handed to Codex or Claude Code
Resulting PR/worktree is reviewed
```

## Agent Team Model

The app should show multiple agents, but they can all use the same backend model.

Initial agents:

- Persona Intelligence Agent
- Compliance Agent
- Campaign Strategy Agent
- Content Production Agent
- Referral Growth Agent

Later agents:

- Local SEO Agent
- Paid Ads Agent
- Website Personalization Agent
- Reporting Agent
- Competitor Intelligence Agent

Each agent should be represented by configuration, not infrastructure.

Example fields:

- `key`
- `name`
- `purpose`
- `system_instructions`
- `allowed_actions`
- `blocked_actions`
- `tools`
- `approval_policy`
- `risk_level`
- `model_profile`
- `status`

## Why One Shared Worker

A shared worker is the cheapest clean architecture.

Benefits:

- One model container to deploy.
- One GPU service to wake up.
- One queue processor.
- One place to log costs and failures.
- Agents differ by instructions, tools, and permissions instead of separate deployments.
- Easier to swap Gemma for another model later.

Avoid this at first:

- One Cloud Run service per agent.
- One GPU per agent.
- Long-running autonomous agents.
- Always-on chat sessions.
- Direct publish/send permissions.

## Hosting Direction

### Preferred First Option: Cloud Run GPU

Use Cloud Run with GPU support for the shared inference worker.

Why:

- Fully managed container hosting.
- Can scale to zero when idle.
- Good for bursty agent work.
- Simpler than running a full Kubernetes or VM stack.
- Google Cloud supports NVIDIA L4 GPUs for Cloud Run.

Important notes:

- Cloud Run GPU can scale to zero, which helps cost.
- GPU is billed while the instance is running.
- Keeping a GPU warm all day can get expensive.
- Design the product around queued jobs and short bursts, not continuous model usage.
- Pricing changes, so verify GCP pricing before committing.

Useful references:

- Cloud Run GPU docs: https://docs.cloud.google.com/run/docs/configuring/services/gpu
- Cloud Run pricing: https://cloud.google.com/run/pricing

### Later Option: Compute Engine Spot GPU

Use this only if batch volume grows and Cloud Run becomes too expensive.

Why:

- Potentially cheaper for long batch windows.
- More control over the model server.

Tradeoffs:

- More ops burden.
- Need to handle interruptions.
- Need queue retry logic.
- Need VM lifecycle management.

### Managed Option: Vertex AI / Agent Engine

Use this later if the priority becomes managed deployment, enterprise controls, or Google-native agent tooling.

Why:

- More managed.
- Better platform integrations.
- Fits Google Agent Development Kit workflows.

Tradeoffs:

- More likely to become platform/API-style billing.
- Less aligned with the goal of avoiding model API costs.

Useful references:

- Google Agent Development Kit: https://adk.dev/
- Vertex AI ADK overview: https://cloud.google.com/vertex-ai/generative-ai/docs/agent-development-kit/overview

## Model Runtime Options

The model backend should be swappable.

Possible runtimes:

- Ollama
- vLLM
- llama.cpp
- Hugging Face Text Generation Inference
- custom Python FastAPI wrapper

For a first version, prefer the simplest runtime that can:

- Load the selected Gemma model.
- Accept structured prompt requests.
- Return structured JSON.
- Run inside a container.
- Start reliably on Cloud Run GPU.
- Log latency and failures.

## Gemma Use

Gemma or Gemma 4 is attractive because:

- It is open-weight.
- It can be self-hosted.
- It can avoid third-party per-token API billing.
- Smaller variants may be good enough for draft generation, classification summaries, and agent planning.

Important caution:

Self-hosting avoids external model API charges, but it does not make inference free. The app still pays for GPU/CPU runtime, storage, logs, and networking.

Use Gemma for:

- Persona summaries.
- Campaign brief drafts.
- Email and SMS drafts.
- Ad copy variants.
- Competitor research summaries.
- Reporting summaries.
- Next-best-action explanations.
- Low-risk internal summaries.
- First-pass creative prompts.

Do not use Gemma for everything.

Use deterministic code for:

- Lead scoring.
- Partner scoring.
- Loss classification.
- Restricted phrase checks.
- Approval state transitions.
- Event deduplication.
- Routing rules.
- Permission checks.

## Gemini Use

Gemini should be used selectively, not as the default worker.

Use Gemini when the task is higher-value, multimodal, or requires stronger orchestration.

Best use cases:

- Campaign strategy across personas, offers, channels, and business goals.
- Reviewing ad concepts for clarity, audience fit, and BSR alignment.
- Reviewing screenshots, landing pages, images, video concepts, and storyboards.
- Turning approved campaign strategy into higher-quality Higgsfield prompts.
- Supervising or reviewing outputs generated by Gemma-backed agents.
- Synthesizing competitor research into product decisions.
- Escalating low-confidence Gemma outputs.
- Function-calling or tool-routing tasks where Gemini is a better planner.

Suggested Gemini routing:

```text
Gemini Flash:
- fast strategy refinement
- image/screenshot review
- campaign summary review
- ad copy polish
- competitor notes synthesis

Gemini Pro:
- high-value campaign strategy
- final creative review
- complex multi-persona planning
- major product/roadmap synthesis
- supervisor review of important agent outputs
```

Gemini should not bypass approval. Even if Gemini produces the final recommendation, customer-facing actions still require human review.

Useful references:

- Gemini function calling: https://ai.google.dev/gemini-api/docs/function-calling
- Gemini image understanding: https://ai.google.dev/gemini-api/docs/vision
- Gemini video understanding: https://ai.google.dev/gemini-api/docs/video-understanding

## Codex And Claude Code Use

Codex and Claude Code should be treated as engineering execution tools.

Agents inside Arc Studio should not directly modify the codebase at first. They should prepare implementation handoffs.

Use Codex or Claude Code for:

- Creating app features.
- Adding routes.
- Editing UI components.
- Writing migrations.
- Writing tests.
- Debugging build or lint failures.
- Implementing approved product tickets.

The Arc Studio should create structured handoff prompts such as:

```text
Tool handoff: Codex
Task: Add /agent-operations dashboard
Context: docs/agent-operating-model.md and docs/agent-integration-gcp-gemma.md
Files likely affected:
- src/app/_data/growth-engine.ts
- src/app/agent-operations/page.tsx
- supabase/migrations/...
Acceptance criteria:
- Agent cards render
- Task queue renders
- Approval preview renders
- pnpm test/lint/build run
Approval required: yes
```

Do not allow engineering agents to:

- commit without review
- push without review
- modify auth/payment/schema boundaries without explicit approval
- delete user work
- alter production secrets

## Higgsfield Use

Higgsfield should be treated as a creative generation target for video and motion concepts.

Agents should not blindly generate videos. They should prepare high-quality creative prompts based on approved campaign strategy.

Use Higgsfield for:

- short video ad concepts
- partner campaign video prompts
- homeowner emergency awareness clips
- brand-safe motion creative
- social creative variations

Suggested workflow:

1. Campaign Strategy Agent creates campaign brief.
2. Content Production Agent creates copy direction.
3. Compliance Agent checks the campaign and prompt.
4. Creative Agent generates Higgsfield prompt.
5. Owner approves prompt.
6. User runs Higgsfield or exports prompt.
7. Result URL or asset notes are attached to the campaign.

Higgsfield prompts should include:

- campaign name
- persona
- loss focus
- visual idea
- tone
- CTA
- forbidden claims
- required BSR guardrails
- desired format and length
- approval status

Example:

```text
Tool handoff: Higgsfield
Campaign: Plumbing Partner Water Backup
Persona: Plumbing Partner
Goal: Short video ad for referral partners
Prompt: Create a clean, professional 15-second video showing a plumbing partner stopping the source of a leak, then handing off the property damage response to Big Shoulders Restoration. Emphasize fast mitigation handoff, relationship protection, and documentation. Do not mention insurance coverage promises or claim approval.
Approval required: yes
```

## Data Flow

### User-Triggered Agent Run

1. User clicks "Generate campaign brief" or "Refresh persona snapshot".
2. Next.js creates an `agent_tasks` row.
3. Task stores source references and requested output type.
4. Worker picks up the task.
5. Worker loads agent config.
6. Worker gathers task inputs.
7. Worker calls the local Gemma backend.
8. Worker validates and normalizes the output.
9. Worker writes `agent_outputs`.
10. If external-facing, worker creates an `approval_items` row.
11. UI shows the output and approval state.

### Tool Handoff Flow

1. Agent determines that a specialized tool is needed.
2. Agent creates an `agent_tool_requests` row.
3. Request stores the target tool, prompt, source records, risk flags, and approval requirement.
4. Compliance Agent checks the handoff if customer-facing.
5. Human approves or requests edits.
6. User runs the external tool or the system dispatches it if that integration is approved later.
7. Result is attached back to the originating campaign, task, or CRM record.

### Scheduled Agent Run

1. Scheduler creates low-priority tasks.
2. Worker runs them in a batch window.
3. Results update snapshots, reports, or internal recommendations.
4. No customer-facing action happens automatically.

Examples:

- Nightly persona snapshot refresh.
- Weekly partner health summary.
- Weekly competitor feature summary.
- Daily campaign performance summary.

## Database Tables

Recommended first tables:

- `agents`
- `agent_tasks`
- `agent_task_inputs`
- `agent_outputs`
- `agent_run_logs`
- `agent_permissions`
- `approval_items`
- `agent_tool_requests`

Related tables from other planning docs:

- `persona_snapshots`
- `engagement_events`
- `campaigns`
- `campaign_assets`
- `competitor_apps`
- `competitor_features`
- `integration_registry`

## Agent Task Statuses

Use explicit statuses:

- `queued`
- `running`
- `blocked`
- `needs_approval`
- `completed`
- `failed`
- `canceled`

Every failed task should store:

- error message
- agent key
- task id
- model profile
- started time
- failed time
- retry count

## Tool Handoff Data Model

### `agent_tool_requests`

Stores requests from internal agents to specialized external or semi-external tools.

Fields:

- `id`
- `agent_task_id`
- `requested_by_agent_id`
- `tool_name`
- `handoff_type`
- `status`
- `approval_status`
- `risk_level`
- `campaign_id`
- `persona_snapshot_id`
- `crm_source_type`
- `crm_source_id`
- `prompt`
- `source_payload`
- `result_url`
- `result_summary`
- `error_message`
- `created_at`
- `updated_at`

Suggested `tool_name` values:

- `gemma`
- `gemini_flash`
- `gemini_pro`
- `codex`
- `claude_code`
- `higgsfield`
- `deterministic_worker`

Suggested `handoff_type` values:

- `code`
- `video`
- `image`
- `copy`
- `review`
- `research`
- `strategy`
- `compliance`

Suggested statuses:

- `draft`
- `pending_approval`
- `approved`
- `ready_to_run`
- `running`
- `completed`
- `failed`
- `rejected`
- `archived`

## Approval Rules

Agents may do internal analysis without approval.

Agents need approval for:

- email drafts
- SMS drafts
- paid ad copy
- landing page copy
- Google Business posts
- review responses
- partner packets
- one-pagers
- public campaign assets

Hard blocks:

- insurance coverage promises
- claim approval claims
- payout guarantees
- hail-only campaign generation
- wind-only campaign generation
- exterior-only roof campaign generation
- sending customer communication without approval
- publishing public content without approval

## Cost Strategy

The cost goal is not "no API calls ever." The cost goal is:

Avoid third-party per-token LLM billing for routine agent work while keeping infrastructure usage low.

Practical cost rules:

- Keep GPU services at min instances 0.
- Batch non-urgent tasks.
- Avoid always-on agents.
- Prefer deterministic code where possible.
- Cache repeated context summaries.
- Store reusable persona snapshots.
- Store campaign briefs and asset variants.
- Only rerun agents when source data changes.
- Keep small models for simple work.
- Use larger models only if the output quality requires it.

## Suggested V1

V1 should be preview-first and cheap.

Build:

- `agents` config records.
- `agent_tasks` queue.
- `agent_outputs` records.
- Agent Operations UI.
- Approval Queue UI.
- Mock/local worker first.
- No live model inference at first.

Then add:

- Local or GCP-hosted Gemma worker.
- Persona Intelligence Agent.
- Compliance Agent.
- Campaign Strategy Agent.

Do not add:

- autonomous publishing.
- live ad launching.
- automatic SMS/email sending.
- always-on GPU.
- multiple separate model services.

## Suggested V1 Agent Stack

### Persona Intelligence Agent

Runs on:

- CRM record change.
- engagement event change.
- manual refresh.

Creates:

- persona snapshot.
- next best action.
- reasoning summary.

### Compliance Agent

Runs on:

- generated draft.
- edited draft.
- campaign brief.

Creates:

- compliance status.
- risk flags.
- blocked phrase findings.
- suggested edit notes.

### Campaign Strategy Agent

Runs on:

- selected persona.
- selected campaign goal.
- owner-triggered request.

Creates:

- campaign brief.
- target audience.
- offer.
- channel plan.
- asset list.

## Open Decisions

- Which Gemma model size should be tested first?
- Should Cloud Run GPU be the first hosting target, or should local Ollama be used first?
- Should the worker poll Supabase, or should tasks be pushed through Pub/Sub or Cloud Tasks?
- Should there be one worker for both deterministic tasks and model tasks, or two workers?
- How much of the model prompt and response should be stored?
- What is the maximum monthly infrastructure budget?
- Which outputs can be internal-only without approval?
- Which user role can approve public content?
- Should approved outputs be exported to tools, or should this app eventually publish them?

## Implementation Phases

### Phase 1: Product Scaffolding

- Add Agent Operations UI.
- Add agent task mock data.
- Add approval mock data.
- Add schema migration draft.
- Keep all actions preview-only.

### Phase 2: Database-Backed Agent Tasks

- Add agent tables.
- Store tasks and outputs.
- Show task status in UI.
- Create approval items from agent outputs.

### Phase 3: Local Model Worker

- Run Gemma locally first.
- Build a worker that can process one queued task.
- Store outputs.
- Measure latency and quality.

### Phase 4: GCP Cloud Run Worker

- Containerize the worker.
- Deploy to Cloud Run GPU.
- Keep min instances at 0.
- Add logging and retry behavior.
- Add budget monitoring.

### Phase 5: Model And Tool Router

- Add routing rules for Gemma, Gemini Flash, Gemini Pro, deterministic code, Codex, Claude Code, and Higgsfield.
- Add `agent_tool_requests`.
- Keep all external tool requests approval-gated.
- Store handoff prompts and results.

### Phase 6: Production Agent Guardrails

- Add approval enforcement.
- Add compliance checks.
- Add blocked action rules.
- Add audit log review.

### Phase 7: Integrations

- Add event ingestion.
- Add campaign performance inputs.
- Add external tool registry.
- Let agents use real signals to improve recommendations.

## Notes To Revisit

- Verify GCP pricing before deployment.
- Benchmark Gemma quality against the specific BSR tasks.
- Test whether smaller Gemma models are good enough for compliance-sensitive drafts.
- Consider using a stronger model only for high-value or final-review tasks.
- Use Gemini selectively for multimodal review, supervisor review, and complex campaign strategy.
- Treat Codex, Claude Code, and Higgsfield as approved handoff targets before direct automation.
- Keep all customer-facing actions approval-gated until the system proves reliable.

## Backlog

Add updates below.

### Decisions Made

- 

### Cost Findings

- 

### Model Benchmarks

- 

### Deployment Notes

- 

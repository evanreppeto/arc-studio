@AGENTS.md

# Big Shoulders Growth Engine

Next.js 16 + React 19 + Supabase app. Package manager is **pnpm** (workspace declared in `pnpm-workspace.yaml`). Path alias `@/*` → `./src/*`.

## Commands

```bash
pnpm dev            # next dev
pnpm build          # next build
pnpm test           # vitest run (one-shot; no watch by default)
pnpm test path/to/file.test.ts   # run a single test file
pnpm lint           # eslint (flat config in eslint.config.mjs)
```

## Architecture

- Product posture: this app is primarily a backend/control plane for the **Arc** agent. Build durable APIs, records, queues, approvals, logs, and state transitions first. UI pages are detailed operator views for humans and agent debugging, not the main source of product value.
- Layering convention: `src/domain/` (pure logic) → `src/lib/<feature>/` (I/O, persistence, read-models, repos) → `src/app/<route>/` (server-component views + colocated `_components/`/`_data/`). Don't put I/O in `domain/`; don't put business rules in `app/`.
- `src/domain/` — pure, deterministic business logic. No I/O. Heavily unit-tested in `src/domain/__tests__/`. Modules: `personas`, `scoring`, `lead-ingestion`, `leads`, `loss-classification`, `routing-decisions`, `events`, `integrity-findings`, `notebook`, `campaign-revisions`. Everything re-exports through `src/domain/index.ts` — import from `@/domain`.
- Live API surfaces (each carries its own auth — see Operator Auth & API Tokens):
  - `POST /api/v1/leads/ingest` — calls `parseLeadIngestionPayload` from `@/domain`, then `persistLeadIngestion` from `@/lib/lead-ingestion/persistence` only if Supabase env vars are set.
  - `POST /api/v1/arc/runs` — bearer-gated (`ARC_AGENT_API_TOKEN`); runs `runArcPartnerCampaign` from `@/lib/arc/orchestrator`. Returns `503 not_configured` if Supabase admin isn't set up. `POST /api/v1/arc/ping` is the bearer-gated health/connectivity check.
  - `POST /api/v1/approvals` and `POST /api/v1/approvals/history` — programmatic approval surface (bearer-gated like the other `/api/v1` routes).
  - `/api/auth/sign-in`, `/api/auth/sign-in/passkey`, `/api/auth/sign-out` — operator session cookie management.
- `src/lib/supabase/server.ts` — admin client, lazily created from `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Guard every persistence call with `isSupabaseAdminConfigured()`; without env vars the app degrades gracefully instead of throwing.
- `src/lib/repos/` — thin repository layer over Supabase (currently `leads`). Use/extend this for new typed table access rather than hand-rolling queries in routes.
- Signed-in screens live under the `src/app/(app)/` route group. `src/app/(app)/layout.tsx` is the auth boundary (`force-dynamic`; resolves the workspace once via `getCurrentWorkspaceContext()`) and renders the shell. Marketing/auth routes (`landing`, `login`, `sign-up`, `onboarding`, …) sit outside the group.
- Shared UI primitives live in `src/app/(app)/_components/`: `modal.tsx` (`Modal`), `kpi-strip.tsx` (`KpiStrip`, `KpiCell`), `sparkline.tsx` (`Sparkline`), `share-dialog.tsx` (`ShareDialog`), `command-palette.tsx` (`CommandPalette`, `CommandItem`), `coming-soon.tsx` (`ComingSoonToasts`). Reuse these before adding new ones. The rest of that directory is shell machinery, not page-level primitives (`app-shell`, `account-menu`, `workspace-switcher`, `nav-progress`, `route-prewarm`). There is **no** `page-header.tsx` and no `PageHeader`/`Panel`/`StatusPill`/`OperatorBar`/`ActionFeedback`/`EmptyState` component — page chrome is composed per-route with the CSS classes in `src/app/(app)/arc-app.css` (see `DESIGN.md`).
- The rendered nav rail lives in `src/app/(app)/_components/app-shell.tsx` (a `"use client"` component). Two arrays drive it: `PRIMARY_NAV_ITEMS` — Arc `/arc`, Home `/home`, Campaigns `/campaigns`, Relationships `/crm`, Opportunities `/opportunities` — rendered under the **Workspace** group, and `ADVANCED_NAV_GROUPS` — **Measure** (Analytics), **Intelligence** (Journeys, Brain, Personas), **Create & manage** (Studio, Library, Brand, Outbox). Settings is *not* in the nav arrays: it's reached through `AccountMenu` at the bottom of the rail, alongside a Help & support (`/support`) link. Adding a top-level route means touching three things in `app-shell.tsx` — the nav array, the `CRUMBS` map, and the `commandItems` (⌘K) list.
- CRM is a single dynamic tree, not six hand-written subroutes: `src/app/(app)/crm/page.tsx` (object index) → `[objectKey]/page.tsx` (list) → `[objectKey]/[recordId]/page.tsx` (record), with shared pieces in `crm/_components/` (`crm-board.tsx`, `add-record-modal.tsx`) and `[objectKey]/[recordId]/_components/` (`record-view.tsx`, `edit-record-modal.tsx`). Everything under `(app)` is dynamic — the route group forces it.
- `supabase/migrations/` — ordered, timestamp-prefixed migrations applied in sequence (initial 6-object CRM + `persona_mapping` enum, then phase-1 activity/routing/integrity, hyper-personalization, agent-operations scaffold, Arc backend foundation, data-API role grants, vault notes, approval-decision `reverted` state). Add a new timestamped file; don't edit shipped ones.

## Operator Auth & API Tokens

Two independent auth mechanisms — don't conflate them:

- **Operator gate (human UI).** Opt-in via `OPERATOR_ACCESS_TOKEN`: when unset (local dev) everything is open; when set, page routes require a `signal_operator` cookie. Enforced at the edge by `src/proxy.ts` — this is **Next.js 16's renamed middleware** (`middleware` → `proxy`), not a custom file. Its `config.matcher` skips API routes, Next internals, the auth pages, and brand assets. Because `proxy.ts` runs on the edge it can only import `src/lib/auth/operator-shared.ts` (no `next/headers`); the cookie/redirect helpers live there. Server actions and mutating server components call `requireOperator()` from `src/lib/auth/operator.ts` for defense-in-depth.
- **API bearer tokens (programmatic callers).** API routes are *not* covered by the operator gate. They validate their own bearer tokens via `checkBearerToken(request, "ENV_VAR")` in `src/lib/auth/api-token.ts` (e.g. `ARC_AGENT_API_TOKEN`).

## Feature Wiring Pattern

**The app is wired, not scaffold-mode.** Every top-level route under `src/app/(app)/` has real `"use server"` actions in a colocated `actions.ts` — arc, home, campaigns, crm, opportunities, analytics, journeys, brain, personas, studio, library, brand, outbox, settings, support. The old preview-only pattern this file used to describe (async pages destructuring `searchParams.action`, paired with `<OperatorBar>` + `<ActionFeedback>` and `href="?action=foo"` links that wrote nothing) is **gone** — those components never existed under those names any more, and there is not one `href="?action=` left in the tree. Don't reintroduce it, and don't assume a page is preview-only because this doc once said so — check its `actions.ts`.

The shape to follow when adding a feature: a `"use server"` action gated by `requireOperator()` (`src/lib/auth/operator.ts`) + `isSupabaseAdminConfigured()`, persisting through a `src/lib/<feature>/` layer, then `revalidatePath`. Org-scope every write via `getCurrentOrgId()` (`src/lib/auth/org.ts`).

Reference implementations:

- **Campaigns** (`src/app/(app)/campaigns/`, `src/lib/campaigns/`, `src/domain/campaign-revisions.ts`) — actions in `campaigns/actions.ts`, `campaigns/sharing-actions.ts`, and `campaigns/[campaignId]/actions.ts`; persistence split across `src/lib/campaigns/{read-model,decisions,revisions,create,launch,queue,external-send,attach-media,draft-editing}.ts`. This is the ContentEngine-style approval flow in practice: Arc drafts assets, the operator approves / declines / archives or requests a revision, and outbound stays locked until approved.
- **CRM interactions** (`src/app/(app)/crm/[objectKey]/[recordId]/`, `src/lib/interactions/`, `src/domain/interactions.ts`) — record-attached notes, follow-up tasks, and activity timeline, rendered by `_components/record-view.tsx`. The same persistence path serves humans (server actions in `crm/actions.ts` + `[objectKey]/[recordId]/actions.ts`) and Arc (`POST /api/v1/arc/crm/interactions`).

Some `src/lib/<feature>/` dirs are backend-only on purpose — reached by Arc's API routes with no operator UI: `vault` (`src/lib/vault/` + `src/domain/notebook.ts`, served by `/api/v1/arc/vault`; there is no `/vault` page), plus `activity`, `approvals`, `partners`, `persona-intelligence`. `loss-routing` and `agent-operations` currently have **no consumer at all** under `src/app/` — treat them as unwired, and confirm before building on them.

When wiring approval actions, make them real backend state transitions. Use the ContentEngine-style pattern for campaigns and ads: Arc creates a draft, the item enters approval with prompt inputs/source records/output/risk flags, and the human can approve, decline, request revision, or archive. Approved items unlock the next backend step; declined or blocked items stay unavailable.

## Arc as BSR Lead Marketing Agent

Arc is **not** a generic chatbot. Arc operates as Big Shoulders Restoration's (BSR) lead marketing operator/orchestrator. This app is Arc's command center for finding source-backed opportunities, mapping them to personas, generating approval-gated campaign packages, organizing creative assets, and learning from performance. Build BSR-specific marketing workflows over generic SaaS/CRM patterns.

### Core operating principle (non-negotiable)

- **Agent does the work. Human approves decisions. Database remembers everything.**
- **No outbound send/publish/launch/spend/contact action happens without explicit human approval.** Never add automatic outbound behavior. Keep every change approval-safe.
- Arc may draft, recommend, score, prepare assets, and create approval-ready records — nothing that reaches the outside world without a human gate.
- Prefer **approved real BSR media** wherever possible. AI creative should enhance/package/resize/test authentic BSR proof, not replace it.
- **Higgsfield** is active (Ultra plan, 2026-06-24). Arc reaches it through the per-workspace **`higgsfield` remote-MCP connector** (`src/domain/connectors.ts` → hosted MCP at `mcp.higgsfield.ai/mcp`), loaded into the runner by `apps/arc-runner/src/connectors.ts` in **draft/act modes only**. Output is always an approval-gated, provenance-tagged draft asset — never auto-outbound. The connector is **OFF until enabled per workspace with a stored Vault credential**; the runner reads it from `GET /api/v1/arc/connectors`. The curated model roster lives in `src/domain/higgsfield-models.ts`. NOTE: the deployed Cloud Run runner can't use a personal account OAuth — its credential is a separate, still-open decision (runner-side OAuth vs the Cloud API key); multi-tenant per-workspace OAuth onboarding remains deferred.

### Product direction: a marketing operating system

The durable architecture is a shared **Persona Revenue Intelligence Layer** that powers CRM, campaigns, landing pages, approval cards, personalization, reporting, and Arc/subagent decisions — not just a CRM or campaign list. Arc should become proactive: finding leads, identifying persona groups, watching signals, drafting campaigns, preparing creative, and learning what works.

### Frontend priorities

1. **Arc Marketing Command Center** — surface waiting Arc tasks, blocked tasks, opportunity recommendations, campaign packages needing approval, recent assets, competitor/weather signals, and run logs.

2. **Persona Revenue Intelligence fields** — expose on companies, contacts, leads, campaigns, and approval cards where relevant: primary persona, secondary personas, persona confidence, relationship stage, urgency, service need, lead score, revenue opportunity score, relationship score, next best action, recommended CTA, recommended message angle, recommended proof points, recommended nurture/follow-up. (Note the existing 12-persona contract in `src/domain/personas.ts`.)

3. **Campaign Package Builder** — campaign records support complete packages: campaign brief; target audience; similar/lookalike audiences considered; persona and relationship logic; email draft; SMS draft; paid social/ad copy; landing/one-pager copy; sales/partner handoff note; asset list; approved media references; generated asset IDs/URLs/paths; guardrail result; human approval status.

4. **Asset Review and Provenance** — asset cards clearly show: source type (real BSR media, AI-generated, composite, stock, external); approved-media source ID when available; prompt/job ID/model when generated; format/aspect ratio (1:1, 4:5, 9:16, 16:9, PDF, MP4, etc.); status (draft, needs revision, approved, rejected); risk flags (embedded text/logo issues, unrealistic scene, privacy/redaction, claim risk); reviewer and timestamp.

5. **Opportunity Intelligence Inbox** — an inbox for source-backed opportunities from CRM inactivity, new lead/company discovery, weather events, competitor activity, newly approved media, performance anomalies, and persona segment gaps. Each opportunity shows: evidence/source links, confidence, recommended action, suggested campaign type, required approval path.

6. **Performance Learning Loop** — track outcomes so Arc can learn: campaign/channel/persona/asset attribution; impressions/clicks/replies/booked jobs/referrals where available; cost/spend if applicable; message angle used; proof/media used; conversion/business outcome; Arc's recommendation for next iteration.

### Design + implementation expectations

- The UI must make **evidence, approval state, media, and next actions obvious**. Campaign cards should not look empty when assets exist.
- Arc-created work must be **reviewable by humans before anything goes outbound** — visible, auditable, easy to approve/reject/revise.
- Before modifying the frontend: inspect existing app structure; reuse the existing components and styling patterns (the `src/app/(app)/_components/` primitives listed under Architecture, the `arc-app.css` classes, `DESIGN.md`).
- If backend fields/routes are missing, **document the required schema/API additions** (new `supabase/migrations/` file, `src/lib/<feature>/` layer, route) instead of faking frontend-only data. Wire persistence + the `requireOperator()` gate following the vault/campaigns reference shape above.

## Lead Ingestion Contract (don't break this)

- 12 official personas live in `OFFICIAL_PERSONA_MAPPINGS` (`src/domain/personas.ts`). They must stay in sync with the `persona_mapping` enum in the Supabase migration.
- `unassigned_persona` is **internal-only** — the ingest API rejects it, and the DB enforces it via `leads_persona_not_unassigned_check`.
- Ingest response codes are load-bearing: `400` (validation/persona rejection), `202` (accepted but Supabase not configured — no row written), `201` (accepted + persisted), `502` (persistence error).
- Routing and scoring are intentionally **deterministic and owned by the app layer** (not the DB) so they stay unit-testable. Don't push that logic into Postgres.

## Design System

UI work must follow `DESIGN.md` — the warm obsidian + antique gold palette (`--canvas` `#16161a`, `--accent` `#c8a24a`, red `--priority` `#cc6666` for destructive only); no emojis, no purple/neon AI aesthetic, no equal 3-column dashboard rows.

## Env

Copy `.env.example` → `.env.local`. Without Supabase vars, the ingest route still validates and scores but returns `202` with `persistence.status: "not_configured"` — useful for local dev.

Key vars: `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (persistence); `OPERATOR_ACCESS_TOKEN` / `OPERATOR_EMAIL` / `OPERATOR_PASSWORD` (operator UI gate — leave unset locally to stay open); `ARC_AGENT_API_TOKEN` (bearer for `POST /api/v1/arc/runs`). `pnpm seed:arc-demo` seeds demo data; `pnpm seed:test-campaign` seeds a campaign for the wired campaigns flow.

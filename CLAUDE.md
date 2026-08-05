@AGENTS.md

# Arc Studio

Next.js 16 + React 19 + Supabase app. Package manager is **pnpm** (workspace declared in `pnpm-workspace.yaml`). Path alias `@/*` → `./src/*`.

## Commands

```bash
pnpm dev            # next dev
pnpm build          # next build
pnpm test           # vitest run (one-shot; no watch by default)
pnpm test path/to/file.test.ts   # run a single test file
pnpm lint           # eslint (flat config in eslint.config.mjs)
pnpm typecheck      # tsc --noEmit, deliberately NON-incremental (see below)
```

`typecheck` passes `--incremental false` on purpose. `tsconfig.json` sets
`incremental: true` (good for builds), which makes `tsc` write
`tsconfig.tsbuildinfo` — and that cache carried across a branch switch reports
**phantom errors against files the current branch never changed**. It is
reproducible: a stale cache produced 126 errors on a `main` that typechecks
clean, while CI stayed green because CI always starts from a fresh checkout.
Local typecheck has to agree with CI or it is not a gate. If you ever see a wall
of unexplained type errors, `rm tsconfig.tsbuildinfo` before believing them.

## Architecture

- Product posture: this app is primarily a backend/control plane for the **Arc** agent. Build durable APIs, records, queues, approvals, logs, and state transitions first. UI pages are detailed operator views for humans and agent debugging, not the main source of product value.
- Layering convention: `src/domain/` (pure logic) → `src/lib/<feature>/` (I/O, persistence, read-models, repos) → `src/app/<route>/` (server-component views + colocated `_components/`/`_data/`). Don't put I/O in `domain/`; don't put business rules in `app/`.
- `src/domain/` — pure, deterministic business logic. No I/O. Heavily unit-tested in `src/domain/__tests__/`. Modules: `personas`, `scoring`, `lead-ingestion`, `leads`, `loss-classification`, `routing-decisions`, `events`, `integrity-findings`, `notebook`, `campaign-revisions`. Everything re-exports through `src/domain/index.ts` — import from `@/domain`.
- Live API surfaces (each carries its own auth — see Operator Auth & API Tokens):
  - `POST /api/v1/leads/ingest` — calls `parseLeadIngestionPayload` from `@/domain`, then `persistLeadIngestion` from `@/lib/lead-ingestion/persistence` only if Supabase env vars are set.
  - `POST /api/v1/arc/runs` — bearer-gated (`ARC_AGENT_API_TOKEN`); runs `runArcPartnerCampaign` from `@/lib/arc/orchestrator`. Returns `503 not_configured` if Supabase admin isn't set up. `POST /api/v1/arc/ping` is the bearer-gated health/connectivity check.
  - `GET /api/v1/approvals/history` — bearer-gated (`ARC_AGENT_API_TOKEN`) read of the approval-decision ledger via `listApprovalHistory` (`@/lib/approvals/read-model`). **Read-only, and it is the only route under `/api/v1/approvals`.** There is no `POST /api/v1/approvals` — no programmatic *write* approval surface exists, by design: deciding is the human gate. Arc's own read side is `GET /api/v1/arc/approvals` and `GET /api/v1/arc/approvals/[id]`; Arc may add a recommendation (`approval_recommendations`) but never decides, and `src/app/api/v1/arc/__tests__/safety.test.ts` enforces that structurally. If a programmatic decide endpoint is ever built, read the `decideApprovalItem` warning below first.
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

Some `src/lib/<feature>/` dirs are backend-only on purpose — reached by Arc's API routes with no operator UI: `vault` (`src/lib/vault/` + `src/domain/notebook.ts`, served by `/api/v1/arc/vault`; there is no `/vault` page), plus `activity`, `approvals`, `partners`, `persona-intelligence`. `agent-operations` belongs on that backend-only list too: it has no page, but it **is live** — `src/app/api/v1/arc/tasks/route.ts` → `@/lib/arc-api` → `arc-api/tasks.ts` → `agent-operations/read-model` (`getAgentTaskDetail`). Changing it changes what Arc's task API returns. `loss-routing` is the only *directory* that is genuinely **unwired** — `getLossRoutingData` and `routingDisplay` have no consumer anywhere in `src/` — so treat that one as dead and confirm before building on it.

⚠️ **There is exactly one `decideApprovalItem` — `src/lib/campaigns/decisions.ts`. Don't create a second one under `src/lib/approvals/`.** One existed there until 2026-08-05 and was deleted (audit BSR-695 follow-up). It had no importer anywhere, and prod confirmed it had never run: zero `approval_revision` rows in `agent_tasks`, and not one of the 11 `approval_decisions` carried the `metadata.action` key it always wrote. It was not harmlessly dead — it was a preserved copy of the BSR-695 stranded-task bug, kept superficially current because the tenancy waves (#466, BSR-720, BSR-713) all edited it. Its revision path (1) never called `notifyArcCampaignTask`, and nothing polls `agent_tasks` — the wake POST is the only dispatcher, so every task it wrote would strand; (2) looked up the agent by `key = "arc-demo"` while every live path uses `key = "arc"`, so it returned early and wrote nothing; and (3) resolved its tenant from the ambient operator session, which a bearer-token caller does not have (the BSR-626 session-less pattern). Its test asserted `arc-demo`, so it stayed green on the bug. If a programmatic decide surface is ever built, extend the campaigns path and copy `src/lib/campaigns/revisions.ts` — `key = "arc"`, explicit wake, loud on failure — rather than reviving this shape.

When wiring approval actions, make them real backend state transitions. Use the ContentEngine-style pattern for campaigns and ads: Arc creates a draft, the item enters approval with prompt inputs/source records/output/risk flags, and the human can approve, decline, request revision, or archive. Approved items unlock the next backend step; declined or blocked items stay unavailable.

## Arc as Lead Marketing Agent

Arc is **not** a generic chatbot. Arc is a lead marketing operator/orchestrator that acts for **one workspace at a time, defined entirely by that workspace's context** — its industry, brand voice, personas, approved media, connected channels, and compliance rules (`apps/arc-runner/src/prompt.ts`). This app is Arc's command center for finding source-backed opportunities, mapping them to personas, generating approval-gated campaign packages, organizing creative assets, and learning from performance.

**Build tenant-agnostic marketing workflows, not BSR-specific ones.** Big Shoulders Restoration is the first real tenant and the dogfood account, not the product's shape — the ICP is owner-operator local service businesses generally (`docs/POSITIONING.md`), and the vocabulary layer that makes that real is `docs/UNIVERSALITY.md`. Prefer a deep marketing workflow over a generic SaaS/CRM pattern, but never one that only works for a restoration contractor. If a feature needs industry-specific nouns, take them from the workspace's industry template — don't hardcode them.

### Core operating principle (non-negotiable)

- **Agent does the work. Human approves decisions. Database remembers everything.**
- **No outbound send/publish/launch/spend/contact action happens without explicit human approval.** Never add automatic outbound behavior. Keep every change approval-safe.
- Arc may draft, recommend, score, prepare assets, and create approval-ready records — nothing that reaches the outside world without a human gate.
- Prefer **the workspace's own approved media** wherever possible. AI creative should enhance/package/resize/test that authentic proof, not replace it.
- **Higgsfield** is active (Ultra plan, 2026-06-24). Arc reaches it through the per-workspace **`higgsfield` remote-MCP connector** (`src/domain/connectors.ts` → hosted MCP at `mcp.higgsfield.ai/mcp`), loaded into the runner by `apps/arc-runner/src/connectors.ts` in **draft/act modes only**. Output is always an approval-gated, provenance-tagged draft asset — never auto-outbound. The connector is **OFF until enabled per workspace with a stored Vault credential**; the runner reads it from `GET /api/v1/arc/connectors`. The curated model roster lives in `src/domain/higgsfield-models.ts`.

  **Onboarding is the in-app OAuth button**, not the capture script: Settings → Connections → Higgsfield → "Connect with Higgsfield" (`/api/connectors/higgsfield/authorize`). It needs **no env vars** — Higgsfield supports dynamic client registration, so there is no app id/secret to provision, and the button's `configured` gate only means Supabase is reachable. Verified against the live server: discovery metadata matches our hard-coded endpoints, registration returns 201 for the prod redirect URI, and `offline_access` (which mints the refresh token) is supported.

  This corrects a note that used to live here claiming **the deployed Cloud Run runner can't use a personal-account OAuth**. It can. `resolveRemoteConnectorsForRunner` calls `ensureFreshAccessToken` before every use, so the short-lived access token is auto-renewed from the refresh token and re-persisted — the headless runner never needs a browser, because it exchanges a refresh token rather than consenting. The access token's lifetime is therefore not the credential's lifetime; **the refresh token is the credential**, and it lasts until revoked.

  Two failure modes worth knowing, both now loud rather than silent: registration echoes back `grant_types` *without* `refresh_token` (probably normalization, since `offline_access` survives) — if it ever means no refresh token is issued, `exchangeCode` hard-fails at connect time naming `offline_access`; and a connector the runner has to drop (unreadable credential, failed refresh) now reports through `reportDegraded` instead of vanishing. `scripts/connectors/capture-higgsfield.ts` reads `~/.claude/.credentials.json`, which **does not exist on macOS** (Keychain instead) — don't send anyone down that path. Multi-tenant per-workspace OAuth onboarding remains deferred.

### Product direction: a marketing operating system

The durable architecture is a shared **Persona Revenue Intelligence Layer** that powers CRM, campaigns, landing pages, approval cards, personalization, reporting, and Arc/subagent decisions — not just a CRM or campaign list. Arc should become proactive: finding leads, identifying persona groups, watching signals, drafting campaigns, preparing creative, and learning what works.

### Frontend priorities

1. **Arc Marketing Command Center** — surface waiting Arc tasks, blocked tasks, opportunity recommendations, campaign packages needing approval, recent assets, competitor/weather signals, and run logs.

2. **Persona Revenue Intelligence fields** — expose on companies, contacts, leads, campaigns, and approval cards where relevant: primary persona, secondary personas, persona confidence, relationship stage, urgency, service need, lead score, revenue opportunity score, relationship score, next best action, recommended CTA, recommended message angle, recommended proof points, recommended nurture/follow-up. (Personas are **per-org data**, not a fixed list — see Tenant Configurability below.)

3. **Campaign Package Builder** — campaign records support complete packages: campaign brief; target audience; similar/lookalike audiences considered; persona and relationship logic; email draft; SMS draft; paid social/ad copy; landing/one-pager copy; sales/partner handoff note; asset list; approved media references; generated asset IDs/URLs/paths; guardrail result; human approval status.

4. **Asset Review and Provenance** — asset cards clearly show: source type (the workspace's own real media, AI-generated, composite, stock, external); approved-media source ID when available; prompt/job ID/model when generated; format/aspect ratio (1:1, 4:5, 9:16, 16:9, PDF, MP4, etc.); status (draft, needs revision, approved, rejected); risk flags (embedded text/logo issues, unrealistic scene, privacy/redaction, claim risk); reviewer and timestamp.

5. **Opportunity Intelligence Inbox** — an inbox for source-backed opportunities from CRM inactivity, new lead/company discovery, weather events, competitor activity, newly approved media, performance anomalies, and persona segment gaps. Each opportunity shows: evidence/source links, confidence, recommended action, suggested campaign type, required approval path.

6. **Performance Learning Loop** — track outcomes so Arc can learn: campaign/channel/persona/asset attribution; impressions/clicks/replies/booked jobs/referrals where available; cost/spend if applicable; message angle used; proof/media used; conversion/business outcome; Arc's recommendation for next iteration.

### Design + implementation expectations

- The UI must make **evidence, approval state, media, and next actions obvious**. Campaign cards should not look empty when assets exist.
- Arc-created work must be **reviewable by humans before anything goes outbound** — visible, auditable, easy to approve/reject/revise.
- Before modifying the frontend: inspect existing app structure; reuse the existing components and styling patterns (the `src/app/(app)/_components/` primitives listed under Architecture, the `arc-app.css` classes, `DESIGN.md`).
- If backend fields/routes are missing, **document the required schema/API additions** (new `supabase/migrations/` file, `src/lib/<feature>/` layer, route) instead of faking frontend-only data. Wire persistence + the `requireOperator()` gate following the vault/campaigns reference shape above.

## Tenant Configurability (what a workspace can change)

The product is **configurable per company, within a fixed object model.** `docs/UNIVERSALITY.md` is the full record; this is the contract to code against.

**Tenant-defined (per-org data — never hardcode against these):**

- **Personas.** The org's `personas.slug` rows are the authority; `getOrgPersonaKeys` / `getOrgPersonaOptions` (`src/lib/personas/read-model.ts`) is how you read them. Migration `20260713120000` converted all 15 persona columns from the `persona_mapping` enum to `text`. Validate with `isAllowedPersona(persona, await getOrgPersonaKeys(orgId))`.
- **Pipeline stages.** `pipeline_stages` per org (`20260729160000`) + `leads`/`jobs`/`outcomes`.`status` widened to `text` (`20260729170000`, applied to prod by hand — `migrate-prod.yml` refuses `alter column … type`). **Ask a stage what it means (`isWon`/`isLost`/`isTerminal`/`isQualified`), never `status === "won"`** — a tenant can rename it, and a name comparison fails silently into wrong revenue numbers. Starter sets are seeded **per industry** at workspace creation (`src/lib/pipeline-stages/industry-templates.ts`); `outcomes` is deliberately never varied — it's the revenue ledger. Adding a template means keeping an `isWon` and an `isLost` terminal in every pipeline; the invariant test enforces it.
- **Custom fields** on all six CRM objects (`20260728180000`, `src/domain/custom-fields.ts`).
- **Brand + voice** — palette, fonts, tone, preferred/banned phrases, services, proof points, disallowed claims (`src/domain/brand-kit.ts`). Arc's runner reads all of it into every prompt.
- **Connectors**, enabled and configured per workspace (`src/domain/connectors.ts`).

**Fixed by decision (don't "fix" these without a product call):**

- **The six CRM objects** — `companies, contacts, properties, leads, jobs, outcomes`. Renameable and extensible, but no self-serve net-new object type (Option B; Option A reopens only on real repeated demand).
- **Object/section labels.** Free text per workspace (Settings → Records → Names), stored on `app_settings.crm_object_labels`, over a 9-key industry map as the default (`src/lib/product-language.ts`). Resolution is `getProductLanguage(industry, overrides)`: workspace words → industry template → `general`, **per object**. A workspace picks its industry at onboarding (editable in Settings → General); that key also seeds its persona pack (`src/lib/personas/industry-templates.ts`). A workspace supplies **both** plural and singular — a partial pair is refused, not half-applied. Pass the overrides at every call site: omitting them silently serves industry labels.
- **App-machinery states** — `approval_status`, `agent_task_status`, `campaign_status`. The rule (`src/domain/pipeline-stages.ts`): *per-org if it describes the tenant's process, never if the code branches on it.* Configurable approval states would let a tenant rename their way through the outbound gate.

**`OFFICIAL_PERSONA_MAPPINGS` is demo seed + offline fallback, not the validation authority.** Its remaining non-test imports are all `personaOptions?.length ? … :` fallbacks for the backend-less preview. Don't extend it and don't validate against it. Same for `campaigns.restoration_focus`: superseded by the free-text `campaign_theme`, kept nullable for back-compat only.

## Lead Ingestion Contract (don't break this)

- Persona validity is **per-org**: the ingest route validates against the org's own persona keys, not a global list. `parseLeadIngestionPayload` takes the allowed keys as an argument — pass `getOrgPersonaKeys(orgId)`.
- `unassigned_persona` is **internal-only** — the ingest API rejects it, and the DB enforces it via `leads_persona_not_unassigned_check` (now a text check, still live).
- Ingest response codes are load-bearing: `400` (validation/persona rejection), `202` (accepted but Supabase not configured — no row written), `201` (accepted + persisted), `502` (persistence error).
- Routing and scoring are intentionally **deterministic and owned by the app layer** (not the DB) so they stay unit-testable. Don't push that logic into Postgres.

## Design System

UI work must follow `DESIGN.md` — the warm obsidian + antique gold palette (`--canvas` `#16161a`, `--accent` `#c8a24a`, red `--priority` `#cc6666` for destructive only); no emojis, no purple/neon AI aesthetic, no equal 3-column dashboard rows.

## Env

Copy `.env.example` → `.env.local`. Without Supabase vars, the ingest route still validates and scores but returns `202` with `persistence.status: "not_configured"` — useful for local dev.

Key vars: `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (persistence); `OPERATOR_ACCESS_TOKEN` / `OPERATOR_EMAIL` / `OPERATOR_PASSWORD` (operator UI gate — leave unset locally to stay open); `ARC_AGENT_API_TOKEN` (bearer for `POST /api/v1/arc/runs`). `pnpm seed:arc-demo` seeds demo data; `pnpm seed:test-campaign` seeds a campaign for the wired campaigns flow.

# Architecture

A one-page orientation map. For the detailed contract — auth, the wired-vs-scaffold
feature list, the Arc product direction, and conventions — see [`CLAUDE.md`](./CLAUDE.md).

## Repo shape

This is **intentionally a single pnpm monorepo, not multiple repos.** A single
feature commonly spans the app, the shared package, and the runner; one repo
keeps them in lockstep and lets a change land atomically. Three workspaces:

- **Root app** (`./`) — Next.js 16 + React 19 control plane: the operator UI and
  the `/api/v1` API surface. This is Arc's command center.
- **`apps/arc-runner`** — the TypeScript Arc agent runner. Receives the chat
  wake, runs Arc via the Claude Agent SDK, and posts replies back to the app.
- **`packages/arc-connector`** — shared connector helpers for attaching an Arc
  agent to a hosted Arc Studio workspace.

## Deploy targets

- **App → Vercel**, auto-deploying from `origin/main`.
- **Runner → Google Cloud Run**, as a container built from
  `apps/arc-runner/Dockerfile` (via `apps/arc-runner/cloudbuild.yaml` /
  `apps/arc-runner/deploy-cloud-run.sh`). Operational runbook:
  [`docs/arc-runner-cloud-run-runbook.md`](./docs/arc-runner-cloud-run-runbook.md).

## Data

- **Supabase Postgres.** The admin client is created lazily from
  `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
- Schema lives in `supabase/migrations/` — ordered, timestamp-prefixed files
  applied in sequence. **Never edit a shipped migration; add a new timestamped
  file.**
- **Graceful degradation:** without Supabase env vars the app does not throw —
  it skips persistence. For example, `POST /api/v1/leads/ingest` still validates
  and scores the payload but returns `202` with no row written.

## Auth (two independent mechanisms)

Don't conflate these:

- **Operator gate (human UI).** Opt-in via `OPERATOR_ACCESS_TOKEN` /
  `ARC_AUTH_MODE`; when unset, everything is open (local dev). When enabled, page
  routes require a session cookie, enforced at the edge by `src/proxy.ts` —
  Next.js 16's renamed middleware (`middleware` → `proxy`). Server actions also
  call `requireOperator()` for defense-in-depth.
- **API bearer tokens (programmatic callers).** `/api/v1` routes are *not*
  covered by the operator gate; each validates its own bearer token (e.g.
  `ARC_AGENT_API_TOKEN` for `POST /api/v1/arc/runs`).

## Layering convention

`src/domain/` → `src/lib/<feature>/` → `src/app/<route>/`:

- **`src/domain/`** — pure, deterministic business logic. No I/O. Heavily
  unit-tested.
- **`src/lib/<feature>/`** — I/O: persistence, read-models, and repos over
  Supabase.
- **`src/app/<route>/`** — server-component views with colocated
  `_components/` / `_data/`.

## Live vs. scaffold

Not every page is wired. Three features have real persistence and serve as the
reference shape (`"use server"` actions gated by `requireOperator()` +
`isSupabaseAdminConfigured()`, persisting through a `src/lib/<feature>/` layer):

- **Vault notebook** (`src/app/vault/`, `src/lib/vault/`)
- **Campaigns** (`src/app/campaigns/`, `src/lib/campaigns/`)
- **CRM interactions** (`src/app/crm/.../record-interactions/`,
  `src/lib/interactions/`)

Many other pages are intentionally **scaffold/preview-only** — they render the
operator views but write no data until each feature is wired following that same
shape. See [`CLAUDE.md`](./CLAUDE.md) for the full wired-vs-scaffold contract.

## Where things live / further reading

- [`CLAUDE.md`](./CLAUDE.md) — the authoritative architecture, auth, and feature
  contract.
- [`DESIGN.md`](./DESIGN.md) — the design system.
- [`docs/arc-runner-cloud-run-runbook.md`](./docs/arc-runner-cloud-run-runbook.md)
  — deploying and operating the runner on Cloud Run.
- [`docs/`](./docs/) — runbooks, contracts, audits, and product notes.

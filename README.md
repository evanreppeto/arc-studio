# Arc — Marketing Operating System

Arc is a marketing operating system built around an agent of the same name. Arc
acts as a business's lead marketing operator: it finds source-backed
opportunities, maps them to personas, drafts approval-gated campaign packages,
organizes creative assets, and learns from performance. This app is Arc's
command center — the control plane where a human operator reviews, approves, and
directs that work. It is built on Next.js 16, React 19, and Supabase.

## The approval-safety principle (non-negotiable)

**Arc drafts, recommends, scores, and prepares assets. Humans approve decisions.
The database remembers everything.** No outbound send, publish, launch, spend,
or contact action ever happens without explicit human approval. Arc can create
approval-ready records — nothing reaches the outside world without a human gate.

## Repo layout

This is a single **pnpm monorepo** with three workspaces:

- **Root app** (`./`) — the Next.js 16 + React 19 control-plane app (operator UI
  and the `/api/v1` API surface). Deploys to Vercel.
- **`apps/arc-runner`** — the TypeScript Arc agent runner. It receives a chat
  wake, runs Arc via the Claude Agent SDK, and posts replies back to the app.
  Deploys to Google Cloud Run.
- **`packages/arc-connector`** — shared connector helpers for attaching an Arc
  agent to a hosted Arc Studio workspace.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full repo map (deploy
targets, data, auth, and layering).

## Local development

Requires **Node 20** and **pnpm** (pinned via the `packageManager` field and
`.nvmrc`).

```bash
pnpm install
cp .env.example .env.local   # fill in values as needed
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Most config is optional locally. Without Supabase env vars
(`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) the app still runs and
degrades gracefully — for example, the lead-ingest route validates and scores a
payload but returns `202` without persisting. The operator-gate vars
(`OPERATOR_ACCESS_TOKEN`, `OPERATOR_EMAIL`, `OPERATOR_PASSWORD`, and
`ARC_AUTH_MODE`) are also optional: leave them unset and every page route stays
open for local work. See `.env.example` for the full, documented list.

## Verification / quality gates

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm test        # vitest run (one-shot)
pnpm build       # next build
```

These run automatically in CI on every pull request
(`.github/workflows/ci.yml`), across the app and the `arc-runner` /
`arc-connector` workspaces.

## Deploy

- **App** → Vercel, auto-deploying from `origin/main`.
- **Arc runner** → Google Cloud Run (container built from
  `apps/arc-runner/Dockerfile`). See
  [`docs/arc-runner-cloud-run-runbook.md`](./docs/arc-runner-cloud-run-runbook.md).

## Where to learn more

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — one-page orientation map of the repo.
- [`CLAUDE.md`](./CLAUDE.md) — the deep architecture/auth/feature contract and
  conventions.
- [`DESIGN.md`](./DESIGN.md) — the design system.

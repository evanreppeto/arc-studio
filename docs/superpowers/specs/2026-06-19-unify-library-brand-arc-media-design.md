# Unify Library + Brand, and Give Arc Access to the Media Library

**Date:** 2026-06-19
**Status:** Approved design — pending implementation plan

## Problem

The app presents `Library` and `Brand` as two separate top-level nav entries, which
reads as two separate asset stores. It isn't. Both already write to the **same**
`media_assets` table and the **same** Supabase storage bucket. "Brand" is really two
things stacked: the brand-kit settings (`business_profiles`) plus a filtered *lens*
over library assets that get synced into the knowledge graph as text facts.

Two real problems follow:

1. **UI fragmentation.** Operators see two sections for what is one asset pool.
2. **Arc can't reference real media.** Every asset carries an `available_to_arc`
   flag, but **nothing in the Arc runner reads it**. Arc receives only aggregated
   brand context + trusted brain facts (all text). It can *generate* new AI images
   but cannot *see or reuse* the real BSR photos already uploaded — which directly
   conflicts with the product rule "prefer approved real BSR media."

Merging the tabs does **not** by itself give Arc access to images; they are
independent fixes. This spec does both.

## Goals

- Collapse Library + Brand into one section (`/library` is home; brand kit becomes a
  view inside it).
- Give the Arc runner a tool to list library assets marked `available_to_arc`.
- Give the Arc runner a tool to attach a real library asset to a campaign draft as
  *recommended media*, staying fully approval-gated.

## Non-Goals (explicit phase 2)

- Feeding image assets into the knowledge graph so Arc *proactively* suggests
  campaigns around them. Documented as a follow-on; not built here.
- Any Higgsfield / AI-production wiring (stays operationally off per CLAUDE.md).
- No outbound send/publish/spend behavior of any kind.

## Current State (verified)

- **Library** — `src/app/library/` (page, `_components/`, `actions.ts`); read model
  `src/lib/media-library/read-model.ts`; persistence `src/lib/media-library/persistence.ts`.
  Tables: `media_assets`, `media_folders`. Storage bucket `campaign-media`, paths
  `library/{orgId}/{assetId}-{fileName}`. Assets carry `available_to_arc: boolean`.
- **Brand** — `src/app/brand/` (page, `_components/`, `actions.ts`); brand kit
  persistence `src/lib/brand-kit/persistence.ts` over `business_profiles`; brand
  knowledge in `src/lib/brand-knowledge/`. Brand "uploads" insert into `media_assets`
  tagged `provenance.brandSource: true`, then sync into `knowledge_nodes`
  (`ref_table: "media_assets"`).
- **Nav** — hardcoded array in `src/app/_components/console-frame.tsx`
  (`Brand` → `/brand` ~line 111, `Library` → `/library` ~line 117). NOT in
  `growth-engine.ts`. This is a known merge-collision hotspot — edit carefully.
- **Arc runner** — `apps/arc-runner/`. Fetches context via bearer-gated endpoints
  (e.g. `GET /api/v1/arc/brand/context`, `GET /api/v1/arc/brain/recall`). Tools:
  `tools/media.ts` (generate_image, generate_video → `campaign_assets`),
  `tools/brand.ts`. **No** "list library media" / "select approved media" tool exists.
- `campaign_assets.audit_payload` already supports a `library_asset_id` reference.

## Design

### Part 1 — Unified UI (Library is home)

- Remove the `Brand` entry from the `console-frame.tsx` nav array. Keep `Library` as
  the single asset home. (Watch the merge-collision hotspot — verify the array still
  has every other entry after editing.)
- `/library` keeps the asset grid + folders, unchanged at the data layer.
- Brand kit settings move to a sub-page **`/library/brand`**, reached via an in-page
  tab / segmented control at the top of the library ("Assets · Brand"). Reuse
  `PageHeader`/`Panel` primitives; follow `DESIGN.md` (no eyebrow kickers, no
  `--surface` bare token).
- "Brand sources" become a **filter** in the asset grid (alongside existing filters)
  rather than a separate page, since they are already tagged `media_assets`
  (`provenance.brandSource: true`).
- **`/brand` redirects to `/library/brand`** so existing links (and any references to
  the route) don't break. Note: the `/brand/arc-mark.png` and `/brand/arc-wordmark.png`
  asset paths are static `public/` files, NOT this route — the redirect must not
  shadow them. Scope the redirect to the exact `/brand` page route only.

### Part 2 — Arc can see the library

- New bearer-gated endpoint **`GET /api/v1/arc/media`** in the marketing app.
  - Auth: `checkBearerToken(request, "ARC_AGENT_API_TOKEN")`, matching sibling routes.
  - Guard with `isSupabaseAdminConfigured()`; return `503 not_configured` when unset,
    consistent with other `/api/v1/arc` routes.
  - Org scope via `getCurrentOrgId()` (same as other Arc endpoints).
  - Returns assets where `available_to_arc = true`: `id`, `file_name`, `public_url`,
    `kind`, `tags`, `width`, `height`, `provenance`, `risk_flags`. Read-only.
- New runner tool **`apps/arc-runner/src/tools/library.ts` → `list_media`** that calls
  the endpoint and returns the asset list to Arc. Register it alongside the existing
  media/brand tools.

### Part 3 — Arc attaches real media to drafts (approval-safe)

- Second runner tool **`attach_media`**: given a campaign draft + a `library_asset_id`,
  attaches that asset to the draft's asset list.
- Backend: writes to `campaign_assets` with `source: "library"` and `library_asset_id`
  in `audit_payload` (column already exists). Likely a thin endpoint
  (`POST /api/v1/arc/campaigns/{id}/media` or similar) following the existing Arc CRM
  interactions write pattern — confirm exact shape against
  `POST /api/v1/arc/crm/interactions` during planning.
- **Approval invariant:** the asset lands as *recommended media* on a draft the
  operator must still approve / swap / reject. Nothing reaches outside. No auto-send.

## Data / Schema Impact

- **No new tables.** Reuses `media_assets`, `media_folders`, `campaign_assets`,
  `business_profiles`.
- **No migration expected** if `available_to_arc` and `campaign_assets` /
  `library_asset_id` already exist as verified. If planning finds a missing column,
  add a new timestamped migration in `supabase/migrations/` (never edit shipped ones)
  and remember prod schema drift — prod is `qqbecyrhnowmooyjiztz`, migrations applied
  manually.

## Auth / Safety

- New endpoints are programmatic Arc surfaces → bearer-gated via `checkBearerToken`,
  NOT the operator cookie gate. The operator gate continues to cover the `/library`
  UI via `proxy.ts` + `requireOperator()` in server actions.
- Every Arc capability here is read or draft-only. No outbound action. Reaffirms the
  non-negotiable: agent prepares, human approves, DB remembers.

## Testing

- **Domain/unit:** any new pure shaping logic (e.g. mapping `media_assets` rows to the
  Arc media DTO) gets a unit test under the relevant `__tests__`.
- **Endpoint behavior:** `GET /api/v1/arc/media` returns `503` when Supabase unset,
  `200` with only `available_to_arc = true` rows when configured, `401` without bearer.
- **Runner tools:** `list_media` / `attach_media` exercised against the endpoints.
- **UI smoke:** `/library` renders grid + brand tab; `/brand` redirects to
  `/library/brand`; `/brand/*.png` static assets still resolve.
- Run `pnpm build` (tsc) after — lint alone won't catch typed-Supabase-enum errors;
  run tsc on main after merge (post-merge semantic-conflict risk on shared payload types).

## Rollout Notes

- Marketing app auto-deploys from `origin/main` (Vercel). Rebase on fresh `origin/main`
  before merging; regenerate `pnpm-lock.yaml` locally (never resolve lockfile conflicts
  in GitHub's web editor).
- The Arc runner is a separate deploy (Cloud Run) — the new tools ship with the runner,
  the new endpoints ship with the marketing app. Sequence: deploy endpoints first
  (backward-compatible), then the runner tools that depend on them.

## Open Questions for Planning

1. Exact endpoint shape for `attach_media` — confirm against existing
   `POST /api/v1/arc/crm/interactions` write path.
2. Whether the brand-source "filter" reuses an existing filter mechanism in
   `asset-grid.tsx` or needs a small addition.
3. Confirm `available_to_arc` and `campaign_assets.library_asset_id` exist in the
   live schema before assuming no migration.

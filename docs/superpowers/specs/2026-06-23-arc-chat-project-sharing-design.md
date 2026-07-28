# Arc Chat & Project Sharing — Design

- **Date:** 2026-06-23
- **Status:** Approved (pending spec review)
- **Author:** Arc (with Evan)

## Problem

In this multi-tenant marketing OS, nearly all data is **org-scoped** — every active member of a
workspace already sees all CRM, campaigns, vault notes, and interactions for that org. That "share
everything in the workspace" posture is correct for a team working a shared book of business.

The exception is **Arc chats and projects**. Today `arc_conversations`, `arc_messages`, and
`arc_projects` have **no `org_id`/`workspace_id` and no RLS** — they are keyed only by an `operator`
text string. This is a no-man's-land:

1. **Cross-tenant leak risk** — without tenancy columns or RLS, chat rows are not isolated per org.
2. **Not actually private** — there is no real per-user ownership; the `operator` string is not a user.
3. **No sharing primitive** — there is no way to deliberately share one thread or project with a teammate.

We want Arc chats/projects to be **private to their owner by default**, with the owner able to share
deliberately. This both closes the tenancy gap and delivers the sharing feature in one coherent move.

## Goals

- Scope Arc chats and projects to `(org_id, workspace_id, owner_id)` and add RLS (close the leak).
- Private-by-default ownership for chats and projects.
- Owner can make a chat/project **visible to the whole workspace** OR **share with specific teammates**.
- Each share carries a **view** or **collaborate** permission (Google-Docs style).
- Sharing a project **cascades** to the chats and saved items inside it.
- Keep everything else in the workspace shared exactly as it is today.

## Non-Goals (YAGNI)

- No public / external share links or link-with-token access.
- No comment threads on shared chats.
- No email/notification on share (in-app visibility only for v1).
- No change to how non-chat data (CRM, campaigns, vault) is shared — it stays workspace-shared.

## The Model (one sentence)

Every Arc chat and project is **private to its owner by default**; the owner can make it **visible to
the whole workspace** or **share it with specific teammates**, each share carrying a **view** or
**collaborate** permission.

## Data Model Changes

All changes land in a single new timestamped migration under `supabase/migrations/`. Existing shipped
migrations are not edited.

### `arc_conversations` — add columns

| Column | Type | Notes |
|--------|------|-------|
| `org_id` | uuid FK → organizations | Closes cross-tenant leak |
| `workspace_id` | uuid FK → workspaces | Tenancy |
| `owner_id` | uuid FK → auth.users | Real owner; `operator` text kept for display/back-compat |
| `visibility` | enum `'private' \| 'workspace'` | Default `'private'` |
| `workspace_permission` | enum `'view' \| 'collaborate'` | Used only when `visibility='workspace'`; default `'view'` |

### `arc_messages` — add columns

| Column | Type | Notes |
|--------|------|-------|
| `org_id` | uuid FK → organizations | Denormalized for RLS |
| `workspace_id` | uuid FK → workspaces | Denormalized for RLS |
| `author_user_id` | uuid FK → auth.users, nullable | Who sent it; null for `arc`/`system` roles. Lets a collaborator's message be attributed correctly. |

### `arc_projects` — add columns

Same additions as `arc_conversations`: `org_id`, `workspace_id`, `owner_id`, `visibility`,
`workspace_permission`.

### New: `arc_conversation_shares`

```
conversation_id  uuid FK → arc_conversations (cascade delete)
user_id          uuid FK → auth.users
permission       enum 'view' | 'collaborate'
shared_by        uuid FK → auth.users
created_at       timestamptz default now()
unique (conversation_id, user_id)
```

### New: `arc_project_shares`

Same shape as `arc_conversation_shares`, keyed by `project_id`.

### `arc_saved_items`

Scoped via its parent project; access cascades with project sharing. (Already has `org_id`; add
`workspace_id` if missing for consistency, but inherit visibility from the project rather than carrying
its own share rows.)

## Access Rule

A user may **view** conversation `C` if **any** of:

- they are the owner (`owner_id = me`), **or**
- `C.visibility = 'workspace'` and they are an active member of `C.workspace_id`, **or**
- a row exists in `arc_conversation_shares` for `(C, me)`.

**Effective permission** = `collaborate` if (owner) OR (their share grants collaborate) OR
(`visibility='workspace'` and `workspace_permission='collaborate'`); otherwise `view`.

Projects use the identical rule against `arc_project_shares`. A chat inside a shared project inherits
the project's grant (cascade): if a user can access project `P` at permission `X`, they can access the
chats and saved items in `P` at permission `X`, even without a direct conversation share.

## Enforcement

The app reads through the **service-role Supabase client, which bypasses RLS**. Therefore:

- **Primary gate (app layer):** a new `src/lib/arc/sharing.ts` exposes:
  - `resolveConversationAccess(conversationId, userId) -> { canView, permission } | null`
  - `assertConversationAccess(conversationId, required: 'view' | 'collaborate')` — throws/redirects on failure, used by every read and mutation, mirroring how `requireOperator()` is used today.
  - Project equivalents (`resolveProjectAccess`, `assertProjectAccess`), which the conversation
    resolver consults for the cascade.
- **Defense-in-depth (DB layer):** RLS policies on all five tables, matching the `agent_tasks` tenancy
  pattern (`app_private.is_workspace_member(...)`, owner check, share-exists check). Both layers ship —
  not one.

## Server Actions & API (wired pattern)

Follow the vault/campaigns reference shape: real `"use server"` actions gated by `requireOperator()` +
`isSupabaseAdminConfigured()`, persisting via `src/lib/arc/sharing.ts`, then `revalidatePath`.

- `setConversationVisibility(id, 'private' | 'workspace', permission)`
- `shareConversation(id, userId, 'view' | 'collaborate')`
- `unshareConversation(id, userId)`
- Project equivalents: `setProjectVisibility`, `shareProject`, `unshareProject`.
- **Read model:** the chat list filters to *owned + shared-with-me + workspace-visible*; loading a
  thread routes through `assertConversationAccess`.
- **Collaborate path:** when a collaborator sends a message, it is stamped with their `author_user_id`;
  Arc replies into the same thread via the existing `agent_tasks` flow (already org/workspace-scoped).
  A `view`-only user cannot post.

## UI

- **Share button** on the chat header and the project header → a share dialog:
  - workspace-member picker (from the `workspace_memberships` roster) with a per-person
    view/collaborate selector,
  - a "Visible to everyone in this workspace" toggle with its own view/collaborate setting,
  - list of current shares with the ability to change permission or remove.
- Chat list gains a lightweight **"Shared with me"** grouping and a small shared/owner indicator.
- If effective permission is **view**, the composer is disabled with a quiet
  "View-only — shared by {owner}" note.
- Built on existing `src/app/_components/page-header.tsx` primitives and `DESIGN.md`
  (Command Charcoal / Canvas White / Restoration Red; no emojis; restraint + the editorial signature;
  no equal 3-column rows; use existing CSS vars, no bare `--surface` token).

## Migration & Rollout

- One new timestamped migration: adds columns + the two share tables + enums + RLS, and **backfills**:
  - all existing `arc_conversations` / `arc_messages` / `arc_projects` → BSR org + default workspace,
  - `owner_id` resolved from the existing `operator` value,
  - `visibility = 'private'`.
  - Net effect: nothing becomes visible to anyone who could not already see it.
- **OPEN ASSUMPTION to confirm:** the `operator` text column does not map cleanly to an `auth.users`
  row. The backfill will resolve `owner_id` to the BSR workspace's owner user (effectively Evan). If
  there are multiple distinct human operators in prod whose chats must stay separate, the backfill
  mapping needs adjusting before the migration runs. **Confirm before applying to prod.**
- **PROD RELEASE STEP:** this migration must be applied to the real prod DB (`qqbecyrhnowmooyjiztz`)
  **manually** — Vercel auto-deploys code from `origin/main` but does **not** apply Supabase migrations,
  and prod has had schema-drift surprises before. Apply migration before/with the deploy that ships the
  code that selects the new columns.

## Testing

- **Domain/unit:** the access-rule resolver (owner / workspace-visible / shared / cascade /
  permission-escalation) as a pure function over inputs, unit-tested in the `src/lib/arc` or
  `src/domain` test style. The pure decision logic should not require Supabase.
- **Persistence-guarded:** share/unshare/visibility actions degrade gracefully when Supabase is not
  configured (`isSupabaseAdminConfigured()` false), consistent with the rest of the app.
- **Type/build:** run `tsc` / `pnpm build` (not just `pnpm lint`) — typed Supabase enums need literal
  unions, and lint does not typecheck.

## Sequencing (for the implementation plan)

1. Migration: columns, share tables, enums, RLS, backfill.
2. `src/lib/arc/sharing.ts`: access resolvers + assert helpers (pure rule unit-tested).
3. Read-model update: list filtering + thread load gating.
4. Server actions: visibility + share/unshare (conversations, then projects).
5. Collaborate path: `author_user_id` stamping on inbound messages.
6. UI: share dialog, "shared with me" grouping, view-only composer state.
7. Verify: tsc/build, targeted tests, local smoke.

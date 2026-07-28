# Arc Chat & Project Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Arc chats and projects private-to-owner by default, scoped to org/workspace, with the owner able to share each one to the whole workspace or with specific teammates at a `view` or `collaborate` permission — closing the current `arc_conversations`/`arc_messages`/`arc_projects` tenancy gap in the same change.

**Architecture:** A pure access-decision function in `src/domain/arc-sharing.ts` (heavily unit-tested, no I/O) decides `{ canView, permission }` from a resource's ownership/visibility plus a viewer's grants. An I/O layer in `src/lib/arc-chat/sharing.ts` loads the inputs (conversation/project rows, workspace membership, share rows, project cascade) and calls the pure function; it also persists share/visibility writes. Enforcement is app-layer-primary (the service-role client bypasses RLS) with RLS policies as defense-in-depth, mirroring the `agent_tasks` tenancy pattern. In `open`/local auth mode, enforcement is bypassed so dev stays open exactly as today.

**Tech Stack:** Next.js 16 (App Router, server components + `"use server"` actions), React 19, Supabase (Postgres + RLS), TypeScript, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-23-arc-chat-project-sharing-design.md`

---

## Critical context for the implementer (read before starting)

- **pnpm only.** `pnpm test`, `pnpm test <file>`, `pnpm build`, `pnpm lint`.
- **`pnpm lint` does NOT typecheck** and scans ~31k vendored problems. To check types run `pnpm build` (or `pnpm exec tsc --noEmit`). To check lint on your work, scope eslint to changed files.
- **Arc tables are accessed through the loosely-typed admin client** and are NOT present in `src/lib/supabase/database.types.ts`. The existing `src/lib/arc-chat/persistence.ts` does `client.from("arc_conversations")` with no generated row types and casts results (`as ConversationRow[]`). New tables/columns follow the same approach — **do not** edit `database.types.ts`. `pnpm build` is the gate that everything still typechecks.
- **Enums are text + check constraints** in this codebase, never `create type ... as enum`. (e.g. `role text not null check (role in ('operator','arc','system'))`.)
- **Two auth mechanisms.** Server actions/components gate humans with `requireOperator()` (`src/lib/auth/operator.ts`). `getAuthMode()` (`src/lib/auth/auth-mode.ts`) returns `"open" | "supabase" | ...`; in `"open"` mode there is no authenticated user and the app is intentionally wide open.
- **Current user id:** `getSupabaseAuthenticatedUser()` from `src/lib/supabase/auth-server.ts` returns the auth user or `null`.
- **Wired-feature reference shape:** `src/app/campaigns/actions.ts` + `src/lib/campaigns/*` and `src/lib/vault/persistence.ts` + `src/app/vault/actions.ts` — `requireOperator()` → `isSupabaseAdminConfigured()` guard → persistence call (passing the admin client) → `revalidatePath`.
- **Admin client:** `getSupabaseAdminClient()` / `isSupabaseAdminConfigured()` from `src/lib/supabase/server.ts`.
- **Migrations are append-only.** Never edit a shipped migration. New file: `supabase/migrations/20260623090000_arc_conversations_tenancy_sharing.sql` (latest existing is `20260622180000_*`).
- **Memory — prod release:** the marketing app auto-deploys to Vercel from `origin/main`, but **Supabase migrations are applied to the prod DB (`qqbecyrhnowmooyjiztz`) manually**. This migration must be applied by hand as a release step, because Vercel does not run migrations. (This doc originally said the Supabase MCP could not reach prod; that is no longer true — `apply_migration` works against it.)
- After any merge touching `src/domain/index.ts`, verify all exports from both sides survive and run `pnpm build` (web-merge has dropped export lines before).

---

## File Structure

**Create:**
- `src/domain/arc-sharing.ts` — pure access-decision logic + types + validators. No I/O.
- `src/domain/__tests__/arc-sharing.test.ts` — unit tests for the pure logic.
- `supabase/migrations/20260623090000_arc_conversations_tenancy_sharing.sql` — columns, share tables, RLS, backfill.
- `src/lib/arc-chat/sharing.ts` — I/O: viewer resolution, access resolution (conversation + project, with cascade), share/visibility writes.
- `src/app/arc/sharing-actions.ts` — `"use server"` actions for visibility + share/unshare (conversations + projects).
- `src/app/arc/_components/share-dialog.tsx` — share UI (member picker + workspace toggle + current-shares list).

**Modify:**
- `src/domain/index.ts` — re-export from `./arc-sharing`.
- `src/lib/arc-chat/persistence.ts` — add `listConversationsForViewer`, and `org_id`/`workspace_id`/`owner_id`/`author_user_id` awareness on insert/read.
- `src/app/arc/page.tsx:91` — route the conversation list (and archived list) through the viewer-aware reader; gate the requested-thread load through access.
- `src/app/arc/actions.ts` — stamp `author_user_id` on inbound operator messages; block posting when the viewer's permission is `view`.
- `src/app/arc/_components/arc-chat.tsx` — add the Share button to the chat header.
- `src/app/arc/_components/thread-sidebar.tsx` — add a "Shared with me" grouping + owner/shared indicator.
- `src/app/arc/_components/composer.tsx` — view-only disabled state.

---

## Task 1: Pure access-decision domain module

**Files:**
- Create: `src/domain/arc-sharing.ts`
- Test: `src/domain/__tests__/arc-sharing.test.ts`
- Modify: `src/domain/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/__tests__/arc-sharing.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import {
  hasRequiredPermission,
  resolveResourceAccess,
  strongerPermission,
  type ShareableResource,
  type ViewerGrants,
} from "../arc-sharing";

const ownerOnly: ShareableResource = {
  ownerId: "user-owner",
  workspaceId: "ws-1",
  visibility: "private",
  workspacePermission: "view",
};

const noGrants: ViewerGrants = {
  userId: "user-other",
  isWorkspaceMember: true,
  directShare: null,
  inheritedShare: null,
};

describe("resolveResourceAccess", () => {
  it("grants the owner collaborate access", () => {
    expect(resolveResourceAccess(ownerOnly, { ...noGrants, userId: "user-owner" })).toEqual({
      canView: true,
      permission: "collaborate",
    });
  });

  it("denies a non-owner when the resource is private and unshared", () => {
    expect(resolveResourceAccess(ownerOnly, noGrants)).toEqual({ canView: false, permission: null });
  });

  it("grants workspace members the workspace permission when visibility is workspace", () => {
    const resource: ShareableResource = { ...ownerOnly, visibility: "workspace", workspacePermission: "view" };
    expect(resolveResourceAccess(resource, noGrants)).toEqual({ canView: true, permission: "view" });
  });

  it("ignores workspace visibility for non-members", () => {
    const resource: ShareableResource = { ...ownerOnly, visibility: "workspace", workspacePermission: "collaborate" };
    expect(resolveResourceAccess(resource, { ...noGrants, isWorkspaceMember: false })).toEqual({
      canView: false,
      permission: null,
    });
  });

  it("uses the strongest of direct, inherited, and workspace grants", () => {
    const resource: ShareableResource = { ...ownerOnly, visibility: "workspace", workspacePermission: "view" };
    const decision = resolveResourceAccess(resource, { ...noGrants, directShare: "collaborate" });
    expect(decision).toEqual({ canView: true, permission: "collaborate" });
  });

  it("applies an inherited (project cascade) grant when there is no direct grant", () => {
    expect(resolveResourceAccess(ownerOnly, { ...noGrants, inheritedShare: "view" })).toEqual({
      canView: true,
      permission: "view",
    });
  });

  it("treats a null viewer (open/dev mode is handled by callers) as no owner match", () => {
    expect(resolveResourceAccess(ownerOnly, { ...noGrants, userId: null })).toEqual({
      canView: false,
      permission: null,
    });
  });
});

describe("strongerPermission", () => {
  it("prefers collaborate over view over null", () => {
    expect(strongerPermission("view", "collaborate")).toBe("collaborate");
    expect(strongerPermission("view", null)).toBe("view");
    expect(strongerPermission(null, null)).toBe(null);
  });
});

describe("hasRequiredPermission", () => {
  it("requires the decision to meet or exceed the required permission", () => {
    expect(hasRequiredPermission({ canView: true, permission: "view" }, "view")).toBe(true);
    expect(hasRequiredPermission({ canView: true, permission: "view" }, "collaborate")).toBe(false);
    expect(hasRequiredPermission({ canView: true, permission: "collaborate" }, "collaborate")).toBe(true);
    expect(hasRequiredPermission({ canView: false, permission: null }, "view")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/domain/__tests__/arc-sharing.test.ts`
Expected: FAIL — cannot resolve module `../arc-sharing`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/domain/arc-sharing.ts`:

```typescript
/**
 * Pure access-decision logic for Arc chat/project sharing. No I/O.
 *
 * A resource (a conversation or a project) is private to its owner by default.
 * It can be made visible to the whole workspace, or shared with specific users,
 * each share carrying a `view` or `collaborate` permission. A chat inside a
 * shared project inherits the project's grant (cascade) — represented here as
 * `inheritedShare`. Callers in `open`/dev auth mode bypass this function
 * entirely and grant full access.
 */

export type SharePermission = "view" | "collaborate";
export type ShareVisibility = "private" | "workspace";

export const SHARE_PERMISSIONS: readonly SharePermission[] = ["view", "collaborate"] as const;
export const SHARE_VISIBILITIES: readonly ShareVisibility[] = ["private", "workspace"] as const;

export function isSharePermission(value: unknown): value is SharePermission {
  return value === "view" || value === "collaborate";
}

export function isShareVisibility(value: unknown): value is ShareVisibility {
  return value === "private" || value === "workspace";
}

/** The shareable resource's own ownership + visibility settings. */
export type ShareableResource = {
  ownerId: string | null;
  workspaceId: string | null;
  visibility: ShareVisibility;
  /** Applies only when `visibility === "workspace"`. */
  workspacePermission: SharePermission;
};

/** What the current viewer brings to the decision. */
export type ViewerGrants = {
  userId: string | null;
  /** Is the viewer an active member of the resource's workspace? */
  isWorkspaceMember: boolean;
  /** Permission from a direct share row for (resource, viewer), if any. */
  directShare: SharePermission | null;
  /** Permission inherited from a shared parent project (cascade), if any. */
  inheritedShare: SharePermission | null;
};

export type AccessDecision = { canView: boolean; permission: SharePermission | null };

export function rankPermission(permission: SharePermission | null): number {
  if (permission === "collaborate") return 2;
  if (permission === "view") return 1;
  return 0;
}

export function strongerPermission(
  a: SharePermission | null,
  b: SharePermission | null,
): SharePermission | null {
  return rankPermission(a) >= rankPermission(b) ? a : b;
}

export function resolveResourceAccess(
  resource: ShareableResource,
  viewer: ViewerGrants,
): AccessDecision {
  const grants: (SharePermission | null)[] = [];

  if (viewer.userId && resource.ownerId && viewer.userId === resource.ownerId) {
    grants.push("collaborate");
  }
  if (resource.visibility === "workspace" && viewer.isWorkspaceMember) {
    grants.push(resource.workspacePermission);
  }
  grants.push(viewer.directShare);
  grants.push(viewer.inheritedShare);

  let best: SharePermission | null = null;
  for (const grant of grants) {
    best = strongerPermission(best, grant);
  }
  return { canView: best !== null, permission: best };
}

export function hasRequiredPermission(
  decision: AccessDecision,
  required: SharePermission,
): boolean {
  return decision.canView && rankPermission(decision.permission) >= rankPermission(required);
}
```

- [ ] **Step 4: Re-export from the domain barrel**

In `src/domain/index.ts`, add (alongside the other `export * from "./..."` lines):

```typescript
export * from "./arc-sharing";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/domain/__tests__/arc-sharing.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 6: Commit**

```bash
git add src/domain/arc-sharing.ts src/domain/__tests__/arc-sharing.test.ts src/domain/index.ts
git commit -m "feat(arc): pure access-decision logic for chat/project sharing"
```

---

## Task 2: Migration — tenancy columns, share tables, RLS, backfill

**Files:**
- Create: `supabase/migrations/20260623090000_arc_conversations_tenancy_sharing.sql`

> No automated test for SQL here. The verification is `pnpm build` later (types still resolve) and the explicit review of the backfill. **Do not** add `NOT NULL` to the tenancy columns — Arc chats are also created in `open`/dev mode where there is no org, and the existing insert path must keep working.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260623090000_arc_conversations_tenancy_sharing.sql`:

```sql
-- Arc chat & project sharing + tenancy.
-- Adds org/workspace/owner scoping and per-user/workspace sharing to Arc
-- conversations and projects. Private-by-default. Enforcement is primarily
-- app-layer (service role bypasses RLS); these policies are defense-in-depth.

-- 1. Tenancy + ownership + visibility on conversations.
alter table public.arc_conversations
  add column if not exists org_id uuid references public.organizations(id) on delete cascade,
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade,
  add column if not exists owner_id uuid references auth.users(id) on delete set null,
  add column if not exists visibility text not null default 'private'
    check (visibility in ('private', 'workspace')),
  add column if not exists workspace_permission text not null default 'view'
    check (workspace_permission in ('view', 'collaborate'));

-- 2. Tenancy + authorship on messages (denormalized for RLS + collaborator attribution).
alter table public.arc_messages
  add column if not exists org_id uuid references public.organizations(id) on delete cascade,
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade,
  add column if not exists author_user_id uuid references auth.users(id) on delete set null;

-- 3. Tenancy + ownership + visibility on projects.
alter table public.arc_projects
  add column if not exists org_id uuid references public.organizations(id) on delete cascade,
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade,
  add column if not exists owner_id uuid references auth.users(id) on delete set null,
  add column if not exists visibility text not null default 'private'
    check (visibility in ('private', 'workspace')),
  add column if not exists workspace_permission text not null default 'view'
    check (workspace_permission in ('view', 'collaborate'));

-- 4. Workspace consistency for saved items (visibility inherited from the project).
alter table public.arc_saved_items
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;

-- 5. Per-user share rows.
create table if not exists public.arc_conversation_shares (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.arc_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null default 'view' check (permission in ('view', 'collaborate')),
  shared_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);

create table if not exists public.arc_project_shares (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.arc_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null default 'view' check (permission in ('view', 'collaborate')),
  shared_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

-- 6. Indexes for the read model.
create index if not exists arc_conversations_owner_idx
  on public.arc_conversations (owner_id, last_message_at desc);
create index if not exists arc_conversations_workspace_visibility_idx
  on public.arc_conversations (workspace_id, visibility);
create index if not exists arc_conversation_shares_user_idx
  on public.arc_conversation_shares (user_id);
create index if not exists arc_project_shares_user_idx
  on public.arc_project_shares (user_id);

-- 7. Backfill existing rows to the default org + default workspace (BSR).
update public.arc_conversations c
set org_id = w.org_id, workspace_id = w.id
from public.workspaces w
join public.organizations o on o.id = w.org_id
where w.key = 'default'
  and o.slug = 'big-shoulders-restoration'
  and c.workspace_id is null;

update public.arc_projects p
set org_id = w.org_id, workspace_id = w.id
from public.workspaces w
join public.organizations o on o.id = w.org_id
where w.key = 'default'
  and o.slug = 'big-shoulders-restoration'
  and p.workspace_id is null;

-- Owner = the workspace owner membership (the `operator` text is not a user).
-- ASSUMPTION (confirm before prod): a single human operator per workspace.
update public.arc_conversations c
set owner_id = m.user_id
from public.workspace_memberships m
where m.workspace_id = c.workspace_id
  and m.role = 'owner'
  and m.status = 'active'
  and m.user_id is not null
  and c.owner_id is null;

update public.arc_projects p
set owner_id = m.user_id
from public.workspace_memberships m
where m.workspace_id = p.workspace_id
  and m.role = 'owner'
  and m.status = 'active'
  and m.user_id is not null
  and p.owner_id is null;

-- Messages inherit tenancy from their conversation.
update public.arc_messages msg
set org_id = c.org_id, workspace_id = c.workspace_id
from public.arc_conversations c
where c.id = msg.conversation_id
  and msg.workspace_id is null;

update public.arc_saved_items s
set workspace_id = p.workspace_id
from public.arc_projects p
where p.id = s.project_id
  and s.workspace_id is null;

-- 8. RLS (defense-in-depth; the app reads via service role which bypasses this).
alter table public.arc_conversations enable row level security;
alter table public.arc_messages enable row level security;
alter table public.arc_projects enable row level security;
alter table public.arc_conversation_shares enable row level security;
alter table public.arc_project_shares enable row level security;

create policy arc_conversations_viewer_select on public.arc_conversations for select
to authenticated using (
  owner_id = (select auth.uid())
  or (visibility = 'workspace' and (select app_private.is_workspace_member(workspace_id)))
  or exists (
    select 1 from public.arc_conversation_shares s
    where s.conversation_id = id and s.user_id = (select auth.uid())
  )
);

create policy arc_conversations_owner_write on public.arc_conversations for all
to authenticated using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy arc_messages_viewer_select on public.arc_messages for select
to authenticated using (
  exists (
    select 1 from public.arc_conversations c
    where c.id = conversation_id
      and (
        c.owner_id = (select auth.uid())
        or (c.visibility = 'workspace' and (select app_private.is_workspace_member(c.workspace_id)))
        or exists (
          select 1 from public.arc_conversation_shares s
          where s.conversation_id = c.id and s.user_id = (select auth.uid())
        )
      )
  )
);

create policy arc_projects_viewer_select on public.arc_projects for select
to authenticated using (
  owner_id = (select auth.uid())
  or (visibility = 'workspace' and (select app_private.is_workspace_member(workspace_id)))
  or exists (
    select 1 from public.arc_project_shares s
    where s.project_id = id and s.user_id = (select auth.uid())
  )
);

create policy arc_projects_owner_write on public.arc_projects for all
to authenticated using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy arc_conversation_shares_select on public.arc_conversation_shares for select
to authenticated using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.arc_conversations c
    where c.id = conversation_id and c.owner_id = (select auth.uid())
  )
);

create policy arc_conversation_shares_owner_write on public.arc_conversation_shares for all
to authenticated using (
  exists (
    select 1 from public.arc_conversations c
    where c.id = conversation_id and c.owner_id = (select auth.uid())
  )
) with check (
  exists (
    select 1 from public.arc_conversations c
    where c.id = conversation_id and c.owner_id = (select auth.uid())
  )
);

create policy arc_project_shares_select on public.arc_project_shares for select
to authenticated using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.arc_projects p
    where p.id = project_id and p.owner_id = (select auth.uid())
  )
);

create policy arc_project_shares_owner_write on public.arc_project_shares for all
to authenticated using (
  exists (
    select 1 from public.arc_projects p
    where p.id = project_id and p.owner_id = (select auth.uid())
  )
) with check (
  exists (
    select 1 from public.arc_projects p
    where p.id = project_id and p.owner_id = (select auth.uid())
  )
);
```

- [ ] **Step 2: Sanity-check the SQL parses (best effort, optional)**

If a local Supabase/psql is available, apply it locally. Otherwise rely on the build + manual review. Do NOT apply to prod yet (see Task 8 rollout).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260623090000_arc_conversations_tenancy_sharing.sql
git commit -m "feat(arc): migration for chat/project tenancy + sharing"
```

---

## Task 3: I/O sharing layer (viewer + access resolution + writes)

**Files:**
- Create: `src/lib/arc-chat/sharing.ts`

> The functions here load DB inputs and delegate the decision to the pure domain functions from Task 1. There is no unit test for this file (it is I/O against Supabase); the pure rule it depends on is already covered. Correctness is validated via `pnpm build` (types) and the local smoke in Task 8.

- [ ] **Step 1: Write the module**

Create `src/lib/arc-chat/sharing.ts`:

```typescript
import { type SupabaseClient } from "@supabase/supabase-js";

import {
  type AccessDecision,
  type SharePermission,
  type ShareVisibility,
  hasRequiredPermission,
  resolveResourceAccess,
} from "@/domain";

import { getAuthMode } from "../auth/auth-mode";
import { getSupabaseAuthenticatedUser } from "../supabase/auth-server";
import { getSupabaseAdminClient } from "../supabase/server";

export class ArcAccessError extends Error {
  constructor(message = "You don't have access to this Arc item.") {
    super(message);
    this.name = "ArcAccessError";
  }
}

/** Who is asking, and whether sharing is even enforced (it is not in open/dev mode). */
export type ShareViewer = {
  userId: string | null;
  workspaceIds: string[];
  enforce: boolean;
};

const FULL_ACCESS: AccessDecision = { canView: true, permission: "collaborate" };

/**
 * Resolve the current viewer. In `open`/dev mode (or when unauthenticated) we do
 * NOT enforce sharing — the app is intentionally wide open there, matching
 * `requireOperator()`. The viewer's active workspace ids are loaded once so the
 * access resolvers don't re-query per resource.
 */
export async function getShareViewer(
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ShareViewer> {
  if (getAuthMode() !== "supabase") {
    return { userId: null, workspaceIds: [], enforce: false };
  }
  const user = await getSupabaseAuthenticatedUser();
  if (!user) {
    return { userId: null, workspaceIds: [], enforce: false };
  }
  const { data } = await client
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("status", "active");
  const workspaceIds = ((data ?? []) as { workspace_id: string }[]).map((row) => row.workspace_id);
  return { userId: user.id, workspaceIds, enforce: true };
}

async function getConversationShare(
  conversationId: string,
  userId: string,
  client: SupabaseClient,
): Promise<SharePermission | null> {
  const { data } = await client
    .from("arc_conversation_shares")
    .select("permission")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle<{ permission: SharePermission }>();
  return data?.permission ?? null;
}

async function getProjectShare(
  projectId: string,
  userId: string,
  client: SupabaseClient,
): Promise<SharePermission | null> {
  const { data } = await client
    .from("arc_project_shares")
    .select("permission")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle<{ permission: SharePermission }>();
  return data?.permission ?? null;
}

type ResourceRow = {
  owner_id: string | null;
  workspace_id: string | null;
  visibility: ShareVisibility;
  workspace_permission: SharePermission;
};

export async function resolveProjectAccess(
  projectId: string,
  viewer: ShareViewer,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<AccessDecision> {
  if (!viewer.enforce) return FULL_ACCESS;
  const { data } = await client
    .from("arc_projects")
    .select("owner_id,workspace_id,visibility,workspace_permission")
    .eq("id", projectId)
    .maybeSingle<ResourceRow>();
  if (!data) return { canView: false, permission: null };
  const directShare = viewer.userId ? await getProjectShare(projectId, viewer.userId, client) : null;
  return resolveResourceAccess(
    {
      ownerId: data.owner_id,
      workspaceId: data.workspace_id,
      visibility: data.visibility,
      workspacePermission: data.workspace_permission,
    },
    {
      userId: viewer.userId,
      isWorkspaceMember: !!data.workspace_id && viewer.workspaceIds.includes(data.workspace_id),
      directShare,
      inheritedShare: null,
    },
  );
}

export async function resolveConversationAccess(
  conversationId: string,
  viewer: ShareViewer,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<AccessDecision> {
  if (!viewer.enforce) return FULL_ACCESS;
  const { data } = await client
    .from("arc_conversations")
    .select("owner_id,workspace_id,visibility,workspace_permission,project_id")
    .eq("id", conversationId)
    .maybeSingle<ResourceRow & { project_id: string | null }>();
  if (!data) return { canView: false, permission: null };

  const directShare = viewer.userId
    ? await getConversationShare(conversationId, viewer.userId, client)
    : null;
  // Project cascade: a chat inside an accessible project inherits its grant.
  const inheritedShare = data.project_id
    ? (await resolveProjectAccess(data.project_id, viewer, client)).permission
    : null;

  return resolveResourceAccess(
    {
      ownerId: data.owner_id,
      workspaceId: data.workspace_id,
      visibility: data.visibility,
      workspacePermission: data.workspace_permission,
    },
    {
      userId: viewer.userId,
      isWorkspaceMember: !!data.workspace_id && viewer.workspaceIds.includes(data.workspace_id),
      directShare,
      inheritedShare,
    },
  );
}

export async function assertConversationAccess(
  conversationId: string,
  required: SharePermission,
  viewer?: ShareViewer,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<AccessDecision> {
  const resolvedViewer = viewer ?? (await getShareViewer(client));
  const decision = await resolveConversationAccess(conversationId, resolvedViewer, client);
  if (!hasRequiredPermission(decision, required)) {
    throw new ArcAccessError();
  }
  return decision;
}

// ---- Writes (visibility + share/unshare) ----

export async function setConversationVisibility(
  conversationId: string,
  visibility: ShareVisibility,
  workspacePermission: SharePermission,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client
    .from("arc_conversations")
    .update({ visibility, workspace_permission: workspacePermission })
    .eq("id", conversationId);
  if (error) throw new Error(`arc_conversations visibility update failed: ${error.message}`);
}

export async function shareConversation(
  conversationId: string,
  userId: string,
  permission: SharePermission,
  sharedBy: string | null,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client
    .from("arc_conversation_shares")
    .upsert(
      { conversation_id: conversationId, user_id: userId, permission, shared_by: sharedBy },
      { onConflict: "conversation_id,user_id" },
    );
  if (error) throw new Error(`arc_conversation_shares upsert failed: ${error.message}`);
}

export async function unshareConversation(
  conversationId: string,
  userId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client
    .from("arc_conversation_shares")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
  if (error) throw new Error(`arc_conversation_shares delete failed: ${error.message}`);
}

export async function setProjectVisibility(
  projectId: string,
  visibility: ShareVisibility,
  workspacePermission: SharePermission,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client
    .from("arc_projects")
    .update({ visibility, workspace_permission: workspacePermission })
    .eq("id", projectId);
  if (error) throw new Error(`arc_projects visibility update failed: ${error.message}`);
}

export async function shareProject(
  projectId: string,
  userId: string,
  permission: SharePermission,
  sharedBy: string | null,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client
    .from("arc_project_shares")
    .upsert(
      { project_id: projectId, user_id: userId, permission, shared_by: sharedBy },
      { onConflict: "project_id,user_id" },
    );
  if (error) throw new Error(`arc_project_shares upsert failed: ${error.message}`);
}

export async function unshareProject(
  projectId: string,
  userId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client
    .from("arc_project_shares")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) throw new Error(`arc_project_shares delete failed: ${error.message}`);
}

/** Current shares on a conversation (for the share dialog). */
export type ConversationShareRow = { userId: string; permission: SharePermission };

export async function listConversationShares(
  conversationId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ConversationShareRow[]> {
  const { data, error } = await client
    .from("arc_conversation_shares")
    .select("user_id,permission")
    .eq("conversation_id", conversationId);
  if (error) throw new Error(`arc_conversation_shares list failed: ${error.message}`);
  return ((data ?? []) as { user_id: string; permission: SharePermission }[]).map((row) => ({
    userId: row.user_id,
    permission: row.permission,
  }));
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm build`
Expected: build completes with no type errors in `src/lib/arc-chat/sharing.ts`.
(If `getAuthMode`/`getSupabaseAuthenticatedUser` import paths differ, fix the imports to match the real exports — they are `src/lib/auth/auth-mode.ts` and `src/lib/supabase/auth-server.ts`.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/arc-chat/sharing.ts
git commit -m "feat(arc): I/O layer for chat/project access resolution + share writes"
```

---

## Task 4: Viewer-aware read model + thread-load gating

**Files:**
- Modify: `src/lib/arc-chat/persistence.ts`
- Modify: `src/app/arc/page.tsx`

> Goal: the chat list shows owned + shared-with-me + workspace-visible conversations, and opening a thread by id is access-checked. In open/dev mode everything falls back to today's operator-based behavior.

- [ ] **Step 1: Add `listConversationsForViewer` to persistence**

In `src/lib/arc-chat/persistence.ts`, add this exported function (place it near `listConversations`; reuse the existing `CONVERSATION_COLUMNS`, `ConversationRow`, and `toConversation` already in the file):

```typescript
import { type ShareViewer } from "./sharing";

/**
 * Conversations the viewer may see: owned, shared directly, in a shared/accessible
 * project, or workspace-visible in a workspace they belong to. Falls back to the
 * operator-keyed list when sharing isn't enforced (open/dev mode).
 */
export async function listConversationsForViewer(
  viewer: ShareViewer,
  operator: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ArcConversation[]> {
  if (!viewer.enforce || !viewer.userId) {
    return listConversations(operator, client);
  }

  const byId = new Map<string, ConversationRow>();
  const collect = (rows: ConversationRow[] | null) => {
    for (const row of rows ?? []) byId.set(row.id, row);
  };

  // Owned, plus workspace-visible in a workspace the viewer belongs to.
  const orParts = [`owner_id.eq.${viewer.userId}`];
  if (viewer.workspaceIds.length > 0) {
    orParts.push(`and(visibility.eq.workspace,workspace_id.in.(${viewer.workspaceIds.join(",")}))`);
  }
  const ownedOrWorkspace = await client
    .from("arc_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("status", "active")
    .or(orParts.join(","));
  assertOk("arc_conversations owned/workspace", ownedOrWorkspace.error);
  collect(ownedOrWorkspace.data as ConversationRow[] | null);

  // Directly shared with the viewer.
  const sharedRows = await client
    .from("arc_conversation_shares")
    .select("conversation_id")
    .eq("user_id", viewer.userId);
  assertOk("arc_conversation_shares ids", sharedRows.error);
  const sharedIds = ((sharedRows.data ?? []) as { conversation_id: string }[]).map((r) => r.conversation_id);

  // Accessible projects (owned, workspace-visible, or shared) → their chats (cascade).
  const projectIdSet = new Set<string>();
  const sharedProjects = await client
    .from("arc_project_shares")
    .select("project_id")
    .eq("user_id", viewer.userId);
  assertOk("arc_project_shares ids", sharedProjects.error);
  for (const r of (sharedProjects.data ?? []) as { project_id: string }[]) projectIdSet.add(r.project_id);

  const projOrParts = [`owner_id.eq.${viewer.userId}`];
  if (viewer.workspaceIds.length > 0) {
    projOrParts.push(`and(visibility.eq.workspace,workspace_id.in.(${viewer.workspaceIds.join(",")}))`);
  }
  const ownedOrWsProjects = await client
    .from("arc_projects")
    .select("id")
    .or(projOrParts.join(","));
  assertOk("arc_projects accessible ids", ownedOrWsProjects.error);
  for (const r of (ownedOrWsProjects.data ?? []) as { id: string }[]) projectIdSet.add(r.id);

  // Fetch chats reached only via direct share or project cascade.
  const extraConversationFilter: string[] = [];
  if (sharedIds.length > 0) extraConversationFilter.push(`id.in.(${sharedIds.join(",")})`);
  if (projectIdSet.size > 0) {
    extraConversationFilter.push(`project_id.in.(${Array.from(projectIdSet).join(",")})`);
  }
  if (extraConversationFilter.length > 0) {
    const extra = await client
      .from("arc_conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("status", "active")
      .or(extraConversationFilter.join(","));
    assertOk("arc_conversations shared/cascade", extra.error);
    collect(extra.data as ConversationRow[] | null);
  }

  return Array.from(byId.values())
    .map(toConversation)
    .sort((a, b) => {
      // Pinned first (desc), then last_message_at desc — mirror listConversations ordering.
      if (!!a.pinnedAt !== !!b.pinnedAt) return a.pinnedAt ? -1 : 1;
      if (a.pinnedAt && b.pinnedAt && a.pinnedAt !== b.pinnedAt) {
        return a.pinnedAt < b.pinnedAt ? 1 : -1;
      }
      return a.lastMessageAt < b.lastMessageAt ? 1 : -1;
    });
}
```

> If `assertOk` / `CONVERSATION_COLUMNS` / `ConversationRow` / `toConversation` are not the exact local identifiers, match them to what `persistence.ts` already defines (the Explore confirmed `assertOk`, `CONVERSATION_COLUMNS`, `ConversationRow`, `toConversation` exist in this file).

- [ ] **Step 2: Gate the page reads on the viewer**

In `src/app/arc/page.tsx`, import the viewer + access helpers and the new reader:

```typescript
import { getShareViewer, resolveConversationAccess } from "@/lib/arc-chat/sharing";
import {
  // ...existing imports...
  listConversationsForViewer,
} from "@/lib/arc-chat/persistence";
```

Resolve the viewer once before the parallel reads, then swap the list call and gate the requested thread. Replace the `listConversations(operator)` / `getConversation(requestedId)` / archived lines (around `src/app/arc/page.tsx:91-97`) so they use the viewer:

```typescript
const viewer = await getShareViewer();

const [
  mentionGroups,
  settings,
  pendingApprovals,
  conversations,
  projects,
  campaigns,
  archived,
  activeConversation,
  pendingOpportunities,
] = await Promise.all([
  getMentionables(),
  getAppSettings(),
  countActiveApprovals(orgId).catch(() => 0),
  listConversationsForViewer(viewer, operator),
  listProjects(operator),
  listCampaignNames(orgId)
    .then((list) => list.map((c) => ({ id: c.id, name: c.name })))
    .catch(() => [] as { id: string; name: string }[]),
  showArchived ? listArchivedConversations(operator) : Promise.resolve([] as ArcConversation[]),
  requestedId
    ? getConversation(requestedId).then(async (conv) => {
        if (!conv) return null;
        const decision = await resolveConversationAccess(conv.id, viewer);
        return decision.canView ? conv : null;
      })
    : Promise.resolve(null),
  countPendingOpportunities().catch(() => 0),
]);
```

Then compute the active viewer permission for the UI (used by Task 6/7) after `activeConversation` resolves:

```typescript
const activePermission = activeConversation
  ? (await resolveConversationAccess(activeConversation.id, viewer)).permission
  : null;
const activeIsOwner = !!activeConversation && !!viewer.userId
  ? // owner check is implied by collaborate from ownership; expose a coarse flag for UI labels
    activePermission === "collaborate"
  : true;
```

Pass `activePermission` (and `viewer`'s enforce flag if useful) into `chatProps` so the composer and header can render the view-only state. Add `canCompose: !viewer.enforce || activePermission === "collaborate"` to `chatProps`.

> Projects list (`listProjects(operator)`) can stay operator-keyed for v1 — project sharing visibility in the sidebar is covered by the cascade on conversations. Filtering the project list itself by viewer is a follow-up (note it; do not block here).

- [ ] **Step 3: Typecheck + run domain tests**

Run: `pnpm build`
Expected: no type errors. Then `pnpm test src/domain/__tests__/arc-sharing.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/arc-chat/persistence.ts src/app/arc/page.tsx
git commit -m "feat(arc): viewer-aware conversation read model + thread-load gating"
```

---

## Task 5: Share/visibility server actions

**Files:**
- Create: `src/app/arc/sharing-actions.ts`

> Mirror the wired pattern: `requireOperator()` → `isSupabaseAdminConfigured()` guard → access check (only the owner may change sharing) → persistence call → `revalidatePath("/arc")`. Validate enum inputs with the domain type guards.

- [ ] **Step 1: Write the actions**

Create `src/app/arc/sharing-actions.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";

import { isSharePermission, isShareVisibility } from "@/domain";
import { requireOperator } from "@/lib/auth/operator";
import {
  ArcAccessError,
  assertConversationAccess,
  getShareViewer,
  setConversationVisibility,
  setProjectVisibility,
  shareConversation,
  shareProject,
  unshareConversation,
  unshareProject,
} from "@/lib/arc-chat/sharing";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

export type ShareActionState = { ok: boolean; message: string };

function notConfigured(): ShareActionState {
  return { ok: false, message: "Supabase isn't configured yet, so sharing isn't available." };
}

export async function setConversationVisibilityAction(
  _previous: ShareActionState,
  formData: FormData,
): Promise<ShareActionState> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return notConfigured();

  const conversationId = String(formData.get("conversationId") ?? "").trim();
  const visibility = String(formData.get("visibility") ?? "");
  const permission = String(formData.get("permission") ?? "view");

  if (!conversationId) return { ok: false, message: "Missing conversation." };
  if (!isShareVisibility(visibility)) return { ok: false, message: "Invalid visibility." };
  if (!isSharePermission(permission)) return { ok: false, message: "Invalid permission." };

  const client = getSupabaseAdminClient();
  try {
    await assertConversationAccess(conversationId, "collaborate", undefined, client);
    await setConversationVisibility(conversationId, visibility, permission, client);
  } catch (error) {
    if (error instanceof ArcAccessError) return { ok: false, message: error.message };
    return { ok: false, message: error instanceof Error ? error.message : "Couldn't update visibility." };
  }

  revalidatePath("/arc");
  return { ok: true, message: visibility === "workspace" ? "Visible to the workspace." : "Set to private." };
}

export async function shareConversationAction(
  _previous: ShareActionState,
  formData: FormData,
): Promise<ShareActionState> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return notConfigured();

  const conversationId = String(formData.get("conversationId") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();
  const permission = String(formData.get("permission") ?? "view");

  if (!conversationId || !userId) return { ok: false, message: "Choose a teammate to share with." };
  if (!isSharePermission(permission)) return { ok: false, message: "Invalid permission." };

  const client = getSupabaseAdminClient();
  try {
    const viewer = await getShareViewer(client);
    await assertConversationAccess(conversationId, "collaborate", viewer, client);
    await shareConversation(conversationId, userId, permission, viewer.userId, client);
  } catch (error) {
    if (error instanceof ArcAccessError) return { ok: false, message: error.message };
    return { ok: false, message: error instanceof Error ? error.message : "Couldn't share." };
  }

  revalidatePath("/arc");
  return { ok: true, message: "Shared." };
}

export async function unshareConversationAction(
  _previous: ShareActionState,
  formData: FormData,
): Promise<ShareActionState> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return notConfigured();

  const conversationId = String(formData.get("conversationId") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!conversationId || !userId) return { ok: false, message: "Missing share." };

  const client = getSupabaseAdminClient();
  try {
    await assertConversationAccess(conversationId, "collaborate", undefined, client);
    await unshareConversation(conversationId, userId, client);
  } catch (error) {
    if (error instanceof ArcAccessError) return { ok: false, message: error.message };
    return { ok: false, message: error instanceof Error ? error.message : "Couldn't remove access." };
  }

  revalidatePath("/arc");
  return { ok: true, message: "Access removed." };
}

// Project equivalents. Sharing a project cascades to its chats (handled by the
// access resolvers), so these only manage the project's own visibility/shares.
export async function setProjectVisibilityAction(
  _previous: ShareActionState,
  formData: FormData,
): Promise<ShareActionState> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return notConfigured();

  const projectId = String(formData.get("projectId") ?? "").trim();
  const visibility = String(formData.get("visibility") ?? "");
  const permission = String(formData.get("permission") ?? "view");

  if (!projectId) return { ok: false, message: "Missing project." };
  if (!isShareVisibility(visibility)) return { ok: false, message: "Invalid visibility." };
  if (!isSharePermission(permission)) return { ok: false, message: "Invalid permission." };

  try {
    await setProjectVisibility(projectId, visibility, permission);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Couldn't update project." };
  }

  revalidatePath("/arc");
  return { ok: true, message: visibility === "workspace" ? "Project visible to the workspace." : "Project set to private." };
}

export async function shareProjectAction(
  _previous: ShareActionState,
  formData: FormData,
): Promise<ShareActionState> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return notConfigured();

  const projectId = String(formData.get("projectId") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();
  const permission = String(formData.get("permission") ?? "view");

  if (!projectId || !userId) return { ok: false, message: "Choose a teammate to share with." };
  if (!isSharePermission(permission)) return { ok: false, message: "Invalid permission." };

  const client = getSupabaseAdminClient();
  try {
    const viewer = await getShareViewer(client);
    await shareProject(projectId, userId, permission, viewer.userId, client);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Couldn't share project." };
  }

  revalidatePath("/arc");
  return { ok: true, message: "Project shared." };
}

export async function unshareProjectAction(
  _previous: ShareActionState,
  formData: FormData,
): Promise<ShareActionState> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return notConfigured();

  const projectId = String(formData.get("projectId") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!projectId || !userId) return { ok: false, message: "Missing share." };

  try {
    await unshareProject(projectId, userId);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Couldn't remove access." };
  }

  revalidatePath("/arc");
  return { ok: true, message: "Access removed." };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm build`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/arc/sharing-actions.ts
git commit -m "feat(arc): share/visibility server actions for chats + projects"
```

---

## Task 6: Collaborate path — author attribution + view-only block

**Files:**
- Modify: `src/app/arc/actions.ts`

> Two changes to the inbound-message action(s): (1) stamp `author_user_id` on the operator message insert so a collaborator's message is attributed; (2) refuse to post when the viewer's effective permission on the conversation is only `view`.

- [ ] **Step 1: Locate the operator-message insert**

In `src/app/arc/actions.ts`, find `sendArcMessageAction` (around line 1) and the place it inserts the operator message row into `arc_messages` (it writes `conversation_id`, `role: "operator"`, `body`, `status`, `mentions`). Also find any sibling send path that inserts an operator message.

- [ ] **Step 2: Add the access guard + author stamp**

Before the insert, resolve the viewer and assert `collaborate` on the target conversation; stamp the author. Add imports:

```typescript
import { assertConversationAccess, getShareViewer, ArcAccessError } from "@/lib/arc-chat/sharing";
```

In the action, after the conversation id (`conversationId`) is known and Supabase is confirmed configured, before inserting the operator message:

```typescript
const viewer = await getShareViewer(client);
try {
  await assertConversationAccess(conversationId, "collaborate", viewer, client);
} catch (error) {
  if (error instanceof ArcAccessError) {
    const agentName = await getAgentName();
    return { ok: false, message: `This chat is view-only — ${agentName} can't accept a message here.` };
  }
  throw error;
}
```

Then include the author on the operator-message insert payload:

```typescript
// add to the existing arc_messages insert object for the operator message:
author_user_id: viewer.userId,
```

> For a brand-new conversation (no `conversationId` yet — the "new chat" path), there is nothing to gate (the creator owns it); only apply the `assertConversationAccess` guard when posting into an existing conversation. Still set `author_user_id: viewer.userId` on the insert.

- [ ] **Step 3: Typecheck**

Run: `pnpm build`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/arc/actions.ts
git commit -m "feat(arc): attribute collaborator messages + block view-only posting"
```

---

## Task 7: UI — share dialog, view-only composer, shared-with-me grouping

**Files:**
- Create: `src/app/arc/_components/share-dialog.tsx`
- Modify: `src/app/arc/_components/arc-chat.tsx`
- Modify: `src/app/arc/_components/composer.tsx`
- Modify: `src/app/arc/_components/thread-sidebar.tsx`

> Follow `DESIGN.md`: Command Charcoal / Canvas White / Restoration Red, no emojis, restraint (hairlines not card-soup, accent used sparingly), no bare `--surface` token — use `--canvas` / `--surface-panel` / `--surface-inset` / `--surface-raised`. Reuse `src/app/_components/page-header.tsx` primitives (`Panel`, `StatusPill`, `ActionFeedback`) where they fit.

- [ ] **Step 1: Build the share dialog**

Create `src/app/arc/_components/share-dialog.tsx` as a client component. It receives the active conversation id, its current visibility/workspace-permission, the current shares, and the workspace member roster (passed down from the page via `chatProps`). It renders:
- a "Visible to everyone in this workspace" toggle bound to `setConversationVisibilityAction` (with a view/collaborate selector shown when on),
- a member picker (from the roster) + view/collaborate selector bound to `shareConversationAction`,
- a list of current shares each with a remove control bound to `unshareConversationAction`,
- an `ActionFeedback`-style inline status from the action state.

Use `useActionState` (React 19) with the actions from `../sharing-actions`. Member roster shape comes from `listWorkspaceTeamAccess(workspaceId)` (`src/lib/auth/workspace-invites.ts`) → `members: { userId, email, role }[]`; filter to `status === "active"` and `userId != null`, label each by `email ?? role`.

```tsx
"use client";

import { useActionState } from "react";

import {
  setConversationVisibilityAction,
  shareConversationAction,
  unshareConversationAction,
  type ShareActionState,
} from "../sharing-actions";

type Member = { userId: string; label: string };
type Share = { userId: string; permission: "view" | "collaborate" };

const INITIAL: ShareActionState = { ok: false, message: "" };

export function ShareDialog(props: {
  conversationId: string;
  visibility: "private" | "workspace";
  workspacePermission: "view" | "collaborate";
  members: Member[];
  shares: Share[];
}) {
  const [visState, visAction] = useActionState(setConversationVisibilityAction, INITIAL);
  const [shareState, shareAction] = useActionState(shareConversationAction, INITIAL);
  const [removeState, removeAction] = useActionState(unshareConversationAction, INITIAL);
  const status = visState.message || shareState.message || removeState.message;
  const sharedUserIds = new Set(props.shares.map((s) => s.userId));
  const candidates = props.members.filter((m) => !sharedUserIds.has(m.userId));

  return (
    <div className="space-y-4">
      <form action={visAction} className="flex items-center gap-3">
        <input type="hidden" name="conversationId" value={props.conversationId} />
        <input
          type="hidden"
          name="visibility"
          value={props.visibility === "workspace" ? "private" : "workspace"}
        />
        <input type="hidden" name="permission" value={props.workspacePermission} />
        <button type="submit" className="text-sm underline">
          {props.visibility === "workspace" ? "Make private" : "Share with whole workspace"}
        </button>
      </form>

      <form action={shareAction} className="flex items-center gap-2">
        <input type="hidden" name="conversationId" value={props.conversationId} />
        <select name="userId" className="rounded border px-2 py-1 text-sm" required>
          <option value="">Add a teammate…</option>
          {candidates.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.label}
            </option>
          ))}
        </select>
        <select name="permission" className="rounded border px-2 py-1 text-sm" defaultValue="view">
          <option value="view">Can view</option>
          <option value="collaborate">Can collaborate</option>
        </select>
        <button type="submit" className="text-sm underline">
          Share
        </button>
      </form>

      <ul className="space-y-1">
        {props.shares.map((s) => {
          const label = props.members.find((m) => m.userId === s.userId)?.label ?? s.userId;
          return (
            <li key={s.userId} className="flex items-center justify-between text-sm">
              <span>
                {label} — {s.permission === "collaborate" ? "collaborator" : "viewer"}
              </span>
              <form action={removeAction}>
                <input type="hidden" name="conversationId" value={props.conversationId} />
                <input type="hidden" name="userId" value={s.userId} />
                <button type="submit" className="underline">
                  Remove
                </button>
              </form>
            </li>
          );
        })}
      </ul>

      {status ? <p className="text-sm text-[var(--ink-soft)]">{status}</p> : null}
    </div>
  );
}
```

> The classNames above are placeholders for layout intent — replace with the project's existing utility/class conventions used elsewhere in `_components` (match `arc-chat.tsx` styling). Keep to the DESIGN.md palette and primitives; do not introduce a bare `--surface` token.

- [ ] **Step 2: Wire the Share button into the chat header**

In `src/app/arc/_components/arc-chat.tsx`, in the header (the `HeaderTitle` area around lines 33-90), add a "Share" button next to the rename control that opens the `ShareDialog` (a popover/modal consistent with existing header controls). Pass through the props the page now provides (conversation id, visibility, workspacePermission, members, shares). Only render the Share button when there is an active conversation and the viewer is the owner / has `collaborate` (use the `canCompose`/permission signal threaded from the page; owners always have collaborate).

- [ ] **Step 3: View-only composer state**

In `src/app/arc/_components/composer.tsx`, accept a `canCompose: boolean` prop (thread it from `chatProps.canCompose`). When `false`, disable the textarea + send button and show a quiet line: `View-only — shared by {owner}`. Keep the existing behavior when `true`.

- [ ] **Step 4: "Shared with me" affordance in the sidebar**

In `src/app/arc/_components/thread-sidebar.tsx`, add a small indicator on conversations the viewer does not own (e.g. a "Shared" `StatusPill`), and group those under a "Shared with me" `SectionLabel` when present. Ownership signal: compare `conversation.ownerId` to the viewer — thread an `ownedConversationIds: Set<string>` (or an `isShared` flag per conversation) from the page through `chatProps`. (Add `ownerId` to the `ArcConversation` type + `CONVERSATION_COLUMNS` select in `persistence.ts` if not already selected, so the UI can distinguish owned vs shared.)

- [ ] **Step 5: Verify in the browser (preview workflow)**

Start the preview, open `/arc`, confirm: header shows a Share control on an active thread; the dialog lists workspace members; toggling workspace visibility and adding a share show success feedback; a view-only thread disables the composer. (In local/open mode sharing is bypassed — to exercise enforcement you need `ARC_AUTH_MODE=supabase` + Supabase configured; if not available locally, verify the non-enforced rendering and rely on the build + the prod smoke in Task 8.)

- [ ] **Step 6: Typecheck + lint changed files**

Run: `pnpm build`
Expected: no type errors.
Run eslint scoped to the changed files only (the repo-wide lint is noisy):
`pnpm exec eslint src/app/arc/_components/share-dialog.tsx src/app/arc/_components/arc-chat.tsx src/app/arc/_components/composer.tsx src/app/arc/_components/thread-sidebar.tsx src/app/arc/sharing-actions.ts src/lib/arc-chat/sharing.ts`

- [ ] **Step 7: Commit**

```bash
git add src/app/arc/_components/share-dialog.tsx src/app/arc/_components/arc-chat.tsx src/app/arc/_components/composer.tsx src/app/arc/_components/thread-sidebar.tsx src/lib/arc-chat/persistence.ts
git commit -m "feat(arc): share dialog, view-only composer, shared-with-me sidebar"
```

---

## Task 8: Final verification + rollout

**Files:** none (verification + release).

- [ ] **Step 1: Full test + build**

Run: `pnpm test`
Expected: all tests pass (including `arc-sharing.test.ts`).
Run: `pnpm build`
Expected: clean build, no type errors.

- [ ] **Step 2: Confirm the backfill assumption with Evan**

The migration sets `owner_id` to the workspace's **owner** membership. Confirm there is a single human operator per workspace in prod (so no one's private chats get reassigned to the wrong person). If there are multiple distinct operators whose chats must stay separate, adjust the backfill mapping before applying to prod.

- [ ] **Step 3: Apply the migration to prod manually**

Vercel deploys code from `origin/main` but does NOT run Supabase migrations. Apply `supabase/migrations/20260623090000_arc_conversations_tenancy_sharing.sql` to the prod DB (`qqbecyrhnowmooyjiztz`) by hand, **before or together with** the deploy that ships the code selecting the new columns. Verify with a spot query (e.g. `select visibility, count(*) from arc_conversations group by 1;`).

- [ ] **Step 4: Post-merge integrity check**

If this branch merged with others touching `src/domain/index.ts`, confirm the `arc-sharing` export survived and re-run `pnpm build`.

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(arc): verification fixups for chat/project sharing"
```

---

## Self-Review against the spec

- **Tenancy columns on conversations/messages/projects** → Task 2. ✓
- **Owner-based private default** → Task 2 (`visibility default 'private'`, `owner_id`) + Task 1 logic. ✓
- **Workspace visibility OR specific-teammate shares, each view/collaborate** → Task 2 (columns + share tables), Task 3 (writes), Task 5 (actions), Task 7 (UI). ✓
- **Access rule (owner / workspace-visible-member / shared) + strongest permission** → Task 1 (pure, tested). ✓
- **Project cascade to chats + saved items** → Task 3 (`resolveConversationAccess` inherits from project), Task 4 (read-model includes chats in accessible projects). ✓
- **App-layer-primary enforcement + RLS defense-in-depth** → Task 3 (`assert*`), Task 2 (RLS). ✓
- **Open/dev mode stays open** → Task 3 (`enforce=false` short-circuit), Task 4 fallback. ✓
- **Collaborator message attribution + view-only block** → Task 6. ✓
- **Wired pattern (requireOperator + isSupabaseAdminConfigured + revalidatePath)** → Task 5. ✓
- **Share button, shared-with-me, view-only composer, DESIGN.md** → Task 7. ✓
- **Backfill + manual prod migration + single-operator assumption** → Task 2 + Task 8. ✓
- **No generated-types edit needed; build is the gate** → noted in critical context + every typecheck step. ✓

**Type consistency:** `SharePermission`/`ShareVisibility`/`AccessDecision`/`ShareViewer` are defined once (Tasks 1 & 3) and reused verbatim in Tasks 4–7. Action names (`shareConversationAction`, `setConversationVisibilityAction`, etc.) match between Task 5 and Task 7. Persistence function `listConversationsForViewer` defined in Task 4 and called in Task 4's page edit.

**Open follow-ups (intentionally out of scope, noted for later):** filtering the projects *list* itself by viewer (sidebar projects stay operator-keyed for v1); resolving member display names beyond `email ?? role` (may want an auth.users email lookup); project-level share dialog UI (actions exist in Task 5; wiring a project share surface can follow the chat one).

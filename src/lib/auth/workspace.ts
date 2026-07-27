import { cache } from "react";

import { createServerClient } from "@supabase/ssr";
import { type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getAuthMode, getSupabaseAnonKey, getSupabaseAuthUrl } from "./auth-mode";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

type QueryClient = SupabaseClient;

/**
 * Cosmetic only: names the synthetic org in the offline demo context, which
 * never touches a database. It does NOT select a tenant any more — resolving a
 * real org by hardcoded slug is the bug `fetchDefaultOrg` below was rewritten to
 * remove. Don't reintroduce it as a tenant selector.
 */
export const DEFAULT_ORG_SLUG = process.env.DEFAULT_ORG_SLUG ?? "big-shoulders-restoration";
export const DEFAULT_WORKSPACE_KEY = process.env.DEFAULT_WORKSPACE_KEY ?? "default";

/** Cookie that pins which of a user's workspaces is active (set by the workspace switcher). */
export const ACTIVE_WORKSPACE_COOKIE = "signal_active_workspace";

export type WorkspaceRole = "owner" | "admin" | "marketer" | "reviewer" | "member" | "viewer";

export type WorkspaceContext = {
  orgId: string;
  orgSlug: string;
  orgName: string;
  workspaceId: string | null;
  workspaceKey: string;
  workspaceSlug: string;
  workspaceName: string;
  role: WorkspaceRole | null;
  userId: string | null;
  source: "membership" | "default-org" | "legacy-org";
};

type OrgRow = {
  id: string;
  slug: string;
  name: string;
};

type WorkspaceRow = {
  id: string;
  org_id: string;
  key: string;
  slug: string;
  name: string;
};

type WorkspaceMembershipRow = {
  org_id: string;
  workspace_id: string;
  role: WorkspaceRole;
};

export class WorkspaceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceUnavailableError";
  }
}

async function getSupabaseSessionUserId(): Promise<string | null> {
  if (getAuthMode() !== "supabase") return null;

  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(getSupabaseAuthUrl(), getSupabaseAnonKey(), {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Session refresh writes are handled by proxy.ts; workspace resolution is read-only.
        },
      },
    });

    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

async function fetchOrgById(client: QueryClient, orgId: string): Promise<OrgRow | null> {
  const { data, error } = await client
    .from("organizations")
    .select("id,slug,name")
    .eq("id", orgId)
    .maybeSingle<OrgRow>();
  if (error) throw new WorkspaceUnavailableError(error.message);
  return data ?? null;
}

/**
 * Resolve the org for a caller that has no session to derive one from — in
 * practice the bearer-token API path, where `getSupabaseSessionUserId()` is
 * necessarily null because there is no cookie on the request.
 *
 * This used to look the org up by a hardcoded slug (`DEFAULT_ORG_SLUG`,
 * defaulting to `big-shoulders-restoration`), which was wrong in two directions
 * at once:
 *
 *   - Multi-tenant: every session-less write silently landed in BSR, no matter
 *     who the caller actually was. Same bug class as the column default dropped
 *     in 20260716140000 — a hidden default that answers when it should refuse.
 *   - Single-tenant, non-BSR: it did not even misfile, it THREW. Any deployment
 *     whose org isn't literally slugged `big-shoulders-restoration` got
 *     `No organization found for slug "big-shoulders-restoration"`. BSR is a
 *     tenant of this product, not the product.
 *
 * So: answer only when the answer is unambiguous. One org means there is exactly
 * one thing this could mean. Several orgs means there is no basis to pick, and
 * guessing is precisely the bug being removed — refuse instead, and let the
 * caller name its workspace (a DB-issued token, or ARC_WORKSPACE_HEADER, both of
 * which resolve before this is ever reached).
 *
 * DEFAULT_ORG_SLUG deliberately does NOT rescue the ambiguous case. An env var
 * that silently picks a winner among real tenants is the same hidden default
 * wearing a different hat; for a bearer request, guessing a tenant is never
 * right. It survives only as cosmetic naming for the offline demo context.
 */
async function fetchDefaultOrg(client: QueryClient): Promise<OrgRow> {
  const { data, error } = await client
    .from("organizations")
    .select("id,slug,name")
    // ACTIVE only, mirroring the workspace half below. A retired tenant is not a
    // candidate answer to "which org did this session-less caller mean?", but it
    // was still counted — so archiving a demo/test org left the database
    // permanently "ambiguous" and every session-less caller refused, with no way
    // back short of deleting the rows. Status is how a tenant is retired; this is
    // the query that has to honour it.
    .eq("status", "active")
    .limit(2)
    .returns<OrgRow[]>();
  if (error) throw new WorkspaceUnavailableError(error.message);

  const orgs = data ?? [];
  if (orgs.length === 0) {
    throw new WorkspaceUnavailableError(
      "No active organization exists, so no workspace can be resolved without a session.",
    );
  }
  if (orgs.length > 1) {
    throw new WorkspaceUnavailableError(
      "This request has no session and this database has more than one active organization, so the tenant is " +
        "ambiguous. Authenticate as a user, or use a workspace-scoped agent token / assert a workspace on the request.",
    );
  }
  return orgs[0];
}

/**
 * The sole org's id, for a session-less caller that needs tenancy but genuinely
 * has no use for a workspace — stamping `org_id` on a row whose `workspace_id`
 * is nullable, say.
 *
 * Exists so that "when may I pick an org?" has exactly one answer in exactly one
 * place. It is the same rule and the same code as the session-less path of
 * `resolveWorkspaceContextForUser`, just stopping one step earlier; a caller
 * needing only the org shouldn't have to re-implement the rule (and then drift
 * from it) or answer the unrelated question of which workspace it means.
 */
export async function resolveSoleOrgId(client: QueryClient = getSupabaseAdminClient()): Promise<string> {
  return (await fetchDefaultOrg(client)).id;
}

async function fetchWorkspaceById(client: QueryClient, workspaceId: string): Promise<WorkspaceRow | null> {
  const { data, error } = await client
    .from("workspaces")
    .select("id,org_id,key,slug,name")
    .eq("id", workspaceId)
    .eq("status", "active")
    .maybeSingle<WorkspaceRow>();
  if (error) throw new WorkspaceUnavailableError(error.message);
  return data ?? null;
}

/**
 * Validate a workspace id and return its authoritative { orgId, workspaceId },
 * or null if it doesn't exist / isn't active.
 *
 * Used by the trusted first-party Arc runner: a shared-env-token callback asserts
 * which workspace it is acting for (echoed from the wake payload), and we derive
 * the org from the DB here rather than trusting the asserted value — so a spoofed
 * org can never widen scope.
 */
export async function resolveWorkspaceScopeById(
  workspaceId: string,
  client?: SupabaseClient,
): Promise<{ orgId: string; workspaceId: string } | null> {
  if (!client && !isSupabaseAdminConfigured()) return null;
  const db = client ?? getSupabaseAdminClient();
  try {
    const row = await fetchWorkspaceById(db, workspaceId);
    return row ? { orgId: row.org_id, workspaceId: row.id } : null;
  } catch {
    return null;
  }
}

/**
 * Workspace half of the session-less resolution, and the same rule as
 * fetchDefaultOrg one level down: answer only when the answer is unambiguous.
 *
 * This used to select `key = DEFAULT_WORKSPACE_KEY` ("default"), which had both
 * of the failure modes its org-level sibling had. An org with several
 * workspaces silently collapsed to whichever one happened to be keyed "default"
 * — the last remaining guess on this path, and wrong for every other workspace
 * in that org. An org whose single workspace was keyed anything else matched
 * nothing and yielded a null workspaceId, i.e. a 409 for a request that had
 * exactly one possible answer.
 *
 * Resolving the sole ACTIVE workspace fixes both: one workspace is answerable
 * whatever it is keyed, and several is a refusal rather than a coin flip. As
 * with DEFAULT_ORG_SLUG, the "default" key does not get to break the tie — it
 * survives only as the display fallback when there is no workspace at all.
 */
async function fetchDefaultWorkspace(client: QueryClient, org: OrgRow): Promise<WorkspaceContext> {
  const { data, error } = await client
    .from("workspaces")
    .select("id,org_id,key,slug,name")
    .eq("org_id", org.id)
    .eq("status", "active")
    .limit(2)
    .returns<WorkspaceRow[]>();

  if (!error && (data?.length ?? 0) > 1) {
    throw new WorkspaceUnavailableError(
      `This request has no session and organization "${org.slug}" has more than one active workspace, so the ` +
        "workspace is ambiguous. Authenticate as a user, or use a workspace-scoped agent token / assert a " +
        "workspace on the request.",
    );
  }

  const row = data?.[0] ?? null;

  if (error) {
    return {
      orgId: org.id,
      orgSlug: org.slug,
      orgName: org.name,
      workspaceId: null,
      workspaceKey: DEFAULT_WORKSPACE_KEY,
      workspaceSlug: org.slug,
      workspaceName: org.name,
      role: null,
      userId: null,
      source: "legacy-org",
    };
  }

  return {
    orgId: org.id,
    orgSlug: org.slug,
    orgName: org.name,
    workspaceId: row?.id ?? null,
    workspaceKey: row?.key ?? DEFAULT_WORKSPACE_KEY,
    workspaceSlug: row?.slug ?? org.slug,
    workspaceName: row?.name ?? org.name,
    role: null,
    userId: null,
    source: row ? "default-org" : "legacy-org",
  };
}

async function fetchFirstMembership(client: QueryClient, userId: string): Promise<WorkspaceMembershipRow | null> {
  const { data, error } = await client
    .from("workspace_memberships")
    .select("org_id,workspace_id,role")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<WorkspaceMembershipRow>();
  if (error) throw new WorkspaceUnavailableError(error.message);
  return data ?? null;
}

/** A specific active membership for this user — used to honor the active-workspace cookie. */
async function fetchMembershipForWorkspace(
  client: QueryClient,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceMembershipRow | null> {
  const { data, error } = await client
    .from("workspace_memberships")
    .select("org_id,workspace_id,role")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .maybeSingle<WorkspaceMembershipRow>();
  if (error) throw new WorkspaceUnavailableError(error.message);
  return data ?? null;
}

export async function resolveWorkspaceContextForUser(
  client: QueryClient,
  userId: string | null,
  preferredWorkspaceId?: string | null,
): Promise<WorkspaceContext> {
  if (userId) {
    const membership =
      (preferredWorkspaceId ? await fetchMembershipForWorkspace(client, userId, preferredWorkspaceId) : null) ??
      (await fetchFirstMembership(client, userId));
    if (membership) {
      const [workspace, org] = await Promise.all([
        fetchWorkspaceById(client, membership.workspace_id),
        fetchOrgById(client, membership.org_id),
      ]);

      if (workspace && org) {
        return {
          orgId: org.id,
          orgSlug: org.slug,
          orgName: org.name,
          workspaceId: workspace.id,
          workspaceKey: workspace.key,
          workspaceSlug: workspace.slug,
          workspaceName: workspace.name,
          role: membership.role,
          userId,
          source: "membership",
        };
      }
    }

    throw new WorkspaceUnavailableError("No active workspace membership is available for this user.");
  }

  const org = await fetchDefaultOrg(client);
  return fetchDefaultWorkspace(client, org);
}

async function getPreferredWorkspaceId(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  try {
    const cookieStore = await cookies();
    return cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Synthetic workspace for offline/local preview. When Supabase isn't configured
 * there's no membership to resolve, but the read-models already fall back to
 * ARC_DEMO_DATA bundles — this lets the signed-in shell render on top of them
 * instead of bouncing every page to /login. The synthetic ids never reach a
 * real query (no admin client exists to run one), so their exact value is inert.
 */
function buildDemoWorkspaceContext(): WorkspaceContext {
  const name = titleCaseSlug(DEFAULT_ORG_SLUG);
  return {
    orgId: "demo-org",
    orgSlug: DEFAULT_ORG_SLUG,
    orgName: name,
    workspaceId: "demo-workspace",
    workspaceKey: DEFAULT_WORKSPACE_KEY,
    workspaceSlug: DEFAULT_ORG_SLUG,
    workspaceName: name,
    role: "owner",
    userId: null,
    source: "default-org",
  };
}

export const getCurrentWorkspaceContext = cache(async (): Promise<WorkspaceContext> => {
  if (!isSupabaseAdminConfigured()) {
    // Offline/local preview: no Supabase means no real membership to resolve, so
    // fall back to a synthetic demo workspace and let the app render against the
    // ARC_DEMO_DATA read-model fallbacks. Doubly gated (unconfigured + demo flag)
    // — this never fires in any deploy that has Supabase configured.
    if (isDemoDataEnabled()) return buildDemoWorkspaceContext();
    throw new WorkspaceUnavailableError("Supabase is not configured, so no workspace is available.");
  }

  const userId = await getSupabaseSessionUserId();
  const preferredWorkspaceId = await getPreferredWorkspaceId(userId);
  return resolveWorkspaceContextForUser(getSupabaseAdminClient(), userId, preferredWorkspaceId);
});

export async function getCurrentWorkspaceKey(): Promise<string> {
  return (await getCurrentWorkspaceContext()).workspaceKey;
}

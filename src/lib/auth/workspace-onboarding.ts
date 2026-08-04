import { requireCount } from "@/lib/supabase/count";
import { randomBytes } from "node:crypto";

import type { User } from "@supabase/supabase-js";

import { isSelfServeSignupOpen } from "@/lib/auth/auth-mode";
import { startTrialForOrg } from "@/lib/billing/trial";
import { isPlatformAdmin } from "@/lib/waitlist/admin";
import { getSupabaseAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getSupabaseAdminClient, isSupabaseAdminConfigured, type TypedSupabaseClient } from "@/lib/supabase/server";
import { seedDefaultMediaFolders } from "@/lib/media-library/persistence";
import { reportDegraded } from "@/lib/observability/report-degraded";
import { seedDefaultPersonas } from "@/lib/personas/persistence";
import { seedDefaultPipelineStages } from "@/lib/pipeline-stages/definitions";
import { canonicalIndustryKey } from "@/lib/product-language";
import { attributionColumnValue, readAttributionRecord } from "@/lib/signup-attribution/server";
import type { AttributionRecord } from "@/domain/signup-attribution";

type WorkspaceType = "individual" | "company" | "agency";

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
};

type WorkspaceRow = {
  id: string;
  org_id: string;
  key: string;
  slug: string;
  name: string;
};

export type CreateWorkspaceInput = {
  organizationName: string;
  workspaceName?: string;
  workspaceType?: string;
  /** Industry template key (see industry-templates.ts) — drives the seeded persona pack. */
  industry?: string;
  /**
   * Which channel produced this workspace (BSR-586). Passed in rather than read
   * here: this module runs from contexts that have no request (provisioning,
   * scripts), and the cookie only exists at a request boundary. Null = unattributed.
   */
  attribution?: AttributionRecord | null;
};

export type CreateWorkspaceResult =
  | { ok: true; orgId: string; workspaceId: string; claimedExistingOrg: boolean }
  | {
      ok: false;
      status: "not_authenticated" | "not_authorized" | "not_configured" | "invalid_input" | "already_claimed" | "failed";
      message: string;
    };

function normalizeName(value: string | undefined, fallback = "") {
  return (value ?? fallback).replace(/\s+/g, " ").trim();
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || "workspace";
}

function normalizeWorkspaceType(value: string | undefined): WorkspaceType {
  return value === "individual" || value === "agency" || value === "company" ? value : "company";
}

function normalizeIndustry(value: string | undefined): string {
  return canonicalIndustryKey(value);
}

function shortMarkFor(name: string) {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

async function getActiveMembershipForUser(client: TypedSupabaseClient, userId: string) {
  const { data, error } = await client
    .from("workspace_memberships")
    .select("org_id,workspace_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ org_id: string; workspace_id: string }>();

  if (error) throw error;
  return data ?? null;
}

async function findOrganizationBySlug(client: TypedSupabaseClient, slug: string) {
  const { data, error } = await client
    .from("organizations")
    .select("id,name,slug")
    .eq("slug", slug)
    .maybeSingle<OrganizationRow>();

  if (error) throw error;
  return data ?? null;
}

async function organizationHasMemberships(client: TypedSupabaseClient, orgId: string) {
  const { count, error } = await client
    .from("organization_memberships")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .in("status", ["active", "invited"]);

  // Fail closed: a null count read as 0 would claim the org has no members
  // when it may have several (BSR-575).
  return requireCount("organization_memberships", { count, error }) > 0;
}

async function createOrganization(client: TypedSupabaseClient, name: string, slug: string) {
  const { data, error } = await client
    .from("organizations")
    .insert({ name, slug, status: "active" })
    .select("id,name,slug")
    .single<OrganizationRow>();

  if (error) throw error;
  return data;
}

const SLUG_SUFFIX_CAP = 20;

function shortSlugSuffix(): string {
  return randomBytes(3).toString("hex"); // 6 url-safe hex chars
}

/**
 * A free org slug derived from the name: base, else base-2..base-CAP, else base-<rand>.
 * Never returns a slug already in use. Base is trimmed so suffixed slugs stay ≤72 chars.
 *
 * `exists` is injectable so callers can pass a real Supabase lookup or a test spy.
 * Defaults to checking `findOrganizationBySlug` against the provided client.
 */
export async function uniqueOrgSlug(
  nameOrClient: string | TypedSupabaseClient,
  existsOrName: ((slug: string) => Promise<boolean>) | string,
): Promise<string> {
  // Overload: uniqueOrgSlug(baseName, exists) — injectable form (used in tests)
  // Overload: uniqueOrgSlug(client, baseName) — production form
  let base: string;
  let exists: (slug: string) => Promise<boolean>;

  if (typeof nameOrClient === "string") {
    // Injectable form: uniqueOrgSlug(baseName, existsFn)
    base = slugify(nameOrClient);
    exists = existsOrName as (slug: string) => Promise<boolean>;
  } else {
    // Production form: uniqueOrgSlug(client, baseName)
    const client = nameOrClient;
    base = slugify(existsOrName as string);
    exists = async (slug: string) => Boolean(await findOrganizationBySlug(client, slug));
  }

  if (!(await exists(base))) return base;
  const root = base.slice(0, 64); // leave room for "-<suffix>"
  for (let n = 2; n <= SLUG_SUFFIX_CAP; n += 1) {
    const candidate = `${root}-${n}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${root}-${shortSlugSuffix()}`;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

/** Create an org with a unique slug, retrying on a slug race (unique violation). */
async function createOrganizationUnique(
  client: TypedSupabaseClient,
  name: string,
  baseName: string,
): Promise<OrganizationRow> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = await uniqueOrgSlug(client, baseName);
    try {
      return await createOrganization(client, name, slug);
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 2) continue; // raced; recompute + retry
      throw error;
    }
  }
  throw new Error("Could not allocate a unique organization slug.");
}

async function upsertDefaultWorkspace(
  client: TypedSupabaseClient,
  org: OrganizationRow,
  workspaceName: string,
  workspaceType: WorkspaceType,
  userId: string,
  attribution: AttributionRecord | null = null,
) {
  const workspaceSlug = slugify(workspaceName || org.name);
  const { data: existing, error: existingError } = await client
    .from("workspaces")
    .select("id,org_id,key,slug,name")
    .eq("org_id", org.id)
    .eq("key", "default")
    .maybeSingle<WorkspaceRow>();

  if (existingError) throw existingError;

  if (existing) {
    const { data, error } = await client
      .from("workspaces")
      .update({
        name: workspaceName,
        workspace_type: workspaceType,
        created_by: userId,
        status: "active",
      })
      .eq("id", existing.id)
      .select("id,org_id,key,slug,name")
      .single<WorkspaceRow>();

    if (error) throw error;
    return data;
  }

  const { data, error } = await client
    .from("workspaces")
    .insert({
      org_id: org.id,
      key: "default",
      slug: workspaceSlug,
      name: workspaceName,
      workspace_type: workspaceType,
      created_by: userId,
      settings: { createdFromOnboarding: true },
      metadata: {},
      // Only on INSERT. The update branch above reclaims a pre-existing default
      // workspace, and overwriting its attribution there would rewrite the
      // channel credit of a workspace that was already acquired.
      attribution: attributionColumnValue(attribution),
    })
    .select("id,org_id,key,slug,name")
    .single<WorkspaceRow>();

  if (error) throw error;
  return data;
}

async function createOwnerMemberships(client: TypedSupabaseClient, orgId: string, workspaceId: string, userId: string, email: string) {
  const joinedAt = new Date().toISOString();
  const orgMembership = {
    org_id: orgId,
    user_id: userId,
    invited_email: email,
    role: "owner",
    status: "active",
    joined_at: joinedAt,
  };
  const workspaceMembership = {
    org_id: orgId,
    workspace_id: workspaceId,
    user_id: userId,
    invited_email: email,
    role: "owner",
    status: "active",
    joined_at: joinedAt,
  };

  const { data: existingOrgMembership, error: existingOrgError } = await client
    .from("organization_memberships")
    .select("id")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle<{ id: string }>();

  if (existingOrgError) throw existingOrgError;

  const { error: orgError } = existingOrgMembership
    ? await client.from("organization_memberships").update(orgMembership).eq("id", existingOrgMembership.id)
    : await client.from("organization_memberships").insert(orgMembership);

  if (orgError) throw orgError;

  const { data: existingWorkspaceMembership, error: existingWorkspaceError } = await client
    .from("workspace_memberships")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle<{ id: string }>();

  if (existingWorkspaceError) throw existingWorkspaceError;

  const { error: workspaceError } = existingWorkspaceMembership
    ? await client.from("workspace_memberships").update(workspaceMembership).eq("id", existingWorkspaceMembership.id)
    : await client.from("workspace_memberships").insert(workspaceMembership);

  if (workspaceError) throw workspaceError;
}

async function createWorkspaceDefaults(
  client: TypedSupabaseClient,
  org: OrganizationRow,
  workspace: WorkspaceRow,
  userId: string,
  industry = "general",
) {
  await client.from("arc_instances").upsert(
    {
      org_id: org.id,
      workspace_id: workspace.id,
      key: "arc",
      display_name: "Arc",
      status: "active",
      memory_policy: "approval_required",
    },
    { onConflict: "workspace_id,key" },
  );

  // The `agents` row Arc is actually looked up by. Every enqueue path — chat
  // (arc-chat/enqueue), opportunity scans and drafts (opportunities/enqueue),
  // campaign revisions — resolves `agents` by (org_id, key) and REFUSES when
  // there's no row: "Arc isn't connected to this workspace yet." Only the
  // originally seeded tenant ever had one, so every workspace created through
  // this path had an Arc that could not be given a single instruction.
  //
  // Distinct from arc_instances above, which is the per-workspace Arc identity;
  // this is the agent that agent_tasks.agent_id points at. The key must match
  // DEFAULT_CONNECTION.agentKey in lib/agent/connection.ts.
  //
  // `agents` is workspace-owned by the BSR-637 boundary (two workspaces in one
  // company could legitimately want different approval policies) and gained
  // workspace_id in BSR-712. NOTE the conflict target is still (org_id, key):
  // equivalent today, since no product path puts a second workspace in an
  // existing org, but it is the constraint that would have to move first if one
  // ever did. Tracked on BSR-713 rather than changed here — a Phase A does not
  // rewrite unique constraints.
  await client.from("agents").upsert(
    {
      org_id: org.id,
      workspace_id: workspace.id,
      key: "arc",
      name: "Arc",
      description: "Marketing operator. Drafts and prepares; never sends without approval.",
      status: "ready",
      default_approval_policy: "owner_required",
    },
    { onConflict: "org_id,key" },
  );

  // The brand identity a workspace creates from (BSR-714) — distinct from
  // workspaces.logo_url, which is shell chrome. NOTE the conflict target is still
  // (org_id): business_profiles has a bare UNIQUE (org_id), which does not merely
  // fail to express workspace ownership, it forbids it. Flagged for BSR-715.
  await client.from("business_profiles").upsert(
    {
      org_id: org.id,
      workspace_id: workspace.id,
      display_name: org.name,
      legal_name: org.name,
      short_mark: shortMarkFor(org.name),
      industry,
      status: "draft",
    },
    { onConflict: "org_id" },
  );

  await seedDefaultMediaFolders({ orgId: org.id, client });
  await seedDefaultPersonas({ orgId: org.id, client, industry });

  // Pipeline stages. Best-effort, unlike the two above: every read falls back to
  // DEFAULT_PIPELINE_STAGES, so a workspace without seeded rows behaves
  // identically — it just can't be edited in Settings until the first save
  // materialises the set. Failing workspace creation over that trades a working
  // workspace for a cosmetic one.
  await seedDefaultPipelineStages({ orgId: org.id, client, industry }).catch((error) => {
    reportDegraded(error, { scope: "workspace-onboarding.seedDefaultPipelineStages", surface: "secondary" });
    return 0;
  });

  // Start the free trial. Best-effort and non-renewing: a failure must not fail
  // workspace creation, and a workspace with no trial dates is fully usable
  // rather than locked out (see src/domain/trial.ts).
  await startTrialForOrg({ orgId: org.id }, client);

  await client.from("audit_events").insert({
    org_id: org.id,
    workspace_id: workspace.id,
    actor_user_id: userId,
    actor_kind: "user",
    action: "workspace.created",
    subject_table: "workspaces",
    subject_id: workspace.id,
    summary: `Workspace created for ${org.name}.`,
    metadata: { source: "onboarding" },
  });
}

export async function createWorkspaceForAuthenticatedUser(input: CreateWorkspaceInput): Promise<CreateWorkspaceResult> {
  if (!isSupabaseAdminConfigured()) {
    return { ok: false, status: "not_configured", message: "Supabase admin env vars are required to create a workspace." };
  }

  const user = await getSupabaseAuthenticatedUser();
  if (!user) {
    return { ok: false, status: "not_authenticated", message: "Sign in before creating a workspace." };
  }

  // Invite-only means invited INTO a workspace, not handed the keys to found more.
  // Every explicit creation path — Settings → New workspace, /onboarding, and
  // POST /api/auth/onboarding — funnels through here, so this is the one place
  // the rule has to hold. Without it, closing sign-up still let any invited
  // teammate spin up their own tenant from Settings.
  //
  // Scoped to the closed configuration: with self-serve sign-up open (local dev,
  // demo, and once the product opens up) anyone who can sign up can obviously
  // create the workspace they signed up for, and this must not block them.
  if (!isSelfServeSignupOpen() && !isPlatformAdmin(user.email)) {
    return {
      ok: false,
      status: "not_authorized",
      message:
        "Creating new workspaces is limited to platform operators right now. Ask for an invite to an existing workspace.",
    };
  }

  // Which channel produced this workspace (BSR-586). Read here because this is a
  // request boundary and the cookie only exists in one; the caller may also pass
  // it explicitly, which wins. Never fails the creation — null is "unattributed".
  const attribution = input.attribution ?? (await readAttributionRecord());

  // The explicit "create workspace" UI must create a genuinely NEW workspace, even
  // for users who already belong to one — otherwise it's a silent no-op that drops
  // them back into their existing org. Provisioning (which auto-creates on first
  // sign-in) calls createWorkspaceForUser directly and keeps the reuse default.
  return createWorkspaceForUser(
    getSupabaseAdminClient(),
    user,
    { ...input, attribution },
    { reuseExistingMembership: false },
  );
}

export async function createWorkspaceForUser(
  client: TypedSupabaseClient,
  user: User,
  input: CreateWorkspaceInput,
  options: { reuseExistingMembership?: boolean } = {},
): Promise<CreateWorkspaceResult> {
  if (!isSupabaseAdminConfigured()) {
    return { ok: false, status: "not_configured", message: "Supabase admin env vars are required to create a workspace." };
  }

  const email = user.email?.trim().toLowerCase();
  const organizationName = normalizeName(input.organizationName);
  const workspaceName = normalizeName(input.workspaceName, organizationName);
  const workspaceType = normalizeWorkspaceType(input.workspaceType);
  const industry = normalizeIndustry(input.industry);

  if (!email || organizationName.length < 2 || workspaceName.length < 2) {
    return { ok: false, status: "invalid_input", message: "Enter an organization and workspace name." };
  }

  try {
    // Idempotency guard for the provisioning path (default). The explicit create
    // flow opts out so it always provisions a new org+workspace.
    if (options.reuseExistingMembership ?? true) {
      const existingMembership = await getActiveMembershipForUser(client, user.id);
      if (existingMembership) {
        return {
          ok: true,
          orgId: existingMembership.org_id,
          workspaceId: existingMembership.workspace_id,
          claimedExistingOrg: false,
        };
      }
    }

    const org = await createOrganizationUnique(client, organizationName, organizationName);
    const workspace = await upsertDefaultWorkspace(client, org, workspaceName, workspaceType, user.id, input.attribution ?? null);

    await createOwnerMemberships(client, org.id, workspace.id, user.id, email);
    await createWorkspaceDefaults(client, org, workspace, user.id, industry);

    return { ok: true, orgId: org.id, workspaceId: workspace.id, claimedExistingOrg: false };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      message: error instanceof Error ? error.message : "Workspace creation failed.",
    };
  }
}

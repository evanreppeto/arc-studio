import {
  isEmptyIdentityPatch,
  isWorkspaceAccentKey,
  normalizeWorkspaceIdentityPatch,
  type NormalizedWorkspaceIdentityPatch,
  type WorkspaceAccentKey,
  type WorkspaceIdentityPatch,
} from "@/domain";
import { getSupabaseAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getSupabaseAdminClient, isSupabaseAdminConfigured, type TypedSupabaseClient } from "@/lib/supabase/server";

import { recordWorkspaceAudit } from "./workspace-audit";
import { ASSIGNABLE_WORKSPACE_ROLES, isAssignableRole, roleLabel, type WorkspaceRoleKey } from "./workspace-roles";

export type UserWorkspace = {
  workspaceId: string;
  workspaceName: string;
  workspaceType: string;
  workspaceStatus: string;
  orgId: string;
  orgName: string;
  role: string;
  /** Stored display identity — nullable; resolveWorkspaceIdentity applies the fallbacks. */
  subtitle: string | null;
  shortLabel: string | null;
  accentKey: WorkspaceAccentKey | null;
  logoUrl: string | null;
};

export type WorkspaceActivityEntry = {
  id: string;
  action: string;
  summary: string | null;
  actorEmail: string | null;
  createdAt: string;
};

export type MemberMutationResult =
  | { ok: true }
  | {
      ok: false;
      status: "not_authenticated" | "not_configured" | "not_authorized" | "invalid_input" | "failed";
      message: string;
    };

/** Owner/admin guard for member management, mirroring workspace-invites.ts. */
async function requireWorkspaceAdmin(workspaceId: string) {
  if (!isSupabaseAdminConfigured()) {
    return { ok: false as const, status: "not_configured" as const, message: "Supabase admin env vars are required." };
  }
  const user = await getSupabaseAuthenticatedUser();
  if (!user) {
    return { ok: false as const, status: "not_authenticated" as const, message: "Sign in before managing the team." };
  }

  const client = getSupabaseAdminClient();
  const { data: membership, error } = await client
    .from("workspace_memberships")
    .select("org_id,role,status")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle<{ org_id: string; role: string; status: string }>();

  if (error) throw error;
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    return { ok: false as const, status: "not_authorized" as const, message: "Only workspace owners and admins can manage the team." };
  }

  return { ok: true as const, client, user, role: membership.role, orgId: membership.org_id };
}

/** Every active workspace the signed-in user belongs to, with org + role context. */
export async function listWorkspacesForUser(): Promise<UserWorkspace[]> {
  if (!isSupabaseAdminConfigured()) return [];
  const user = await getSupabaseAuthenticatedUser();
  if (!user) return [];

  const client = getSupabaseAdminClient();
  const { data: memberships, error } = await client
    .from("workspace_memberships")
    .select("workspace_id,org_id,role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error || !memberships?.length) return [];

  const workspaceIds = [...new Set(memberships.map((row) => row.workspace_id))];
  const orgIds = [...new Set(memberships.map((row) => row.org_id))];

  const [{ data: workspaces }, { data: orgs }] = await Promise.all([
    client
      .from("workspaces")
      .select("id,name,workspace_type,status,subtitle,short_label,accent_key,logo_url")
      .in("id", workspaceIds),
    client.from("organizations").select("id,name").in("id", orgIds),
  ]);

  const workspaceById = new Map((workspaces ?? []).map((row) => [row.id, row]));
  const orgById = new Map((orgs ?? []).map((row) => [row.id, row]));

  return memberships
    .map((row) => {
      const workspace = workspaceById.get(row.workspace_id);
      if (!workspace) return null;
      return {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        workspaceType: workspace.workspace_type,
        workspaceStatus: workspace.status,
        orgId: row.org_id,
        orgName: orgById.get(row.org_id)?.name ?? "Organization",
        role: row.role,
        subtitle: workspace.subtitle ?? null,
        shortLabel: workspace.short_label ?? null,
        accentKey: isWorkspaceAccentKey(workspace.accent_key) ? workspace.accent_key : null,
        logoUrl: workspace.logo_url ?? null,
      } satisfies UserWorkspace;
    })
    .filter((value): value is UserWorkspace => value !== null);
}

/** Recent audit events for a workspace (admin-only), with actor emails resolved. */
export async function listWorkspaceActivity(workspaceId: string, limit = 12): Promise<WorkspaceActivityEntry[]> {
  const access = await requireWorkspaceAdmin(workspaceId.trim());
  if (!access.ok) return [];

  const { data, error } = await access.client
    .from("audit_events")
    .select("id,action,summary,actor_user_id,created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data?.length) return [];

  const actorIds = [...new Set(data.map((row) => row.actor_user_id).filter((id): id is string => Boolean(id)))];
  let emailByActor = new Map<string, string | null>();
  if (actorIds.length) {
    const { data: profiles } = await access.client.from("profiles").select("id,email").in("id", actorIds);
    emailByActor = new Map((profiles ?? []).map((row) => [row.id, row.email ?? null]));
  }

  return data.map((row) => ({
    id: row.id,
    action: row.action,
    summary: row.summary ?? null,
    actorEmail: row.actor_user_id ? emailByActor.get(row.actor_user_id) ?? null : null,
    createdAt: row.created_at,
  }));
}

async function fetchTargetMembership(client: TypedSupabaseClient, workspaceId: string, membershipId: string) {
  const { data, error } = await client
    .from("workspace_memberships")
    .select("id,role,user_id,invited_email,status")
    .eq("id", membershipId)
    .eq("workspace_id", workspaceId)
    .maybeSingle<{ id: string; role: string; user_id: string | null; invited_email: string | null; status: string }>();
  if (error) throw error;
  return data ?? null;
}

function memberLabel(email: string | null): string {
  return email ?? "a member";
}

/** Change a member's workspace role. Owners can't be re-roled; you can't change your own. */
export async function changeWorkspaceMemberRole(input: {
  workspaceId: string;
  membershipId: string;
  role: string;
}): Promise<MemberMutationResult> {
  const workspaceId = input.workspaceId.trim();
  const membershipId = input.membershipId.trim();
  if (!workspaceId || !membershipId) return { ok: false, status: "invalid_input", message: "Workspace and member are required." };
  if (!isAssignableRole(input.role)) {
    return { ok: false, status: "invalid_input", message: `Role must be one of: ${ASSIGNABLE_WORKSPACE_ROLES.join(", ")}.` };
  }
  const nextRole: WorkspaceRoleKey = input.role;

  try {
    const access = await requireWorkspaceAdmin(workspaceId);
    if (!access.ok) return access;

    const target = await fetchTargetMembership(access.client, workspaceId, membershipId);
    if (!target) return { ok: false, status: "invalid_input", message: "That member could not be found." };
    if (target.role === "owner") return { ok: false, status: "not_authorized", message: "The workspace owner's role can't be changed here." };
    if (target.user_id && target.user_id === access.user.id) {
      return { ok: false, status: "not_authorized", message: "You can't change your own role." };
    }

    const { error } = await access.client
      .from("workspace_memberships")
      .update({ role: nextRole })
      .eq("id", membershipId)
      .eq("workspace_id", workspaceId);
    if (error) throw error;

    await recordWorkspaceAudit({
      orgId: access.orgId,
      workspaceId,
      actorUserId: access.user.id,
      action: "member.role_changed",
      summary: `Changed ${memberLabel(target.invited_email)} to ${roleLabel(nextRole)}`,
      subjectTable: "workspace_memberships",
      subjectId: membershipId,
      metadata: { from: target.role, to: nextRole },
    });

    return { ok: true };
  } catch (error) {
    return { ok: false, status: "failed", message: error instanceof Error ? error.message : "The role could not be updated." };
  }
}

/** Remove a member from the workspace (status → removed). Owners and self are protected. */
export async function removeWorkspaceMember(input: {
  workspaceId: string;
  membershipId: string;
}): Promise<MemberMutationResult> {
  const workspaceId = input.workspaceId.trim();
  const membershipId = input.membershipId.trim();
  if (!workspaceId || !membershipId) return { ok: false, status: "invalid_input", message: "Workspace and member are required." };

  try {
    const access = await requireWorkspaceAdmin(workspaceId);
    if (!access.ok) return access;

    const target = await fetchTargetMembership(access.client, workspaceId, membershipId);
    if (!target) return { ok: false, status: "invalid_input", message: "That member could not be found." };
    if (target.role === "owner") return { ok: false, status: "not_authorized", message: "The workspace owner can't be removed here." };
    if (target.user_id && target.user_id === access.user.id) {
      return { ok: false, status: "not_authorized", message: "You can't remove yourself." };
    }

    const { error } = await access.client
      .from("workspace_memberships")
      .update({ status: "removed" })
      .eq("id", membershipId)
      .eq("workspace_id", workspaceId);
    if (error) throw error;

    await recordWorkspaceAudit({
      orgId: access.orgId,
      workspaceId,
      actorUserId: access.user.id,
      action: "member.removed",
      summary: `Removed ${memberLabel(target.invited_email)}`,
      subjectTable: "workspace_memberships",
      subjectId: membershipId,
      metadata: { role: target.role },
    });

    return { ok: true };
  } catch (error) {
    return { ok: false, status: "failed", message: error instanceof Error ? error.message : "The member could not be removed." };
  }
}

/**
 * Update any workspace's display identity — the four fields the rail renders
 * plus, optionally, the organization name.
 *
 * Workspace name and organization name are deliberately *separate* inputs here.
 * They used to be one: the old renameWorkspace wrote the same string to both
 * rows, which is why the rail's bold line and the grey line under it were always
 * the same text. A caller that genuinely wants the legacy coupled rename passes
 * both fields with the same value.
 *
 * Owner/admin of the target workspace only — the guard takes the workspaceId, so
 * this works for any workspace the caller administers, not just the active one.
 * Nothing here is outbound; it is display chrome.
 */
export async function updateWorkspaceIdentity(
  input: { workspaceId: string } & WorkspaceIdentityPatch,
): Promise<MemberMutationResult> {
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) return { ok: false, status: "invalid_input", message: "A workspace is required." };

  const normalized = normalizeWorkspaceIdentityPatch(input);
  if (!normalized.ok) return { ok: false, status: "invalid_input", message: normalized.error };
  const { patch } = normalized;
  if (isEmptyIdentityPatch(patch)) return { ok: true };

  try {
    const access = await requireWorkspaceAdmin(workspaceId);
    if (!access.ok) return access;

    const workspaceUpdate: {
      name?: string;
      subtitle?: string | null;
      short_label?: string | null;
      accent_key?: string | null;
    } = {};
    if (patch.name !== undefined) workspaceUpdate.name = patch.name;
    if (patch.subtitle !== undefined) workspaceUpdate.subtitle = patch.subtitle;
    if (patch.shortLabel !== undefined) workspaceUpdate.short_label = patch.shortLabel;
    if (patch.accentKey !== undefined) workspaceUpdate.accent_key = patch.accentKey;

    const writes: PromiseLike<{ error: { message: string } | null }>[] = [];
    if (Object.keys(workspaceUpdate).length) {
      writes.push(access.client.from("workspaces").update(workspaceUpdate).eq("id", workspaceId));
    }
    if (patch.orgName !== undefined) {
      writes.push(access.client.from("organizations").update({ name: patch.orgName }).eq("id", access.orgId));
    }

    for (const { error } of await Promise.all(writes)) {
      if (error) throw error;
    }

    await recordWorkspaceAudit({
      orgId: access.orgId,
      workspaceId,
      actorUserId: access.user.id,
      action: "workspace.identity_updated",
      summary: summarizeIdentityPatch(patch),
      subjectTable: "workspaces",
      subjectId: workspaceId,
      metadata: { ...patch },
    });

    return { ok: true };
  } catch (error) {
    return { ok: false, status: "failed", message: error instanceof Error ? error.message : "The workspace could not be updated." };
  }
}

/** Human-readable audit line: what actually changed, not just "updated". */
function summarizeIdentityPatch(patch: NormalizedWorkspaceIdentityPatch): string {
  const parts: string[] = [];
  if (patch.name !== undefined) parts.push(`name to ${patch.name}`);
  if (patch.orgName !== undefined) parts.push(`organization to ${patch.orgName}`);
  if (patch.subtitle !== undefined) parts.push(patch.subtitle ? `subtitle to ${patch.subtitle}` : "cleared the subtitle");
  if (patch.shortLabel !== undefined) parts.push(patch.shortLabel ? `label to ${patch.shortLabel}` : "cleared the label");
  if (patch.accentKey !== undefined) parts.push(patch.accentKey ? `color to ${patch.accentKey}` : "reset the color");
  return parts.length ? `Set the workspace ${parts.join(", ")}` : "Updated the workspace identity";
}

/**
 * Set or clear the workspace-level logo. Kept apart from the identity patch
 * because the URL comes from an upload round-trip rather than a form field, and
 * apart from business_profiles.logo_url because *that* logo is org-scoped and
 * gets stamped on generated creative. This one is app chrome.
 */
export async function setWorkspaceRowLogo(workspaceId: string, url: string | null): Promise<MemberMutationResult> {
  const id = workspaceId.trim();
  if (!id) return { ok: false, status: "invalid_input", message: "A workspace is required." };

  try {
    const access = await requireWorkspaceAdmin(id);
    if (!access.ok) return access;

    const { error } = await access.client.from("workspaces").update({ logo_url: url }).eq("id", id);
    if (error) throw error;

    await recordWorkspaceAudit({
      orgId: access.orgId,
      workspaceId: id,
      actorUserId: access.user.id,
      action: "workspace.identity_updated",
      summary: url ? "Set the workspace logo" : "Removed the workspace logo",
      subjectTable: "workspaces",
      subjectId: id,
      metadata: { logoUrl: url },
    });

    return { ok: true };
  } catch (error) {
    return { ok: false, status: "failed", message: error instanceof Error ? error.message : "The logo could not be saved." };
  }
}

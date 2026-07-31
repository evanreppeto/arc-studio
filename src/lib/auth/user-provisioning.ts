import type { User } from "@supabase/supabase-js";

import { getSupabaseAdminClient, isSupabaseAdminConfigured, type TypedSupabaseClient } from "@/lib/supabase/server";

import { hashInviteCode, normalizeInviteCode } from "./workspace-invites";
import { createWorkspaceForUser } from "./workspace-onboarding";
import { readAttributionRecord } from "@/lib/signup-attribution/server";

type PendingWorkspaceInvite = {
  id: string;
  org_id: string;
  workspace_id: string;
  role: string;
};

type PendingWorkspaceInviteCode = PendingWorkspaceInvite & {
  invited_email: string | null;
  expires_at: string | null;
};

export type ProvisionUserResult =
  | {
      ok: true;
      status: "existing_member" | "invited_member" | "created_owner";
      orgId: string;
      workspaceId: string;
    }
  | { ok: true; status: "profile_only"; orgId: null; workspaceId: null }
  | { ok: false; status: "not_configured" | "missing_workspace" | "missing_email" | "failed"; message: string };

export type RedeemWorkspaceInviteCodeResult =
  | { ok: true; status: "invited_member"; orgId: string; workspaceId: string }
  | {
      ok: false;
      status:
        | "not_configured"
        | "invalid_input"
        | "missing_email"
        | "not_found"
        | "email_mismatch"
        | "expired"
        | "failed";
      message: string;
    };

function userDisplayName(user: User) {
  const metadata = user.user_metadata ?? {};
  const name = metadata.full_name ?? metadata.name ?? metadata.display_name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function normalizeEmail(email: string | null | undefined) {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

function getPendingInviteCode(user: User) {
  return normalizeInviteCode(user.user_metadata?.pending_invite_code);
}

function getPendingWorkspaceIntent(user: User) {
  return user.user_metadata?.pending_workspace_intent === "create" ? "create" : null;
}

function getPendingOrganizationName(user: User) {
  const value = user.user_metadata?.pending_organization_name;
  return typeof value === "string" ? value.trim() : "";
}

function getPendingWorkspaceType(user: User) {
  const value = user.user_metadata?.pending_workspace_type;
  return typeof value === "string" ? value.trim() : "company";
}

function getPendingIndustry(user: User) {
  const value = user.user_metadata?.pending_industry;
  return typeof value === "string" ? value.trim() : "general";
}

function organizationRoleForWorkspaceRole(role: string) {
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  return "member";
}

async function upsertProfile(client: TypedSupabaseClient, user: User, email: string) {
  await client.from("profiles").upsert(
    {
      id: user.id,
      email,
      full_name: userDisplayName(user),
    },
    { onConflict: "id" },
  );
}

async function ensureOrganizationMembership(
  client: TypedSupabaseClient,
  input: { orgId: string; userId: string; email: string; role: string },
) {
  const membership = {
    org_id: input.orgId,
    user_id: input.userId,
    invited_email: input.email,
    role: input.role,
    status: "active",
    joined_at: new Date().toISOString(),
  };
  const { data: existingMembership, error } = await client
    .from("organization_memberships")
    .select("id")
    .eq("org_id", input.orgId)
    .eq("user_id", input.userId)
    .maybeSingle<{ id: string }>();

  if (error) throw error;

  if (existingMembership) {
    const { error: updateError } = await client
      .from("organization_memberships")
      .update(membership)
      .eq("id", existingMembership.id);
    if (updateError) throw updateError;
    return;
  }

  const { error: insertError } = await client.from("organization_memberships").insert(membership);
  if (insertError) throw insertError;
}

async function ensureWorkspaceMembership(
  client: TypedSupabaseClient,
  input: { orgId: string; workspaceId: string; userId: string; email: string; role: string },
) {
  const membership = {
    org_id: input.orgId,
    workspace_id: input.workspaceId,
    user_id: input.userId,
    invited_email: input.email,
    role: input.role,
    status: "active",
    joined_at: new Date().toISOString(),
  };
  const { data: existingMembership, error } = await client
    .from("workspace_memberships")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .maybeSingle<{ id: string }>();

  if (error) throw error;

  if (existingMembership) {
    const { error: updateError } = await client
      .from("workspace_memberships")
      .update(membership)
      .eq("id", existingMembership.id);
    if (updateError) throw updateError;
    return;
  }

  const { error: insertError } = await client.from("workspace_memberships").insert(membership);
  if (insertError) throw insertError;
}

async function acceptPendingInvite(client: TypedSupabaseClient, user: User, email: string): Promise<PendingWorkspaceInvite | null> {
  const { data: invite, error } = await client
    .from("workspace_memberships")
    .select("id,org_id,workspace_id,role")
    .eq("status", "invited")
    .is("user_id", null)
    .ilike("invited_email", email)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<PendingWorkspaceInvite>();

  if (error || !invite) return null;

  const now = new Date().toISOString();
  await client
    .from("workspace_memberships")
    .update({ user_id: user.id, status: "active", joined_at: now })
    .eq("id", invite.id);

  const orgRole = organizationRoleForWorkspaceRole(invite.role);
  const { data: orgInvite } = await client
    .from("organization_memberships")
    .select("id")
    .eq("org_id", invite.org_id)
    .eq("status", "invited")
    .is("user_id", null)
    .ilike("invited_email", email)
    .maybeSingle<{ id: string }>();

  if (orgInvite) {
    await client
      .from("organization_memberships")
      .update({ user_id: user.id, status: "active", joined_at: now })
      .eq("id", orgInvite.id);
  } else {
    await ensureOrganizationMembership(client, {
      email,
      orgId: invite.org_id,
      role: orgRole,
      userId: user.id,
    });
  }

  return invite;
}

async function redeemInviteCode(
  client: TypedSupabaseClient,
  user: User,
  email: string,
  inviteCodeInput: string,
): Promise<
  | { status: "redeemed"; invite: PendingWorkspaceInvite }
  | { status: "empty" | "not_found" | "email_mismatch" | "expired" }
> {
  const inviteCode = normalizeInviteCode(inviteCodeInput);
  if (!inviteCode) return { status: "empty" };

  const { data: invite, error } = await client
    .from("workspace_invites")
    .select("id,org_id,workspace_id,role,invited_email,expires_at")
    .eq("code_hash", hashInviteCode(inviteCode))
    .eq("status", "active")
    .maybeSingle<PendingWorkspaceInviteCode>();

  if (error || !invite) return { status: "not_found" };

  const invitedEmail = normalizeEmail(invite.invited_email);
  if (invitedEmail && invitedEmail !== email) return { status: "email_mismatch" };

  if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
    return { status: "expired" };
  }

  const now = new Date().toISOString();
  const orgRole = organizationRoleForWorkspaceRole(invite.role);

  await ensureOrganizationMembership(client, {
    email,
    orgId: invite.org_id,
    role: orgRole,
    userId: user.id,
  });
  await ensureWorkspaceMembership(client, {
    email,
    orgId: invite.org_id,
    role: invite.role,
    userId: user.id,
    workspaceId: invite.workspace_id,
  });

  const { error: updateError } = await client
    .from("workspace_invites")
    .update({ status: "used", used_at: now, used_by: user.id })
    .eq("id", invite.id);
  if (updateError) throw updateError;

  return { status: "redeemed", invite };
}

async function acceptPendingInviteCode(client: TypedSupabaseClient, user: User, email: string): Promise<PendingWorkspaceInvite | null> {
  const redeemed = await redeemInviteCode(client, user, email, getPendingInviteCode(user));
  return redeemed.status === "redeemed" ? redeemed.invite : null;
}

async function getActiveWorkspaceMembership(client: TypedSupabaseClient, userId: string) {
  const { data, error } = await client
    .from("workspace_memberships")
    .select("org_id,workspace_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ org_id: string; workspace_id: string }>();

  if (error) return null;
  return data ?? null;
}

export async function provisionAuthenticatedUser(user: User): Promise<ProvisionUserResult> {
  if (!isSupabaseAdminConfigured()) {
    return { ok: false, status: "not_configured", message: "Supabase admin env vars are required to provision users." };
  }

  const email = normalizeEmail(user.email);
  if (!email) return { ok: false, status: "missing_email", message: "Supabase user is missing an email address." };

  const client = getSupabaseAdminClient();

  try {
    await upsertProfile(client, user, email);

    const activeMembership = await getActiveWorkspaceMembership(client, user.id);
    if (activeMembership) {
      return {
        ok: true,
        status: "existing_member",
        orgId: activeMembership.org_id,
        workspaceId: activeMembership.workspace_id,
      };
    }

    const codeInvite = await acceptPendingInviteCode(client, user, email);
    if (codeInvite) {
      return { ok: true, status: "invited_member", orgId: codeInvite.org_id, workspaceId: codeInvite.workspace_id };
    }

    const invite = await acceptPendingInvite(client, user, email);
    if (invite) {
      return { ok: true, status: "invited_member", orgId: invite.org_id, workspaceId: invite.workspace_id };
    }

    if (getPendingWorkspaceIntent(user) === "create") {
      const created = await createWorkspaceForUser(client, user, {
        industry: getPendingIndustry(user),
        organizationName: getPendingOrganizationName(user),
        workspaceType: getPendingWorkspaceType(user),
        // The self-serve path: this runs on first sign-in, in a request, so the
        // attribution cookie set before signup is still readable here (BSR-586).
        // This is the call site that actually attributes a self-serve workspace —
        // createWorkspaceForAuthenticatedUser covers the explicit "new workspace" UI.
        attribution: await readAttributionRecord(),
      });
      if (created.ok) {
        return { ok: true, status: "created_owner", orgId: created.orgId, workspaceId: created.workspaceId };
      }
      if (created.status !== "invalid_input") {
        return { ok: false, status: "failed", message: created.message };
      }
    }

    return { ok: true, status: "profile_only", orgId: null, workspaceId: null };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      message: error instanceof Error ? error.message : "User provisioning failed.",
    };
  }
}

export async function redeemWorkspaceInviteCodeForUser(
  client: TypedSupabaseClient,
  user: User,
  inviteCode: string,
): Promise<RedeemWorkspaceInviteCodeResult> {
  if (!isSupabaseAdminConfigured()) {
    return { ok: false, status: "not_configured", message: "Supabase admin env vars are required to join a workspace." };
  }

  const email = normalizeEmail(user.email);
  if (!email) return { ok: false, status: "missing_email", message: "Supabase user is missing an email address." };

  try {
    const redeemed = await redeemInviteCode(client, user, email, inviteCode);
    if (redeemed.status === "redeemed") {
      return {
        ok: true,
        status: "invited_member",
        orgId: redeemed.invite.org_id,
        workspaceId: redeemed.invite.workspace_id,
      };
    }
    if (redeemed.status === "empty") {
      return { ok: false, status: "invalid_input", message: "Enter a workspace invite code." };
    }
    if (redeemed.status === "email_mismatch") {
      return { ok: false, status: "email_mismatch", message: "That invite code is tied to a different email address." };
    }
    if (redeemed.status === "expired") {
      return { ok: false, status: "expired", message: "That invite code has expired. Ask an owner for a new one." };
    }
    return { ok: false, status: "not_found", message: "That invite code is invalid or has already been used." };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      message: error instanceof Error ? error.message : "Workspace invite could not be redeemed.",
    };
  }
}

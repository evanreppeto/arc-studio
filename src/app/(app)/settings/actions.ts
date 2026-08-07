"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { type MediaConfig, normalizeEmailAddress, parseMediaConfig } from "@/domain";
import { getOperatorActor, requireOperator } from "@/lib/auth/operator";
import { recordEmailSuppression } from "@/lib/email-suppression/persistence";
import { sendWorkspaceInviteEmail } from "@/lib/auth/send-invite-email";
import {
  changeWorkspaceMemberRole,
  listWorkspacesForUser,
  removeWorkspaceMember,
  updateWorkspaceIdentity,
} from "@/lib/auth/workspace-admin";
import { ACTIVE_WORKSPACE_COOKIE, getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { canonicalIndustryKey } from "@/lib/product-language";
import { cancelWorkspaceInvite, issueWorkspaceInviteCode } from "@/lib/auth/workspace-invites";
import { createWorkspaceForAuthenticatedUser } from "@/lib/auth/workspace-onboarding";
import {
  appAppearanceAccent,
  appAppearanceDensity,
  appAppearanceMotion,
  appWorkspaceProfile,
  DEFAULT_APP_SETTINGS,
  isValidSupportEmail,
  normalizeDisplayLabel,
  normalizeObjectLabels,
  saveAppSettings,
} from "@/lib/settings/store";
import { saveWorkspaceMediaConfig } from "@/lib/media-config/persistence";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

/**
 * Real operator writes for the Settings surfaces. Every one is an internal
 * account/preferences operation — nothing outbound beyond the branded invite
 * email. `persisted: false` is the honest offline signal so the UI can update
 * optimistically without claiming a real write.
 */
export type SettingsWriteResult =
  | { ok: true; persisted: boolean; message?: string }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Persist the workspace's media generation config — the model default for BOTH
 * engines, per output category. Operator-gated and scoped to the caller's
 * workspace. The payload is re-normalized via parseMediaConfig so an invalid or
 * retired model id from the client is dropped to "auto" before it lands.
 * Nothing outbound: this only records how the next generation resolves.
 *
 * Returns a real result rather than `void`. The previous signature could not
 * distinguish "saved", "no backend", and "no workspace" — every one of them
 * returned undefined, so an operator's Save looked identical whether it wrote a
 * row or silently did nothing. It had no caller at all when it was written, so
 * nobody found out; the panel now reports what actually happened.
 */
export async function saveMediaConfig(config: MediaConfig): Promise<SettingsWriteResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const ctx = await getCurrentWorkspaceContext();
  // No workspace yet — the (app) layout redirects to onboarding, so this is a
  // race rather than a normal state. Say so instead of reporting a phantom save.
  if (!ctx.workspaceId) return { ok: false, error: "Finish setting up your workspace first." };

  try {
    await saveWorkspaceMediaConfig(getSupabaseAdminClient(), {
      workspaceId: ctx.workspaceId,
      orgId: ctx.orgId,
      config: parseMediaConfig(config),
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save the generation defaults." };
  }

  revalidatePath("/settings");
  revalidatePath("/studio");
  return { ok: true, persisted: true, message: "Saved." };
}

/**
 * Issue a single-use workspace invite code. Owner/admin gated. Internal account
 * operation — the only outbound is the branded invite email, and only when a
 * workspace is actually connected. Offline returns `persisted: false`.
 */
export async function createInvite(input: {
  email: string;
  role: string;
  expiresInDays?: number;
}): Promise<SettingsWriteResult> {
  await requireOperator();

  const email = input.email?.trim();
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };

  // Offline/demo: no DB. Report success-but-unpersisted so the pending list can
  // show it without claiming a real invite was issued.
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.workspaceId) return { ok: false, error: "No active workspace to invite into yet." };

  const result = await issueWorkspaceInviteCode({
    workspaceId: ctx.workspaceId,
    invitedEmail: email,
    role: input.role?.toLowerCase(),
    expiresInDays: input.expiresInDays,
  });
  if (!result.ok) return { ok: false, error: result.message ?? "Could not create the invite." };

  // Best-effort branded email — a send hiccup must not fail the invite, because the
  // code is valid either way. But it must not be REPORTED as sent either: this used
  // to swallow the failure (and the missing-host case) and then say "Invite sent to
  // X" unconditionally, so an operator would sit waiting for mail that never left.
  let emailed = false;
  let emailError: string | null = null;
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    if (!host) {
      emailError = "no request host to build the invite link from";
    } else {
      await sendWorkspaceInviteEmail({ code: result.code, invitedEmail: email, origin: `${proto}://${host}` });
      emailed = true;
    }
  } catch (error) {
    emailError = error instanceof Error ? error.message : "the email provider rejected it";
  }
  if (!emailed) {
    console.warn(`[settings] invite email not sent to ${email} — ${emailError ?? "unknown reason"}`);
  }

  revalidatePath("/settings");
  return {
    ok: true,
    persisted: true,
    message: emailed
      ? `Invite sent to ${email}.`
      : `Invite created for ${email}, but the email couldn't be sent — share the code from the pending list instead.`,
  };
}

/**
 * Switch the active workspace. Only workspaces the user actually belongs to are
 * accepted (checked against listWorkspacesForUser), then the active-workspace
 * cookie is repointed and the whole app re-tailors on the next render.
 */
export async function switchWorkspace(input: { workspaceId: string }): Promise<SettingsWriteResult> {
  await requireOperator();

  const workspaceId = input.workspaceId?.trim();
  if (!workspaceId) return { ok: false, error: "A workspace is required." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const mine = await listWorkspacesForUser();
  if (!mine.some((w) => w.workspaceId === workspaceId)) {
    return { ok: false, error: "You’re not a member of that workspace." };
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
  return { ok: true, persisted: true, message: "Switched workspace." };
}

function humanizeWorkspaceError(status: string, message?: string): string {
  switch (status) {
    case "not_authenticated":
      return "Sign in to create a workspace.";
    case "not_authorized":
      // Carries the reason from the gate — a generic "could not" would read as a
      // bug rather than the deliberate invite-only policy it is.
      return message ?? "You don't have permission to create a workspace.";
    case "invalid_input":
      return "Enter an organization and workspace name.";
    default:
      return message ?? "Could not create the workspace.";
  }
}

export async function createWorkspace(input: {
  organizationName: string;
  workspaceName: string;
  workspaceType: string;
  industry: string;
}): Promise<SettingsWriteResult> {
  await requireOperator();

  const org = input.organizationName?.trim();
  const workspace = input.workspaceName?.trim();
  if (!workspace) return { ok: false, error: "A workspace name is required." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const result = await createWorkspaceForAuthenticatedUser({
    organizationName: org || workspace,
    workspaceName: workspace,
    workspaceType: input.workspaceType || "company",
    industry: canonicalIndustryKey(input.industry),
  });
  if (!result.ok) return { ok: false, error: humanizeWorkspaceError(result.status, result.message) };

  // Pin the new workspace as active so the resolver doesn't fall back to an
  // older membership (mirrors createWorkspaceAction).
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, result.workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/settings");
  return { ok: true, persisted: true, message: `Created ${workspace}.` };
}

function humanizeMemberError(status: string, message?: string): string {
  switch (status) {
    case "not_authenticated":
      return "Sign in to manage the team.";
    case "not_authorized":
      return message ?? "Only workspace owners and admins can manage the team.";
    case "invalid_input":
      return message ?? "That member could not be found.";
    default:
      return message ?? "The change could not be saved.";
  }
}

function humanizeIdentityError(status: string, message?: string): string {
  switch (status) {
    case "not_authenticated":
      return "Sign in to edit this workspace.";
    case "not_authorized":
      return "Only owners and admins can edit a workspace’s name and look.";
    default:
      return message ?? "The workspace could not be updated.";
  }
}

/**
 * Save a workspace's display identity — the name, the subtitle under it, the
 * rail's short label, and its accent color. Works on ANY workspace the caller
 * owns or administers (the guard is keyed on workspaceId), which is what makes
 * the Settings list's per-row Edit possible rather than active-workspace-only.
 *
 * `organizationName` is separate from `name` on purpose: the org name is the
 * legal/brand name Arc uses as its outbound from-name, the workspace name is
 * what the rail shows. They were the same field until now.
 */
export async function updateWorkspaceIdentityAction(input: {
  workspaceId: string;
  name?: string;
  organizationName?: string;
  subtitle?: string | null;
  shortLabel?: string | null;
  accentKey?: string | null;
}): Promise<SettingsWriteResult> {
  await requireOperator();

  const workspaceId = input.workspaceId?.trim();
  if (!workspaceId) return { ok: false, error: "A workspace is required." };
  if (input.name !== undefined && !input.name.trim()) return { ok: false, error: "A workspace name is required." };

  // Offline/demo: no DB. Report success-but-unpersisted so the UI updates
  // optimistically and the Status line says so honestly.
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const result = await updateWorkspaceIdentity({
    workspaceId,
    name: input.name,
    orgName: input.organizationName,
    subtitle: input.subtitle,
    shortLabel: input.shortLabel,
    accentKey: input.accentKey,
  });
  if (!result.ok) return { ok: false, error: humanizeIdentityError(result.status, result.message) };

  // The rail renders this on every signed-in screen.
  revalidatePath("/", "layout");
  return { ok: true, persisted: true, message: "Saved." };
}

export async function changeMemberRole(input: {
  workspaceId: string;
  membershipId: string;
  role: string;
}): Promise<SettingsWriteResult> {
  await requireOperator();
  if (!input.membershipId?.trim()) return { ok: false, error: "A member is required." };

  // Offline/demo: no DB. Report success-but-unpersisted so the UI can update optimistically.
  if (!isSupabaseAdminConfigured() || !input.workspaceId?.trim()) return { ok: true, persisted: false };

  const result = await changeWorkspaceMemberRole({
    workspaceId: input.workspaceId,
    membershipId: input.membershipId,
    role: input.role?.toLowerCase(),
  });
  if (!result.ok) return { ok: false, error: humanizeMemberError(result.status, result.message) };

  revalidatePath("/settings");
  return { ok: true, persisted: true };
}

export async function removeMember(input: {
  workspaceId: string;
  membershipId: string;
}): Promise<SettingsWriteResult> {
  await requireOperator();
  if (!input.membershipId?.trim()) return { ok: false, error: "A member is required." };

  if (!isSupabaseAdminConfigured() || !input.workspaceId?.trim()) return { ok: true, persisted: false };

  const result = await removeWorkspaceMember({ workspaceId: input.workspaceId, membershipId: input.membershipId });
  if (!result.ok) return { ok: false, error: humanizeMemberError(result.status, result.message) };

  revalidatePath("/settings");
  return { ok: true, persisted: true };
}

export async function cancelInvite(input: {
  workspaceId: string;
  inviteId: string;
}): Promise<SettingsWriteResult> {
  await requireOperator();
  if (!input.inviteId?.trim()) return { ok: false, error: "An invite is required." };

  if (!isSupabaseAdminConfigured() || !input.workspaceId?.trim()) return { ok: true, persisted: false };

  const result = await cancelWorkspaceInvite({ workspaceId: input.workspaceId, inviteId: input.inviteId });
  if (!result.ok) return { ok: false, error: humanizeMemberError(result.status, result.message) };

  revalidatePath("/settings");
  return { ok: true, persisted: true };
}

/**
 * Real writes for the app_settings-backed Settings panels (General, Appearance,
 * Runner display name). These are internal preferences — never secrets, never
 * outbound — persisted through the settings store and re-read by the root layout
 * (accent/density/motion) and by Arc (assistant name, support email). Offline
 * returns `persisted: false` so the UI can reflect the change optimistically
 * without claiming a real write. Layout revalidation lets the next render pick up
 * theme + name changes app-wide.
 */
// Settings are per-workspace (app_settings PK is (org_id, key)), so every save
// resolves the active workspace's org and scopes the write to it.
async function resolveOrgForSave(): Promise<{ ok: true; orgId: string } | { ok: false; error: string }> {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.orgId) return { ok: false, error: "No active workspace to save settings for." };
  return { ok: true, orgId: ctx.orgId };
}

export async function saveAppearanceSettings(input: {
  accent: string;
  density: string;
  motion: string;
}): Promise<SettingsWriteResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const org = await resolveOrgForSave();
  if (!org.ok) return org;

  try {
    await saveAppSettings(getSupabaseAdminClient(), org.orgId, {
      appearance_accent: appAppearanceAccent(input.accent),
      appearance_density: appAppearanceDensity(input.density),
      appearance_motion: appAppearanceMotion(input.motion),
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save appearance." };
  }

  revalidatePath("/", "layout");
  return { ok: true, persisted: true };
}

/**
 * Sender identity stamped into every outbound marketing email.
 *
 * The postal address is legally required (CAN-SPAM and equivalents) and cannot
 * be defaulted, so the send path refuses while it is blank. This is where an
 * operator unblocks it.
 */
export async function saveEmailIdentitySettings(input: {
  senderName: string;
  postalAddress: string;
  permissionReminder: string;
}): Promise<SettingsWriteResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const org = await resolveOrgForSave();
  if (!org.ok) return org;

  try {
    await saveAppSettings(getSupabaseAdminClient(), org.orgId, {
      email_sender_name: input.senderName.trim().slice(0, 120),
      email_postal_address: input.postalAddress.trim().slice(0, 400),
      email_permission_reminder: input.permissionReminder.trim().slice(0, 300),
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save email identity." };
  }

  revalidatePath("/settings");
  return { ok: true, persisted: true };
}

/**
 * Add an address to the suppression register by hand.
 *
 * The compliance case for this: an opt-out given by phone, by reply, or in
 * person is legally identical to one given by clicking the link, and before this
 * existed an operator had no way to honor it short of editing the database. The
 * gap was quiet, because the only visible opt-out path worked fine.
 *
 * Suppression is an outbound REFUSAL, so this needs no approval gate — it can
 * only ever reduce what gets sent.
 */
export async function suppressEmailAddress(input: { address: string; note?: string }): Promise<SettingsWriteResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const address = normalizeEmailAddress(input.address);
  if (!address) return { ok: false, error: "Enter an email address to suppress." };
  // Same permissive shape check the audience resolver uses — a typo'd address in
  // the register is harmless, but an obviously malformed one is a mistake worth
  // catching at the point of entry.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return { ok: false, error: `"${input.address.trim()}" doesn't look like an email address.` };
  }

  const org = await resolveOrgForSave();
  if (!org.ok) return org;

  const client = getSupabaseAdminClient();
  // Link the CRM contact when one shares the address, so the contact-level flag
  // is mirrored too and the CRM doesn't keep showing them as emailable.
  const { data: contact } = await client
    .from("contacts")
    .select("id")
    .eq("org_id", org.orgId)
    .ilike("email", address)
    .limit(1)
    .maybeSingle<{ id: string }>();

  const recorded = await recordEmailSuppression(
    {
      orgId: org.orgId,
      address,
      reason: "manual",
      source: await getOperatorActor(),
      detail: input.note?.trim().slice(0, 300) || null,
      contactId: contact?.id ?? null,
    },
    client,
  );
  if (!recorded.ok) return { ok: false, error: recorded.error };

  revalidatePath("/settings");
  return { ok: true, persisted: true };
}

export async function saveRunnerDisplayName(input: { assistantName: string }): Promise<SettingsWriteResult> {
  await requireOperator();

  const name = normalizeDisplayLabel(input.assistantName ?? "", DEFAULT_APP_SETTINGS.assistantName, 32);
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const org = await resolveOrgForSave();
  if (!org.ok) return org;

  try {
    await saveAppSettings(getSupabaseAdminClient(), org.orgId, { assistant_name: name });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save the display name." };
  }

  revalidatePath("/", "layout");
  return { ok: true, persisted: true, message: `Arc will show as “${name}”.` };
}

export async function saveGeneralSettings(input: {
  workspaceName?: string;
  organizationName?: string;
  workspaceProfile: string;
  industry: string;
  supportEmail: string;
}): Promise<SettingsWriteResult> {
  await requireOperator();

  const supportEmail = (input.supportEmail ?? "").trim();
  if (!isValidSupportEmail(supportEmail)) return { ok: false, error: "Enter a valid support email, or leave it blank." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.orgId) return { ok: false, error: "No active workspace to save settings for." };

  // Renaming touches the org/workspace identity rows (owner/admin gated), so it
  // runs first — if it fails we surface that before saving prefs. The two names
  // are independent now: the workspace name is what the rail shows, the
  // organization name is the brand/from-name. Only send what actually changed so
  // a viewer saving unrelated prefs never trips the owner/admin guard.
  const desiredName = input.workspaceName?.trim();
  const desiredOrgName = input.organizationName?.trim();
  const renameWorkspaceRow = Boolean(desiredName) && desiredName !== ctx.workspaceName?.trim();
  const renameOrgRow = Boolean(desiredOrgName) && desiredOrgName !== ctx.orgName?.trim();
  if (ctx.workspaceId && (renameWorkspaceRow || renameOrgRow)) {
    const renamed = await updateWorkspaceIdentity({
      workspaceId: ctx.workspaceId,
      ...(renameWorkspaceRow ? { name: desiredName } : {}),
      ...(renameOrgRow ? { orgName: desiredOrgName } : {}),
    });
    if (!renamed.ok) return { ok: false, error: humanizeIdentityError(renamed.status, renamed.message) };
  }

  try {
    const client = getSupabaseAdminClient();
    // Blank stays blank. `canonicalIndustryKey("")` returns "general", so saving
    // ANY unrelated field on this panel used to quietly commit an industry the
    // operator never picked — and "general" is a real choice, not a null. That
    // is what left three surfaces disagreeing about one empty field: the picker
    // showed "General / other", the overview said "Not set", and Connections
    // asked you to set an industry you appeared to have.
    const industry = input.industry.trim() ? canonicalIndustryKey(input.industry) : "";
    await saveAppSettings(client, ctx.orgId, {
      workspace_profile: appWorkspaceProfile(input.workspaceProfile),
      industry: industry ? normalizeDisplayLabel(industry, DEFAULT_APP_SETTINGS.industry, 60) : "",
      support_email: supportEmail,
    });
    const { error: profileError } = await client.from("business_profiles").update({ industry: industry || null }).eq("org_id", ctx.orgId);
    if (profileError) throw profileError;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save general settings." };
  }

  revalidatePath("/", "layout");
  return { ok: true, persisted: true, message: "Saved." };
}

/**
 * The workspace's own CRM object names.
 *
 * Industry templates cover nine trades; everyone else gets `general`'s neutral
 * nouns. This is the escape hatch for a workspace whose words are close but
 * wrong — a law firm calling `properties` "Matters".
 *
 * Both forms per object are required, and `normalizeObjectLabels` drops any
 * entry missing one: a half-filled row would render a "Matters" tab above an
 * "Add site" button. Clearing both fields removes the override and returns that
 * object to its industry label, which is how a workspace undoes a rename.
 */
export async function saveObjectLabelSettings(input: {
  section: string;
  objects: Record<string, { plural: string; singular: string }>;
}): Promise<SettingsWriteResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const org = await resolveOrgForSave();
  if (!org.ok) return org;

  const normalized = normalizeObjectLabels({ section: input.section, objects: input.objects });

  try {
    await saveAppSettings(getSupabaseAdminClient(), org.orgId, { crm_object_labels: normalized });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save object names." };
  }

  // Layout-wide: the CRM section name is in the nav rail on every screen.
  revalidatePath("/", "layout");
  return { ok: true, persisted: true, message: "Saved." };
}

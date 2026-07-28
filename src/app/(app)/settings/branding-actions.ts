"use server";

import { revalidatePath } from "next/cache";

import { requireOperator } from "@/lib/auth/operator";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { setWorkspaceRowLogo } from "@/lib/auth/workspace-admin";
import { uploadBrandingImage } from "@/lib/branding/images";
import { setWorkspaceLogo } from "@/lib/branding/logo";
import { getSupabaseAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

/**
 * Image-upload actions for workspace + personal branding. Both persist a public
 * image URL — the workspace logo through `setWorkspaceLogo` (the single store,
 * shared with the Brand screen: it shows in the rail AND on generated creative)
 * and the user avatar to profiles.avatar_url (per-user, rendered app-wide).
 * Operator-gated; revalidate the root layout so the shell picks up the new image
 * on the next render. Nothing outbound.
 */
export type BrandingResult = { ok: true; url: string | null } | { ok: false; error: string };

function file(formData: FormData): File | null {
  const value = formData.get("file");
  return value instanceof File && value.size > 0 ? value : null;
}

export async function saveWorkspaceLogoAction(formData: FormData): Promise<BrandingResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect a workspace to upload a logo." };
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.orgId) return { ok: false, error: "No active workspace." };

  const image = file(formData);
  if (!image) return { ok: false, error: "Choose an image first." };

  const uploaded = await uploadBrandingImage(`org/${ctx.orgId}`, image);
  if (!uploaded.ok) return uploaded;

  try {
    await setWorkspaceLogo(ctx.orgId, uploaded.url);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save the logo." };
  }
  revalidatePath("/", "layout");
  revalidatePath("/brand");
  return { ok: true, url: uploaded.url };
}

export async function removeWorkspaceLogoAction(): Promise<BrandingResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect a workspace first." };
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.orgId) return { ok: false, error: "No active workspace." };

  try {
    await setWorkspaceLogo(ctx.orgId, null);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not remove the logo." };
  }
  revalidatePath("/", "layout");
  revalidatePath("/brand");
  return { ok: true, url: null };
}

/**
 * Per-workspace logo, distinct from the org-scoped one above.
 *
 * `setWorkspaceLogo` writes business_profiles.logo_url — the brand record the
 * creative renderer FETCHES to stamp on generated ads. That logo belongs to the
 * organization and must not change just because one workspace under it wants a
 * different picture in its rail. So this pair writes workspaces.logo_url, which
 * is app chrome only and never reaches outbound.
 *
 * The workspaceId is explicit rather than taken from the active context: an
 * owner editing another of their workspaces from the Settings list is the whole
 * point. `setWorkspaceRowLogo` re-checks owner/admin on that workspace.
 */
export async function saveWorkspaceRowLogoAction(workspaceId: string, formData: FormData): Promise<BrandingResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect a workspace to upload a logo." };
  const id = workspaceId?.trim();
  if (!id) return { ok: false, error: "A workspace is required." };

  const image = file(formData);
  if (!image) return { ok: false, error: "Choose an image first." };

  const uploaded = await uploadBrandingImage(`workspace/${id}`, image);
  if (!uploaded.ok) return uploaded;

  const saved = await setWorkspaceRowLogo(id, uploaded.url);
  if (!saved.ok) return { ok: false, error: saved.message };

  revalidatePath("/", "layout");
  return { ok: true, url: uploaded.url };
}

export async function removeWorkspaceRowLogoAction(workspaceId: string): Promise<BrandingResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect a workspace first." };
  const id = workspaceId?.trim();
  if (!id) return { ok: false, error: "A workspace is required." };

  const saved = await setWorkspaceRowLogo(id, null);
  if (!saved.ok) return { ok: false, error: saved.message };

  revalidatePath("/", "layout");
  return { ok: true, url: null };
}

export async function saveUserAvatarAction(formData: FormData): Promise<BrandingResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect a workspace to set a photo." };
  const user = await getSupabaseAuthenticatedUser();
  if (!user?.id) return { ok: false, error: "Sign in to set a profile photo." };

  const image = file(formData);
  if (!image) return { ok: false, error: "Choose an image first." };

  const uploaded = await uploadBrandingImage(`user/${user.id}`, image);
  if (!uploaded.ok) return uploaded;

  const { error } = await getSupabaseAdminClient().from("profiles").update({ avatar_url: uploaded.url }).eq("id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true, url: uploaded.url };
}

export async function removeUserAvatarAction(): Promise<BrandingResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect a workspace first." };
  const user = await getSupabaseAuthenticatedUser();
  if (!user?.id) return { ok: false, error: "Sign in first." };

  const { error } = await getSupabaseAdminClient().from("profiles").update({ avatar_url: null }).eq("id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true, url: null };
}

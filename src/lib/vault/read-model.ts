import { seedVaultNotes } from "./seed-notes";
import { getVaultNoteBySlug, listVaultNotes, type VaultTenant } from "./persistence";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "../supabase/server";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { soleWorkspaceIdForOrg } from "@/lib/tenancy/resolve-workspace";
import type { VaultNote } from "@/domain";

const NOT_CONFIGURED = "Supabase is not configured. Showing example notes — saving is disabled until env vars are set.";

export type VaultNotesModel =
  | { status: "live"; notes: VaultNote[] }
  | { status: "fallback"; notes: VaultNote[]; message: string }
  | { status: "error"; notes: VaultNote[]; message: string };

// The tenant is the token-resolved scope for Arc API callers; operator/cookie
// callers omit it and fall back to the current workspace context. A headless
// runner token has no cookie, so without the explicit scope that fallback would
// resolve the DEFAULT org and leak the wrong tenant's notes.
//
// Both columns are filtered now (BSR-729) — the service role bypasses RLS, so
// org alone would return every workspace in the org.
async function resolveTenant(orgId?: string, workspaceId?: string): Promise<VaultTenant | null> {
  if (orgId && workspaceId) return { orgId, workspaceId };
  const context = await getCurrentWorkspaceContext();
  const resolvedOrg = orgId ?? context.orgId;
  const resolvedWorkspace =
    workspaceId ?? (context.orgId === resolvedOrg ? context.workspaceId : null) ??
    (await soleWorkspaceIdForOrg(getSupabaseAdminClient(), resolvedOrg));
  return resolvedWorkspace ? { orgId: resolvedOrg, workspaceId: resolvedWorkspace } : null;
}

export async function getVaultNotes(orgId?: string, workspaceId?: string): Promise<VaultNotesModel> {
  if (!isSupabaseAdminConfigured()) {
    return { status: "fallback", notes: seedVaultNotes, message: NOT_CONFIGURED };
  }
  try {
    const tenant = await resolveTenant(orgId, workspaceId);
    if (!tenant) return { status: "error", notes: seedVaultNotes, message: "No workspace is available for the vault." };
    const notes = await listVaultNotes(getSupabaseAdminClient(), tenant);
    return { status: "live", notes };
  } catch (error) {
    return { status: "error", notes: seedVaultNotes, message: error instanceof Error ? error.message : "Vault is unavailable." };
  }
}

export async function getVaultNote(slug: string, orgId?: string, workspaceId?: string): Promise<VaultNote | null> {
  if (!isSupabaseAdminConfigured()) {
    return seedVaultNotes.find((note) => note.slug === slug) ?? null;
  }
  try {
    const tenant = await resolveTenant(orgId, workspaceId);
    if (!tenant) return seedVaultNotes.find((note) => note.slug === slug) ?? null;
    return await getVaultNoteBySlug(getSupabaseAdminClient(), slug, tenant);
  } catch {
    return seedVaultNotes.find((note) => note.slug === slug) ?? null;
  }
}

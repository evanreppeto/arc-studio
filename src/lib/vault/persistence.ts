import { type SupabaseClient } from "@supabase/supabase-js";

import { type NoteStatus, type VaultNote } from "@/domain";

export type VaultNoteRow = {
  slug: string;
  title: string;
  folder: string;
  tags: string[] | null;
  author: string;
  status: string; // db enum: draft | needs_review | published | archived
  body: string | null;
  updated_at: string | null;
};

const STATUS_FROM_DB: Record<string, NoteStatus> = {
  draft: "Draft",
  needs_review: "Needs review",
  published: "Published",
};

const STATUS_TO_DB: Record<NoteStatus, string> = {
  Draft: "draft",
  "Needs review": "needs_review",
  Published: "published",
};

export function rowToVaultNote(row: VaultNoteRow): VaultNote {
  return {
    slug: row.slug,
    title: row.title,
    folder: row.folder,
    tags: row.tags ?? [],
    author: row.author,
    status: STATUS_FROM_DB[row.status] ?? "Draft",
    updated: row.updated_at ? row.updated_at.slice(0, 10) : "—",
    body: row.body ?? "",
  };
}

export function vaultNoteToRow(note: VaultNote) {
  return {
    slug: note.slug,
    title: note.title,
    folder: note.folder,
    tags: note.tags,
    author: note.author,
    status: STATUS_TO_DB[note.status],
    body: note.body,
  };
}

const SELECT = "slug,title,folder,tags,author,status,body,updated_at";

/**
 * Tenant for every vault read and write.
 *
 * Both columns, not just org (BSR-729). `vault_notes.workspace_id` has been
 * NOT NULL since BSR-715, but the app uses the SERVICE-ROLE client, which
 * bypasses RLS entirely — so this app-layer filter is the only boundary, and a
 * locked column filtered by org alone still returns the whole org.
 *
 * Required rather than optional: both callers (the arc-guarded vault route and
 * arc-chat mention search) already hold a workspace, so making it optional would
 * invite the org-only read straight back in.
 */
export type VaultTenant = { orgId: string; workspaceId: string };

// Slug is unique per (org, slug), so the upsert conflict target stays org-keyed.
export async function listVaultNotes(supabase: SupabaseClient, tenant: VaultTenant): Promise<VaultNote[]> {
  const { data, error } = await supabase
    .from("vault_notes")
    .select(SELECT)
    .eq("org_id", tenant.orgId)
    .eq("workspace_id", tenant.workspaceId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`vault_notes list failed: ${error.message}`);
  return ((data ?? []) as VaultNoteRow[]).map(rowToVaultNote);
}

export async function getVaultNoteBySlug(supabase: SupabaseClient, slug: string, tenant: VaultTenant): Promise<VaultNote | null> {
  const { data, error } = await supabase
    .from("vault_notes")
    .select(SELECT)
    .eq("org_id", tenant.orgId)
    .eq("workspace_id", tenant.workspaceId)
    .eq("slug", slug)
    .neq("status", "archived")
    .maybeSingle<VaultNoteRow>();
  if (error) throw new Error(`vault_notes get failed: ${error.message}`);
  return data ? rowToVaultNote(data) : null;
}

export async function upsertVaultNote(supabase: SupabaseClient, note: VaultNote, tenant: VaultTenant): Promise<void> {
  const { error } = await supabase
    .from("vault_notes")
    .upsert(
      { ...vaultNoteToRow(note), org_id: tenant.orgId, workspace_id: tenant.workspaceId },
      { onConflict: "org_id,slug" },
    );
  if (error) throw new Error(`vault_notes upsert failed: ${error.message}`);
}

export async function setVaultNoteStatus(supabase: SupabaseClient, slug: string, status: NoteStatus, tenant: VaultTenant): Promise<void> {
  const { error } = await supabase
    .from("vault_notes")
    .update({ status: STATUS_TO_DB[status] })
    .eq("org_id", tenant.orgId)
    .eq("workspace_id", tenant.workspaceId)
    .eq("slug", slug);
  if (error) throw new Error(`vault_notes status update failed: ${error.message}`);
}

// Soft-delete: archived notes are excluded from all reads.
export async function archiveVaultNote(supabase: SupabaseClient, slug: string, tenant: VaultTenant): Promise<void> {
  const { error } = await supabase
    .from("vault_notes")
    .update({ status: "archived" })
    .eq("org_id", tenant.orgId)
    .eq("workspace_id", tenant.workspaceId)
    .eq("slug", slug);
  if (error) throw new Error(`vault_notes archive failed: ${error.message}`);
}

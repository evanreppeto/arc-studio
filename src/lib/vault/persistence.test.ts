import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import {
  archiveVaultNote,
  getVaultNoteBySlug,
  listVaultNotes,
  rowToVaultNote,
  setVaultNoteStatus,
  upsertVaultNote,
  vaultNoteToRow,
  type VaultNoteRow,
} from "./persistence";
import type { VaultNote } from "@/domain";

const ROW: VaultNoteRow = {
  slug: "x",
  title: "X",
  folder: "Playbooks",
  tags: ["a", "b"],
  author: "Arc",
  status: "needs_review",
  body: "# X",
  updated_at: "2026-06-01T12:00:00.000Z",
};

describe("rowToVaultNote", () => {
  it("maps a db row to a VaultNote with display status and date", () => {
    expect(rowToVaultNote(ROW)).toEqual({
      slug: "x",
      title: "X",
      folder: "Playbooks",
      tags: ["a", "b"],
      author: "Arc",
      status: "Needs review",
      updated: "2026-06-01",
      body: "# X",
    });
  });

  it("defaults null tags and body", () => {
    const note = rowToVaultNote({ ...ROW, tags: null, body: null });
    expect(note.tags).toEqual([]);
    expect(note.body).toBe("");
  });
});

describe("vaultNoteToRow", () => {
  it("maps a VaultNote to a db row with enum status", () => {
    const note: VaultNote = {
      slug: "x", title: "X", folder: "Playbooks", tags: ["a"], author: "Arc",
      status: "Published", updated: "Today", body: "# X",
    };
    expect(vaultNoteToRow(note)).toEqual({
      slug: "x", title: "X", folder: "Playbooks", tags: ["a"], author: "Arc",
      status: "published", body: "# X",
    });
  });
});

// Both columns, always: vault reads go through the service-role client, which
// bypasses RLS, so org alone would return every workspace in the org (BSR-729).
const TENANT = { orgId: "org-1", workspaceId: "ws-1" };

const NOTE: VaultNote = {
  slug: "x", title: "X", folder: "Playbooks", tags: ["a"], author: "Arc",
  status: "Draft", updated: "", body: "# X",
};

describe("listVaultNotes", () => {
  it("scopes the note list to the org AND workspace", async () => {
    const supabase = createSupabaseQueryMock({ vault_notes: { data: [ROW], error: null } });

    await listVaultNotes(supabase, TENANT);

    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
    expect(supabase.calls).toContainEqual(["eq", "workspace_id", "ws-1"]);
  });
});

describe("getVaultNoteBySlug", () => {
  it("scopes the lookup to org, workspace and slug", async () => {
    const supabase = createSupabaseQueryMock({ vault_notes: { data: ROW, error: null } });

    await getVaultNoteBySlug(supabase, "x", TENANT);

    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
    expect(supabase.calls).toContainEqual(["eq", "workspace_id", "ws-1"]);
    expect(supabase.calls).toContainEqual(["eq", "slug", "x"]);
  });
});

describe("upsertVaultNote", () => {
  it("stamps org_id AND workspace_id, conflicting on (org_id, slug)", async () => {
    const supabase = createSupabaseQueryMock({ vault_notes: { data: null, error: null } });

    await upsertVaultNote(supabase, NOTE, TENANT);

    const upsertCall = supabase.calls.find((call) => call[0] === "upsert");
    expect(upsertCall?.[1]).toMatchObject({ slug: "x", org_id: "org-1", workspace_id: "ws-1" });
    expect(upsertCall?.[2]).toEqual({ onConflict: "org_id,slug" });
  });
});

describe("setVaultNoteStatus", () => {
  it("scopes the status update to org, workspace and slug", async () => {
    const supabase = createSupabaseQueryMock({ vault_notes: { data: null, error: null } });

    await setVaultNoteStatus(supabase, "x", "Published", TENANT);

    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
    expect(supabase.calls).toContainEqual(["eq", "workspace_id", "ws-1"]);
    expect(supabase.calls).toContainEqual(["eq", "slug", "x"]);
  });
});

describe("archiveVaultNote", () => {
  it("scopes the archive to org, workspace and slug", async () => {
    const supabase = createSupabaseQueryMock({ vault_notes: { data: null, error: null } });

    await archiveVaultNote(supabase, "x", TENANT);

    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
    expect(supabase.calls).toContainEqual(["eq", "workspace_id", "ws-1"]);
    expect(supabase.calls).toContainEqual(["eq", "slug", "x"]);
  });
});

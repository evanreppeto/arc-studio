import { describe, expect, it, vi } from "vitest";

// The rail's brand block resolves a workspace's mark as chrome logo → org brand
// record (see (app)/layout.tsx). listWorkspacesForUser used to read only
// workspaces.logo_url, so the switcher menu showed initials for the very
// workspace whose logo was drawn one row above it. These pin the two together.

type Row = Record<string, unknown>;

const TABLES: Record<string, Row[]> = {
  workspace_memberships: [
    { workspace_id: "ws-brand", org_id: "org-brand", role: "owner" },
    { workspace_id: "ws-chrome", org_id: "org-chrome", role: "admin" },
    { workspace_id: "ws-bare", org_id: "org-bare", role: "member" },
  ],
  workspaces: [
    { id: "ws-brand", name: "Brand Only", workspace_type: "company", status: "active", subtitle: null, short_label: null, accent_key: null, logo_url: null },
    { id: "ws-chrome", name: "Chrome Wins", workspace_type: "company", status: "active", subtitle: null, short_label: null, accent_key: null, logo_url: "/brand/chrome.png" },
    { id: "ws-bare", name: "No Logo", workspace_type: "company", status: "active", subtitle: null, short_label: null, accent_key: null, logo_url: null },
  ],
  organizations: [
    { id: "org-brand", name: "Brand Org" },
    { id: "org-chrome", name: "Chrome Org" },
    { id: "org-bare", name: "Bare Org" },
  ],
  business_profiles: [
    { org_id: "org-brand", logo_url: "https://cdn.test/brand.png" },
    { org_id: "org-chrome", logo_url: "https://cdn.test/other.png" },
    // org-bare has a brand row but nothing the renderer could fetch.
    { org_id: "org-bare", logo_url: "data:image/png;base64,iVBOR" },
  ],
};

/** Minimal stand-in for the query builder: select → in/eq/order all resolve to the table. */
function fakeClient() {
  return {
    from(table: string) {
      const result = { data: TABLES[table] ?? [], error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "in", "eq", "order"]) {
        builder[method] = () => builder;
      }
      // Awaiting the builder resolves to the rows.
      builder.then = (resolve: (value: typeof result) => unknown) => resolve(result);
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdminClient: () => fakeClient(),
  isSupabaseAdminConfigured: () => true,
}));
vi.mock("@/lib/supabase/auth-server", () => ({
  getSupabaseAuthenticatedUser: async () => ({ id: "user-1" }),
}));

const { listWorkspacesForUser } = await import("./workspace-admin");

describe("listWorkspacesForUser logo resolution", () => {
  it("falls back to the org brand mark when the workspace has no chrome logo", async () => {
    const byId = new Map((await listWorkspacesForUser()).map((w) => [w.workspaceId, w]));
    expect(byId.get("ws-brand")?.logoUrl).toBe("https://cdn.test/brand.png");
  });

  it("prefers the workspace's own chrome logo over the org brand mark", async () => {
    const byId = new Map((await listWorkspacesForUser()).map((w) => [w.workspaceId, w]));
    expect(byId.get("ws-chrome")?.logoUrl).toBe("/brand/chrome.png");
  });

  it("stays null when neither store holds a usable value, so the menu draws initials", async () => {
    const byId = new Map((await listWorkspacesForUser()).map((w) => [w.workspaceId, w]));
    expect(byId.get("ws-bare")?.logoUrl).toBeNull();
  });
});

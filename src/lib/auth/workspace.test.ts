import { describe, expect, it } from "vitest";

import { resolveWorkspaceContextForUser, WorkspaceUnavailableError } from "./workspace";

type TableRows = Record<string, Record<string, unknown>[]>;

function fakeClient(tables: TableRows) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          rows = rows.filter((row) => row[column] === value);
          return builder;
        },
        order: () => builder,
        limit: (count: number) => {
          rows = rows.slice(0, count);
          return builder;
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        // List-returning queries end in .returns() and are awaited directly
        // rather than via maybeSingle, so the builder has to be thenable.
        returns: () => builder,
        then: (resolve: (value: { data: Record<string, unknown>[]; error: null }) => unknown) =>
          resolve({ data: rows, error: null }),
      };
      return builder;
    },
  } as never;
}

describe("resolveWorkspaceContextForUser", () => {
  it("uses an active workspace membership when a Supabase user is available", async () => {
    const context = await resolveWorkspaceContextForUser(
      fakeClient({
        workspace_memberships: [
          {
            org_id: "org-1",
            workspace_id: "workspace-1",
            user_id: "user-1",
            role: "admin",
            status: "active",
            created_at: "2026-06-18T12:00:00.000Z",
          },
        ],
        workspaces: [
          {
            id: "workspace-1",
            org_id: "org-1",
            key: "bsr-marketing",
            slug: "big-shoulders-restoration",
            name: "Big Shoulders Restoration Marketing",
            status: "active",
          },
        ],
        organizations: [{ id: "org-1", slug: "big-shoulders-restoration", name: "Big Shoulders Restoration", status: "active" }],
      }),
      "user-1",
    );

    expect(context).toMatchObject({
      orgId: "org-1",
      workspaceId: "workspace-1",
      workspaceKey: "bsr-marketing",
      role: "admin",
      userId: "user-1",
      source: "membership",
    });
  });

  it("resolves the sole org for a session-less caller, whatever it is slugged", async () => {
    // Deliberately NOT the historic hardcoded slug: a single-tenant deployment
    // that isn't BSR used to throw outright here.
    const context = await resolveWorkspaceContextForUser(
      fakeClient({
        organizations: [{ id: "org-acme", slug: "acme-roofing", name: "Acme Roofing", status: "active" }],
        workspaces: [
          {
            id: "workspace-acme",
            org_id: "org-acme",
            key: "default",
            slug: "acme-roofing",
            name: "Acme Roofing",
            status: "active",
          },
        ],
      }),
      null,
    );

    expect(context).toMatchObject({ orgId: "org-acme", workspaceId: "workspace-acme", userId: null });
  });

  it("refuses to guess a tenant for a session-less caller when several orgs exist", async () => {
    await expect(
      resolveWorkspaceContextForUser(
        fakeClient({
          organizations: [
            { id: "org-1", slug: "big-shoulders-restoration", name: "Big Shoulders Restoration", status: "active" },
            { id: "org-2", slug: "acme-roofing", name: "Acme Roofing", status: "active" },
          ],
          workspaces: [
            { id: "workspace-1", org_id: "org-1", key: "default", slug: "bsr", name: "BSR", status: "active" },
            { id: "workspace-2", org_id: "org-2", key: "default", slug: "acme", name: "Acme", status: "active" },
          ],
        }),
        null,
      ),
    ).rejects.toThrow(/ambiguous/i);
  });

  // Retiring a tenant is what `status` is for. Counting archived orgs when
  // deciding ambiguity made the refusal permanent — archive a demo tenant and
  // every session-less caller kept refusing, with no way back but deleting rows.
  it("ignores archived orgs when deciding whether the tenant is ambiguous", async () => {
    const context = await resolveWorkspaceContextForUser(
      fakeClient({
        organizations: [
          { id: "org-demo", slug: "seeded-demo", name: "Seeded Demo", status: "archived" },
          { id: "org-real", slug: "acme-roofing", name: "Acme Roofing", status: "active" },
        ],
        workspaces: [
          { id: "ws-demo", org_id: "org-demo", key: "default", slug: "demo", name: "Demo", status: "active" },
          { id: "ws-real", org_id: "org-real", key: "default", slug: "acme", name: "Acme", status: "active" },
        ],
      }),
      null,
    );

    expect(context).toMatchObject({ orgId: "org-real", workspaceId: "ws-real" });
  });

  it("refuses when every org is archived, rather than resolving a retired tenant", async () => {
    await expect(
      resolveWorkspaceContextForUser(
        fakeClient({
          organizations: [{ id: "org-demo", slug: "seeded-demo", name: "Seeded Demo", status: "archived" }],
          workspaces: [
            { id: "ws-demo", org_id: "org-demo", key: "default", slug: "demo", name: "Demo", status: "active" },
          ],
        }),
        null,
      ),
    ).rejects.toThrow(/no active organization/i);
  });

  it("does not silently pick the historic BSR org when a second tenant exists", async () => {
    // The regression that matters: BSR present + another tenant must NOT resolve
    // to BSR. Asserting a non-BSR org can't pass vacuously here.
    await expect(
      resolveWorkspaceContextForUser(
        fakeClient({
          organizations: [
            { id: "org-bsr", slug: "big-shoulders-restoration", name: "Big Shoulders Restoration", status: "active" },
            { id: "org-other", slug: "other-tenant", name: "Other Tenant", status: "active" },
          ],
          workspaces: [
            { id: "ws-bsr", org_id: "org-bsr", key: "default", slug: "bsr", name: "BSR", status: "active" },
          ],
        }),
        null,
      ),
    ).rejects.toBeInstanceOf(WorkspaceUnavailableError);
  });

  it("resolves the sole active workspace for a session-less caller, whatever it is keyed", async () => {
    // Not keyed "default": such an org used to match nothing and yield a null
    // workspaceId (a 409) despite having exactly one possible answer.
    const context = await resolveWorkspaceContextForUser(
      fakeClient({
        organizations: [{ id: "org-1", slug: "acme-roofing", name: "Acme Roofing", status: "active" }],
        workspaces: [
          { id: "ws-1", org_id: "org-1", key: "acme-marketing", slug: "acme", name: "Acme", status: "active" },
        ],
      }),
      null,
    );

    expect(context).toMatchObject({ orgId: "org-1", workspaceId: "ws-1", workspaceKey: "acme-marketing" });
  });

  it("refuses to guess a workspace when the sole org has several active ones", async () => {
    await expect(
      resolveWorkspaceContextForUser(
        fakeClient({
          organizations: [{ id: "org-1", slug: "acme-roofing", name: "Acme Roofing", status: "active" }],
          workspaces: [
            { id: "ws-default", org_id: "org-1", key: "default", slug: "a", name: "A", status: "active" },
            { id: "ws-second", org_id: "org-1", key: "second-team", slug: "b", name: "B", status: "active" },
          ],
        }),
        null,
      ),
    ).rejects.toThrow(/ambiguous/i);
  });

  it("does not let the 'default' key break a workspace tie", async () => {
    // The regression that matters: a workspace keyed "default" must not win just
    // because it is keyed "default" — that was the last silent guess on this path.
    await expect(
      resolveWorkspaceContextForUser(
        fakeClient({
          organizations: [{ id: "org-1", slug: "acme-roofing", name: "Acme Roofing", status: "active" }],
          workspaces: [
            { id: "ws-default", org_id: "org-1", key: "default", slug: "a", name: "A", status: "active" },
            { id: "ws-other", org_id: "org-1", key: "other", slug: "b", name: "B", status: "active" },
          ],
        }),
        null,
      ),
    ).rejects.toBeInstanceOf(WorkspaceUnavailableError);
  });

  it("ignores inactive workspaces when deciding whether the answer is ambiguous", async () => {
    const context = await resolveWorkspaceContextForUser(
      fakeClient({
        organizations: [{ id: "org-1", slug: "acme-roofing", name: "Acme Roofing", status: "active" }],
        workspaces: [
          { id: "ws-live", org_id: "org-1", key: "live", slug: "a", name: "A", status: "active" },
          { id: "ws-dead", org_id: "org-1", key: "dead", slug: "b", name: "B", status: "archived" },
        ],
      }),
      null,
    );

    expect(context).toMatchObject({ workspaceId: "ws-live" });
  });

  it("refuses when no org exists at all", async () => {
    await expect(
      resolveWorkspaceContextForUser(fakeClient({ organizations: [], workspaces: [] }), null),
    ).rejects.toBeInstanceOf(WorkspaceUnavailableError);
  });

  it("falls back to the seeded default workspace before users are assigned", async () => {
    const context = await resolveWorkspaceContextForUser(
      fakeClient({
        organizations: [{ id: "org-1", slug: "big-shoulders-restoration", name: "Big Shoulders Restoration", status: "active" }],
        workspaces: [
          {
            id: "workspace-1",
            org_id: "org-1",
            key: "default",
            slug: "big-shoulders-restoration",
            name: "Big Shoulders Restoration",
            status: "active",
          },
        ],
      }),
      null,
    );

    expect(context).toMatchObject({
      orgId: "org-1",
      workspaceId: "workspace-1",
      workspaceKey: "default",
      role: null,
      userId: null,
      source: "default-org",
    });
  });

  it("does not fall back to the seeded workspace for signed-in users without access", async () => {
    await expect(
      resolveWorkspaceContextForUser(
        fakeClient({
          organizations: [{ id: "org-1", slug: "big-shoulders-restoration", name: "Big Shoulders Restoration", status: "active" }],
          workspaces: [
            {
              id: "workspace-1",
              org_id: "org-1",
              key: "default",
              slug: "big-shoulders-restoration",
              name: "Big Shoulders Restoration",
              status: "active",
            },
          ],
        }),
        "user-without-membership",
      ),
    ).rejects.toBeInstanceOf(WorkspaceUnavailableError);
  });
});

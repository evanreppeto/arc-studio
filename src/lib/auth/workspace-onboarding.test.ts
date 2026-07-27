import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdminClient: vi.fn(),
  isSupabaseAdminConfigured: vi.fn(),
}));

import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { createWorkspaceForUser, uniqueOrgSlug } from "./workspace-onboarding";

const getSupabaseAdminClientMock = vi.mocked(getSupabaseAdminClient);
const isSupabaseAdminConfiguredMock = vi.mocked(isSupabaseAdminConfigured);

// ---------------------------------------------------------------------------
// QueryBuilder — mirrors the pattern in user-provisioning.test.ts
// ---------------------------------------------------------------------------

type QueryCall = [method: string, ...args: unknown[]];

class QueryBuilder {
  calls: QueryCall[] = [];

  constructor(
    readonly table: string,
    private readonly responses: Map<string, unknown[]>,
  ) {}

  private shiftResponse<T>(kind: string, fallback: T): T {
    const key = `${this.table}:${kind}`;
    const queue = this.responses.get(key);
    if (!queue?.length) return fallback;
    return queue.shift() as T;
  }

  select(...args: unknown[]) {
    this.calls.push(["select", ...args]);
    return this;
  }

  upsert(...args: unknown[]) {
    this.calls.push(["upsert", ...args]);
    return Promise.resolve(this.shiftResponse("upsert", { data: null, error: null }));
  }

  insert(...args: unknown[]) {
    this.calls.push(["insert", ...args]);
    // Support both:
    //   client.from(t).insert(data)                    → awaited directly (Promise<{data,error}>)
    //   client.from(t).insert(data).select().single()  → chained
    const chainable = Object.assign(this, {
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(resolve(this.shiftResponse("insert", { data: null, error: null }))),
      select: (...selectArgs: unknown[]) => {
        this.calls.push(["select-after-insert", ...selectArgs]);
        return this;
      },
      single: <T>() => {
        this.calls.push(["single-after-insert"]);
        return Promise.resolve(this.shiftResponse<{ data: T | null; error: unknown | null }>("single", { data: null, error: null }));
      },
    });
    return chainable;
  }

  update(...args: unknown[]) {
    this.calls.push(["update", ...args]);
    return this;
  }

  eq(...args: unknown[]) {
    this.calls.push(["eq", ...args]);
    return this;
  }

  in(...args: unknown[]) {
    this.calls.push(["in", ...args]);
    return this;
  }

  order(...args: unknown[]) {
    this.calls.push(["order", ...args]);
    return this;
  }

  limit(...args: unknown[]) {
    this.calls.push(["limit", ...args]);
    return this;
  }

  maybeSingle<T>() {
    this.calls.push(["maybeSingle"]);
    return Promise.resolve(this.shiftResponse<{ data: T | null; error: unknown | null }>("maybeSingle", { data: null, error: null }));
  }

  single<T>() {
    this.calls.push(["single"]);
    return Promise.resolve(this.shiftResponse<{ data: T | null; error: unknown | null }>("single", { data: null, error: null }));
  }
}

function createClient(responses: Map<string, unknown[]>) {
  const builders: QueryBuilder[] = [];
  return {
    builders,
    from(table: string) {
      const builder = new QueryBuilder(table, responses);
      builders.push(builder);
      return builder;
    },
  };
}

function queue(responses: Map<string, unknown[]>, table: string, kind: string, response: unknown) {
  const key = `${table}:${kind}`;
  responses.set(key, [...(responses.get(key) ?? []), response]);
}

function user(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "operator@example.com",
    user_metadata: {},
    ...overrides,
  } as unknown as User;
}

beforeEach(() => {
  getSupabaseAdminClientMock.mockReset();
  isSupabaseAdminConfiguredMock.mockReset();
  isSupabaseAdminConfiguredMock.mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// Task 1: uniqueOrgSlug
// ---------------------------------------------------------------------------

describe("uniqueOrgSlug", () => {
  it("returns slugify(name) when the base slug is free", async () => {
    const exists = vi.fn().mockResolvedValue(false);
    const result = await uniqueOrgSlug("Big Shoulders Restoration", exists);
    expect(result).toBe("big-shoulders-restoration");
    expect(exists).toHaveBeenCalledWith("big-shoulders-restoration");
  });

  it("returns base-2 when base is taken but base-2 is free", async () => {
    const exists = vi.fn().mockImplementation(async (slug: string) => slug === "acme");
    const result = await uniqueOrgSlug("Acme", exists);
    expect(result).toBe("acme-2");
  });

  it("returns base-3 when base and base-2 are taken", async () => {
    const taken = new Set(["acme", "acme-2"]);
    const exists = vi.fn().mockImplementation(async (slug: string) => taken.has(slug));
    const result = await uniqueOrgSlug("Acme", exists);
    expect(result).toBe("acme-3");
  });

  it("returns base-<random-hex> when base through base-CAP are all taken", async () => {
    // Build a taken set: "acme", "acme-2" ... "acme-20"
    const taken = new Set(["acme"]);
    for (let n = 2; n <= 20; n++) taken.add(`acme-${n}`);
    const exists = vi.fn().mockImplementation(async (slug: string) => taken.has(slug));
    const result = await uniqueOrgSlug("Acme", exists);
    // Must match base-<6-char hex suffix> — shortSlugSuffix returns randomBytes(3).toString("hex")
    expect(result).toMatch(/^acme-[a-f0-9]{6}$/);
  });
});

// ---------------------------------------------------------------------------
// Task 2: createWorkspaceForUser
// ---------------------------------------------------------------------------

describe("createWorkspaceForUser", () => {
  it("creates a NEW org when the slug is already taken by a memberless org (no-claim)", async () => {
    const responses = new Map<string, unknown[]>();

    // getActiveMembershipForUser → no existing membership
    queue(responses, "workspace_memberships", "maybeSingle", { data: null, error: null });

    // uniqueOrgSlug: findOrganizationBySlug for "acme" → taken, "acme-2" → free
    queue(responses, "organizations", "maybeSingle", {
      data: { id: "existing-org", name: "Acme", slug: "acme" },
      error: null,
    });
    queue(responses, "organizations", "maybeSingle", { data: null, error: null });

    // createOrganization (insert) for "acme-2" → new org
    queue(responses, "organizations", "single", {
      data: { id: "new-org", name: "Acme", slug: "acme-2" },
      error: null,
    });

    // upsertDefaultWorkspace: no existing workspace → insert
    queue(responses, "workspaces", "maybeSingle", { data: null, error: null });
    queue(responses, "workspaces", "single", {
      data: { id: "workspace-1", org_id: "new-org", key: "default", slug: "acme-2", name: "Acme" },
      error: null,
    });

    // createOwnerMemberships: org membership (check existing) + workspace membership (check existing)
    queue(responses, "organization_memberships", "maybeSingle", { data: null, error: null });
    queue(responses, "workspace_memberships", "maybeSingle", { data: null, error: null });

    const client = createClient(responses);
    getSupabaseAdminClientMock.mockReturnValue(client as never);

    const result = await createWorkspaceForUser(client as never, user(), { organizationName: "Acme" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Must return the NEW org, not the existing one
    expect(result.orgId).toBe("new-org");
    expect(result.claimedExistingOrg).toBe(false);

    // An insert into organizations must have happened with a slug !== "acme"
    const orgInsert = client.builders.find(
      (b) => b.table === "organizations" && b.calls.some((c) => c[0] === "insert"),
    );
    expect(orgInsert).toBeDefined();
    const insertedSlug = (orgInsert!.calls.find((c) => c[0] === "insert")?.[1] as { slug?: string })?.slug;
    expect(insertedSlug).not.toBe("acme");
    expect(insertedSlug).toBe("acme-2");
  });

  it("short-circuits when the user already has an active membership", async () => {
    const responses = new Map<string, unknown[]>();

    // getActiveMembershipForUser → returns existing membership
    queue(responses, "workspace_memberships", "maybeSingle", {
      data: { org_id: "existing-org", workspace_id: "existing-workspace" },
      error: null,
    });

    const client = createClient(responses);
    getSupabaseAdminClientMock.mockReturnValue(client as never);

    const result = await createWorkspaceForUser(client as never, user(), { organizationName: "Anything" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.orgId).toBe("existing-org");
    expect(result.workspaceId).toBe("existing-workspace");

    // No org insert should have happened
    expect(client.builders.some((b) => b.table === "organizations" && b.calls.some((c) => c[0] === "insert"))).toBe(false);
  });

  it("creates a NEW workspace even when the user already has a membership (explicit create flow)", async () => {
    const responses = new Map<string, unknown[]>();

    // reuseExistingMembership:false → getActiveMembershipForUser is NOT consulted, so an
    // already-onboarded user gets a brand-new org+workspace instead of being bounced back
    // into their existing one (the silent no-op bug). The user DOES already have a
    // membership here: under the old short-circuit this returns "existing-org" with no
    // insert; the discriminating assertion below is that a new org is created instead.
    // First workspace_memberships:maybeSingle = the existing membership (consumed by
    // createOwnerMemberships under the new path; consumed by the short-circuit under the old).
    queue(responses, "workspace_memberships", "maybeSingle", {
      data: { org_id: "existing-org", workspace_id: "existing-workspace" },
      error: null,
    });

    // uniqueOrgSlug: "acme" → free
    queue(responses, "organizations", "maybeSingle", { data: null, error: null });
    // createOrganization insert → new org
    queue(responses, "organizations", "single", {
      data: { id: "new-org", name: "Acme", slug: "acme" },
      error: null,
    });
    // upsertDefaultWorkspace: none existing → insert
    queue(responses, "workspaces", "maybeSingle", { data: null, error: null });
    queue(responses, "workspaces", "single", {
      data: { id: "new-workspace", org_id: "new-org", key: "default", slug: "acme", name: "Acme" },
      error: null,
    });
    // createOwnerMemberships
    queue(responses, "organization_memberships", "maybeSingle", { data: null, error: null });
    queue(responses, "workspace_memberships", "maybeSingle", { data: null, error: null });

    const client = createClient(responses);
    getSupabaseAdminClientMock.mockReturnValue(client as never);

    const result = await createWorkspaceForUser(
      client as never,
      user(),
      { organizationName: "Acme" },
      { reuseExistingMembership: false },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.orgId).toBe("new-org");
    expect(result.workspaceId).toBe("new-workspace");
    // It must actually insert a new org rather than short-circuiting to an existing one.
    expect(client.builders.some((b) => b.table === "organizations" && b.calls.some((c) => c[0] === "insert"))).toBe(true);
  });

  it("retries on a 23505 unique violation race (returns second org)", async () => {
    const responses = new Map<string, unknown[]>();

    // getActiveMembershipForUser → no membership
    queue(responses, "workspace_memberships", "maybeSingle", { data: null, error: null });

    // First uniqueOrgSlug: "acme" → free
    queue(responses, "organizations", "maybeSingle", { data: null, error: null });

    // First createOrganization → 23505 race error
    queue(responses, "organizations", "single", {
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    // Second uniqueOrgSlug: "acme" → now taken (another process grabbed it), "acme-2" → free
    queue(responses, "organizations", "maybeSingle", {
      data: { id: "raced-org", name: "Acme", slug: "acme" },
      error: null,
    });
    queue(responses, "organizations", "maybeSingle", { data: null, error: null });

    // Second createOrganization → success
    queue(responses, "organizations", "single", {
      data: { id: "retried-org", name: "Acme", slug: "acme-2" },
      error: null,
    });

    // upsertDefaultWorkspace
    queue(responses, "workspaces", "maybeSingle", { data: null, error: null });
    queue(responses, "workspaces", "single", {
      data: { id: "workspace-1", org_id: "retried-org", key: "default", slug: "acme-2", name: "Acme" },
      error: null,
    });

    // createOwnerMemberships
    queue(responses, "organization_memberships", "maybeSingle", { data: null, error: null });
    queue(responses, "workspace_memberships", "maybeSingle", { data: null, error: null });

    const client = createClient(responses);
    getSupabaseAdminClientMock.mockReturnValue(client as never);

    const result = await createWorkspaceForUser(client as never, user(), { organizationName: "Acme" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.orgId).toBe("retried-org");
  });

  // Nothing in the codebase inserted an `agents` row — every reference was a
  // read. Only the originally seeded tenant had one, so a workspace created
  // through this path got an Arc that could not be given a single instruction:
  // chat, opportunity scans, drafts and campaign revisions all resolve
  // agents by (org_id, key) and refuse when it's missing.
  it("seeds the `agents` row Arc is enqueued against, scoped to the new org", async () => {
    const responses = new Map<string, unknown[]>();

    queue(responses, "workspace_memberships", "maybeSingle", { data: null, error: null });
    queue(responses, "organizations", "maybeSingle", { data: null, error: null });
    queue(responses, "organizations", "single", {
      data: { id: "new-org", name: "Acme", slug: "acme" },
      error: null,
    });
    queue(responses, "workspaces", "maybeSingle", { data: null, error: null });
    queue(responses, "workspaces", "single", {
      data: { id: "workspace-1", org_id: "new-org", key: "default", slug: "acme", name: "Acme" },
      error: null,
    });
    queue(responses, "organization_memberships", "maybeSingle", { data: null, error: null });
    queue(responses, "workspace_memberships", "maybeSingle", { data: null, error: null });

    const client = createClient(responses);
    getSupabaseAdminClientMock.mockReturnValue(client as never);

    await createWorkspaceForUser(client as never, user(), { organizationName: "Acme" });

    const agentsUpsert = client.builders
      .filter((b) => b.table === "agents")
      .flatMap((b) => b.calls)
      .find((c) => c[0] === "upsert");

    expect(agentsUpsert).toBeDefined();
    // The key must match DEFAULT_CONNECTION.agentKey — a row under any other key
    // is invisible to every enqueue path, which is the same as having none.
    expect(agentsUpsert?.[1]).toMatchObject({ org_id: "new-org", key: "arc", status: "ready" });
  });
});

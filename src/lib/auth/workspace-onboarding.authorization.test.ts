import type { User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isSupabaseAdminConfigured: vi.fn(() => true),
  getSupabaseAdminClient: vi.fn(),
  getSupabaseAuthenticatedUser: vi.fn(),
  isSelfServeSignupOpen: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: mocks.isSupabaseAdminConfigured,
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));
vi.mock("@/lib/supabase/auth-server", () => ({
  getSupabaseAuthenticatedUser: mocks.getSupabaseAuthenticatedUser,
}));
vi.mock("@/lib/auth/auth-mode", () => ({ isSelfServeSignupOpen: mocks.isSelfServeSignupOpen }));

import { createWorkspaceForAuthenticatedUser } from "./workspace-onboarding";

function user(email: string | undefined): User {
  return { id: "user-1", email, user_metadata: {} } as unknown as User;
}

const ORIGINAL_ADMINS = process.env.ARC_PLATFORM_ADMIN_EMAILS;

beforeEach(() => {
  mocks.isSupabaseAdminConfigured.mockReturnValue(true);
  mocks.isSelfServeSignupOpen.mockReturnValue(true);
  mocks.getSupabaseAuthenticatedUser.mockResolvedValue(user("teammate@example.com"));
  // Throws if creation is ever attempted — every authorization test below must
  // refuse before touching the database.
  mocks.getSupabaseAdminClient.mockImplementation(() => {
    throw new Error("createWorkspaceForUser should not have been reached");
  });
  delete process.env.ARC_PLATFORM_ADMIN_EMAILS;
});

afterEach(() => {
  if (ORIGINAL_ADMINS === undefined) delete process.env.ARC_PLATFORM_ADMIN_EMAILS;
  else process.env.ARC_PLATFORM_ADMIN_EMAILS = ORIGINAL_ADMINS;
});

describe("createWorkspaceForAuthenticatedUser authorization", () => {
  // Closing self-serve sign-up made the product invite-only, but an invited
  // teammate could still open Settings → New workspace and found their own
  // tenant. Invited INTO a workspace is not the same as licensed to create more.
  it("refuses when sign-up is closed and the user is not a platform operator", async () => {
    mocks.isSelfServeSignupOpen.mockReturnValue(false);

    const result = await createWorkspaceForAuthenticatedUser({ organizationName: "Their Own Co" });

    expect(result).toMatchObject({ ok: false, status: "not_authorized" });
  });

  it("allows a platform operator through while sign-up is closed", async () => {
    mocks.isSelfServeSignupOpen.mockReturnValue(false);
    process.env.ARC_PLATFORM_ADMIN_EMAILS = "operator@example.com, owner@example.com";
    mocks.getSupabaseAuthenticatedUser.mockResolvedValue(user("Owner@example.com"));

    // Reaching the admin client IS the pass condition — the gate is behind us.
    await expect(
      createWorkspaceForAuthenticatedUser({ organizationName: "Second Workspace" }),
    ).rejects.toThrow("should not have been reached");
  });

  it("does not gate anyone while self-serve sign-up is open", async () => {
    mocks.isSelfServeSignupOpen.mockReturnValue(true);

    await expect(
      createWorkspaceForAuthenticatedUser({ organizationName: "Acme" }),
    ).rejects.toThrow("should not have been reached");
  });

  it("still refuses an unauthenticated caller before considering the policy", async () => {
    mocks.isSelfServeSignupOpen.mockReturnValue(false);
    mocks.getSupabaseAuthenticatedUser.mockResolvedValue(null);

    const result = await createWorkspaceForAuthenticatedUser({ organizationName: "Acme" });

    expect(result).toMatchObject({ ok: false, status: "not_authenticated" });
  });

  it("refuses a user with no email address rather than defaulting to allowed", async () => {
    mocks.isSelfServeSignupOpen.mockReturnValue(false);
    process.env.ARC_PLATFORM_ADMIN_EMAILS = "operator@example.com";
    mocks.getSupabaseAuthenticatedUser.mockResolvedValue(user(undefined));

    const result = await createWorkspaceForAuthenticatedUser({ organizationName: "Acme" });

    expect(result).toMatchObject({ ok: false, status: "not_authorized" });
  });
});

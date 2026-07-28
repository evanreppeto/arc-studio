import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/auth-mode", () => ({ getAuthMode: vi.fn(), isSelfServeSignupOpen: vi.fn() }));
vi.mock("@/lib/auth/user-provisioning", () => ({ provisionAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/supabase/auth-server", () => ({ createSupabaseAuthServerClient: vi.fn() }));
vi.mock("@/lib/auth/workspace-invites", () => ({ lookupWorkspaceInviteByCode: vi.fn() }));

import { getAuthMode, isSelfServeSignupOpen } from "@/lib/auth/auth-mode";
import { provisionAuthenticatedUser } from "@/lib/auth/user-provisioning";
import { lookupWorkspaceInviteByCode } from "@/lib/auth/workspace-invites";
import { createSupabaseAuthServerClient } from "@/lib/supabase/auth-server";

import { POST } from "./route";

const getAuthModeMock = vi.mocked(getAuthMode);
const isSelfServeSignupOpenMock = vi.mocked(isSelfServeSignupOpen);
const lookupWorkspaceInviteByCodeMock = vi.mocked(lookupWorkspaceInviteByCode);
const provisionAuthenticatedUserMock = vi.mocked(provisionAuthenticatedUser);
const createSupabaseAuthServerClientMock = vi.mocked(createSupabaseAuthServerClient);
const signUpMock = vi.fn();

function signUpRequest(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }

  return new Request("http://localhost/api/auth/sign-up", {
    body: form,
    method: "POST",
  });
}

beforeEach(() => {
  getAuthModeMock.mockReset();
  isSelfServeSignupOpenMock.mockReset();
  lookupWorkspaceInviteByCodeMock.mockReset();
  provisionAuthenticatedUserMock.mockReset();
  createSupabaseAuthServerClientMock.mockReset();
  signUpMock.mockReset();

  getAuthModeMock.mockReturnValue("supabase");
  // Open by default: the invite gate is exercised explicitly below.
  isSelfServeSignupOpenMock.mockReturnValue(true);
  createSupabaseAuthServerClientMock.mockResolvedValue({
    auth: { signUp: signUpMock },
  } as unknown as Awaited<ReturnType<typeof createSupabaseAuthServerClient>>);
  signUpMock.mockResolvedValue({ data: { session: null, user: null }, error: null });
});

describe("POST /api/auth/sign-up", () => {
  it("passes split name signup fields to Supabase as a full profile name", async () => {
    const response = await POST(
      signUpRequest({
        email: "owner@example.com",
        firstName: "  Evan  ",
        from: "/arc",
        industry: "saas",
        lastName: "  Ryan  ",
        organizationName: "Big Shoulders Restoration",
        password: "strong-password",
        workspaceIntent: "create",
        workspaceType: "company",
      }),
    );

    expect(signUpMock).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "strong-password",
      options: {
        data: {
          full_name: "Evan Ryan",
          pending_industry: "saas",
          pending_organization_name: "Big Shoulders Restoration",
          pending_workspace_intent: "create",
          pending_workspace_type: "company",
        },
        emailRedirectTo: "http://localhost/auth/callback?next=%2Farc",
      },
    });
    expect(response.status).toBe(303);
  });

  it("passes invite-code signup intent to Supabase user metadata", async () => {
    const response = await POST(
      signUpRequest({
        email: "new.operator@example.com",
        from: "/arc",
        fullName: "  Jordan Demo  ",
        inviteCode: "  bsr 7k2m  ",
        password: "strong-password",
        workspaceIntent: "join",
        workspaceType: "company",
      }),
    );

    expect(signUpMock).toHaveBeenCalledWith({
      email: "new.operator@example.com",
      password: "strong-password",
      options: {
        data: {
          full_name: "Jordan Demo",
          pending_invite_code: "BSR7K2M",
          pending_workspace_intent: "join",
          pending_workspace_type: "company",
        },
        emailRedirectTo: "http://localhost/auth/callback?next=%2Farc",
      },
    });
    expect(provisionAuthenticatedUserMock).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost/sign-up?success=check_email&from=%2Farc");
  });

  it("waits for email confirmation before provisioning a created Supabase user without a session", async () => {
    signUpMock.mockResolvedValueOnce({
      data: {
        session: null,
        user: { id: "user-1", email: "owner@example.com", user_metadata: {} },
      },
      error: null,
    });

    const response = await POST(
      signUpRequest({
        email: "owner@example.com",
        firstName: "Evan",
        from: "/arc",
        lastName: "Ryan",
        organizationName: "Big Shoulders Restoration",
        password: "strong-password",
        workspaceIntent: "create",
        workspaceType: "company",
      }),
    );

    expect(provisionAuthenticatedUserMock).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost/sign-up?success=check_email&from=%2Farc");
  });

  // isSelfServeSignupOpen() was read by three pages and by nothing on this
  // route, so "closed" hid the form while leaving the endpoint that creates
  // accounts and workspaces open to anyone willing to POST to it.
  describe("when self-serve sign-up is closed", () => {
    beforeEach(() => {
      isSelfServeSignupOpenMock.mockReturnValue(false);
    });

    it("refuses a sign-up with no invite code, without touching Supabase", async () => {
      const response = await POST(
        signUpRequest({
          email: "stranger@example.com",
          firstName: "Uninvited",
          lastName: "Stranger",
          organizationName: "Their Own Co",
          password: "strong-password",
          workspaceIntent: "create",
        }),
      );

      expect(signUpMock).not.toHaveBeenCalled();
      expect(response.headers.get("location")).toContain("error=invite_required");
    });

    it("refuses when the invite code is expired, used, or unknown", async () => {
      lookupWorkspaceInviteByCodeMock.mockResolvedValue({ ok: false, reason: "expired" });

      const response = await POST(
        signUpRequest({
          email: "late@example.com",
          fullName: "Late Arrival",
          inviteCode: "OLD-CODE",
          password: "strong-password",
          workspaceIntent: "join",
        }),
      );

      expect(signUpMock).not.toHaveBeenCalled();
      expect(response.headers.get("location")).toContain("error=invite_required");
    });

    it("still admits a holder of a valid invite — the one path that must keep working", async () => {
      lookupWorkspaceInviteByCodeMock.mockResolvedValue({
        ok: true,
        workspaceName: "Big Shoulders Restoration",
        orgName: "Big Shoulders Restoration",
        role: "admin",
        invitedEmail: "teammate@example.com",
        inviterName: "Evan",
        expiresAt: null,
      });

      await POST(
        signUpRequest({
          email: "teammate@example.com",
          fullName: "Invited Teammate",
          inviteCode: "GOOD-CODE",
          password: "strong-password",
          workspaceIntent: "join",
        }),
      );

      expect(lookupWorkspaceInviteByCodeMock).toHaveBeenCalledWith("GOOD-CODE");
      expect(signUpMock).toHaveBeenCalled();
    });
  });
});

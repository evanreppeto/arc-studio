import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthMode: vi.fn(() => "supabase"),
  getSupabaseAuthUrl: vi.fn(() => "https://project.supabase.co"),
  getSupabaseAnonKey: vi.fn(() => "anon-key"),
  createSupabaseAuthServerClient: vi.fn(),
  createClient: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  probeSignIn: vi.fn(),
  probeSignOut: vi.fn(),
}));

vi.mock("@/lib/auth/auth-mode", () => ({
  getAuthMode: mocks.getAuthMode,
  getSupabaseAuthUrl: mocks.getSupabaseAuthUrl,
  getSupabaseAnonKey: mocks.getSupabaseAnonKey,
}));
vi.mock("@/lib/supabase/auth-server", () => ({
  createSupabaseAuthServerClient: mocks.createSupabaseAuthServerClient,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { POST } from "./route";

function request(password: string) {
  const form = new FormData();
  form.set("password", password);
  return new Request("https://arc-studio.ai/api/auth/reset-password", { method: "POST", body: form });
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset?.();
  mocks.getAuthMode.mockReturnValue("supabase");
  mocks.getSupabaseAuthUrl.mockReturnValue("https://project.supabase.co");
  mocks.getSupabaseAnonKey.mockReturnValue("anon-key");
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1", email: "operator@example.com" } } });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.createSupabaseAuthServerClient.mockResolvedValue({
    auth: { getUser: mocks.getUser, updateUser: mocks.updateUser },
  });
  // Probe: by default the password is NOT the current one.
  mocks.probeSignIn.mockResolvedValue({ data: { session: null }, error: { message: "Invalid login" } });
  mocks.createClient.mockReturnValue({
    auth: { signInWithPassword: mocks.probeSignIn, signOut: mocks.probeSignOut },
  });
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/auth/reset-password", () => {
  it("updates the password and sends the user to sign in", async () => {
    const response = await POST(request("a-brand-new-password"));

    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "a-brand-new-password" });
    expect(response.headers.get("location")).toBe("https://arc-studio.ai/login?reset=1");
  });

  // A reset that accepts the current password looks like it worked and changes
  // nothing — worst possible outcome when the reason for resetting is a
  // suspected compromise.
  it("refuses the password the account already has, without updating", async () => {
    mocks.probeSignIn.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });

    const response = await POST(request("the-current-password"));

    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("error=reuse");
  });

  it("discards the session the probe mints, so the recovery session survives", async () => {
    mocks.probeSignIn.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });

    await POST(request("the-current-password"));

    expect(mocks.probeSignOut).toHaveBeenCalled();
    // Isolated client: no cookie adapter, and it must not persist a session.
    expect(mocks.createClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "anon-key",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  });

  // Only a definite success proves reuse. A probe that breaks for an unrelated
  // reason must not lock someone out of resetting their password.
  it("fails open when the probe itself errors", async () => {
    mocks.probeSignIn.mockRejectedValue(new Error("network down"));

    const response = await POST(request("a-brand-new-password"));

    expect(mocks.updateUser).toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://arc-studio.ai/login?reset=1");
  });

  it("maps Supabase's own same-password rejection to the reuse message", async () => {
    mocks.updateUser.mockResolvedValue({
      error: { message: "New password should be different from the old password." },
    });

    const response = await POST(request("a-brand-new-password"));

    expect(response.headers.get("location")).toContain("error=reuse");
  });

  it("still rejects a short password before anything else", async () => {
    const response = await POST(request("short"));

    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("error=password");
  });

  it("refuses when the recovery link established no session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(request("a-brand-new-password"));

    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("error=expired");
  });
});

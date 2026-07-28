import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthMode: vi.fn(() => "supabase"),
  createSupabaseAuthServerClient: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));

vi.mock("@/lib/auth/auth-mode", () => ({ getAuthMode: mocks.getAuthMode }));
vi.mock("@/lib/supabase/auth-server", () => ({
  createSupabaseAuthServerClient: mocks.createSupabaseAuthServerClient,
}));

import { POST } from "./route";

const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

function request(email: string) {
  const form = new FormData();
  form.set("email", email);
  return new Request("https://marketing-abc123.vercel.app/api/auth/forgot-password", {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  // Hoisted mocks persist across tests; without this, call counts accumulate
  // and "was not called" assertions see the previous test's calls.
  mocks.resetPasswordForEmail.mockReset();
  mocks.createSupabaseAuthServerClient.mockReset();
  mocks.getAuthMode.mockReset();
  mocks.getAuthMode.mockReturnValue("supabase");
  mocks.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  mocks.createSupabaseAuthServerClient.mockResolvedValue({
    auth: { resetPasswordForEmail: mocks.resetPasswordForEmail },
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  delete process.env.NEXT_PUBLIC_APP_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_APP_URL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
});

describe("POST /api/auth/forgot-password", () => {
  // Supabase validates redirectTo against its allow-list and silently swaps in
  // the project Site URL on a miss, so the app has to send one predictable host
  // rather than whichever host served the request.
  it("builds the redirect from the pinned app origin, not the request host", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://arc-studio.ai";

    await POST(request("operator@example.com"));

    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("operator@example.com", {
      redirectTo: "https://arc-studio.ai/auth/callback?next=/reset-password",
    });
  });

  // The response must not reveal whether an address exists — but discarding the
  // REASON as well as the outcome made a rejected request (unlisted redirect,
  // rate limit, SMTP failure) indistinguishable from a delivered email. The only
  // way to tell was noticing auth.users.recovery_sent_at had stayed null.
  it("logs why a reset was not sent, while still answering uniformly", async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { message: "Invalid redirect URL" },
    });

    const response = await POST(request("operator@example.com"));

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid redirect URL"));
    expect(response.headers.get("location")).toContain("success=sent");
  });

  it("logs a thrown failure instead of swallowing it whole", async () => {
    mocks.createSupabaseAuthServerClient.mockRejectedValue(new Error("network down"));

    const response = await POST(request("operator@example.com"));

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("network down"));
    expect(response.headers.get("location")).toContain("success=sent");
  });

  it("answers identically for an address that was never submitted to Supabase", async () => {
    const response = await POST(request(""));

    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("success=sent");
  });
});

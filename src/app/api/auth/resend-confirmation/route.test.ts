import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/auth/auth-mode", () => ({ getAuthMode: vi.fn() }));
vi.mock("@/lib/supabase/auth-server", () => ({ createSupabaseAuthServerClient: vi.fn() }));

import { cookies } from "next/headers";

import { getAuthMode } from "@/lib/auth/auth-mode";
import { PENDING_CONFIRMATION_COOKIE } from "@/lib/auth/pending-confirmation";
import { createSupabaseAuthServerClient } from "@/lib/supabase/auth-server";

import { POST } from "./route";

const cookiesMock = vi.mocked(cookies);
const getAuthModeMock = vi.mocked(getAuthMode);
const createSupabaseAuthServerClientMock = vi.mocked(createSupabaseAuthServerClient);
const resendMock = vi.fn();

function setCookie(value: string | undefined) {
  cookiesMock.mockResolvedValue({
    get: (name: string) => (name === PENDING_CONFIRMATION_COOKIE && value ? { value } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

function request(fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("http://localhost/api/auth/resend-confirmation", { body: form, method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthModeMock.mockReturnValue("supabase");
  createSupabaseAuthServerClientMock.mockResolvedValue({
    auth: { resend: resendMock },
  } as unknown as Awaited<ReturnType<typeof createSupabaseAuthServerClient>>);
  resendMock.mockResolvedValue({ error: null });
  setCookie("owner@example.com");
});

describe("POST /api/auth/resend-confirmation", () => {
  it("resends to the cookie address and reports success", async () => {
    const response = await POST(request({ from: "/arc" }));

    expect(resendMock).toHaveBeenCalledWith({
      type: "signup",
      email: "owner@example.com",
      options: { emailRedirectTo: "http://localhost/auth/callback?next=%2Farc" },
    });
    expect(response.headers.get("location")).toContain("resend=sent");
  });

  it("never takes the recipient from the request body, so it can't be aimed at a stranger", async () => {
    const response = await POST(request({ email: "victim@example.com" }));

    expect(resendMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: "owner@example.com" }),
    );
    expect(response.headers.get("location")).toContain("resend=sent");
  });

  it("sends the operator back to a clean form when the pending cookie has expired", async () => {
    setCookie(undefined);

    const response = await POST(request());

    expect(resendMock).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("error=resend_expired");
  });

  it("distinguishes a rate-limited resend so the button doesn't look broken", async () => {
    resendMock.mockResolvedValue({ error: { status: 429, code: "over_email_send_rate_limit" } });

    const response = await POST(request());

    expect(response.headers.get("location")).toContain("resend=rate_limited");
  });

  it("reports a generic failure for other Supabase errors", async () => {
    resendMock.mockResolvedValue({ error: { status: 500, code: "unexpected_failure" } });

    const response = await POST(request());

    expect(response.headers.get("location")).toContain("resend=error");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetEmailRedirectWarning, authEmailRedirectOrigin } from "./email-redirect";

const original = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  // The warning latches per module load; without this the first test to trip it
  // would suppress it for every test after.
  __resetEmailRedirectWarning();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = original;
});

describe("authEmailRedirectOrigin", () => {
  it("pins to the configured public origin so one allow-list entry covers every host", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://arc-studio.ai";
    // A per-deployment Vercel host would otherwise need its own allow-list entry,
    // and a miss silently downgrades the link to the project's Site URL.
    expect(authEmailRedirectOrigin("https://marketing-abc123.vercel.app")).toBe("https://arc-studio.ai");
  });

  it("normalizes a configured value with a trailing slash or path", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://arc-studio.ai/";
    expect(authEmailRedirectOrigin("http://localhost:3000")).toBe("https://arc-studio.ai");
  });

  it("falls back to the request origin when unset, so local dev is untouched", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(authEmailRedirectOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("falls back rather than throwing on a malformed configured value", () => {
    process.env.NEXT_PUBLIC_APP_URL = "arc-studio.ai";
    expect(authEmailRedirectOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  // What this cost in practice: unset on production, the fallback returns a
  // perfectly plausible origin and the email sends. Supabase then drops the
  // unlisted redirect for its own Site URL, so the confirmation link never
  // reaches the app — with nothing raised anywhere along the way. Two users
  // confirmed their addresses and neither ever hit /auth/callback.
  it("warns when it falls back, so the silent misconfiguration leaves a trace", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    authEmailRedirectOrigin("https://arc-studio.ai");

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0][0]).toContain("NEXT_PUBLIC_APP_URL");
  });

  it("warns once, not once per sign-up", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    authEmailRedirectOrigin("https://arc-studio.ai");
    authEmailRedirectOrigin("https://arc-studio.ai");
    authEmailRedirectOrigin("https://arc-studio.ai");

    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the origin is pinned", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://arc-studio.ai";

    authEmailRedirectOrigin("https://marketing-abc123.vercel.app");

    expect(console.warn).not.toHaveBeenCalled();
  });
});

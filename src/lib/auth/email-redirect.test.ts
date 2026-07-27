import { afterEach, describe, expect, it } from "vitest";

import { authEmailRedirectOrigin } from "./email-redirect";

const original = process.env.NEXT_PUBLIC_APP_URL;
afterEach(() => {
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
});

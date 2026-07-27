import { describe, expect, it, vi } from "vitest";

import { sendBrandedEmail } from "./index";

const theme = { appName: "Arc Studio", accentColor: "#c8a24a" };
const base = { to: "a@x.com", subject: "s", heading: "h", bodyBlocks: ["b"], theme };

/**
 * Production configures the from-address as RESEND_FROM_EMAIL while
 * .env.example documents RESEND_FROM. This helper fails closed, so a name
 * mismatch silently sent nothing — worth pinning both names down.
 */
describe("sendBrandedEmail from-address resolution", () => {
  it("uses RESEND_FROM when set", async () => {
    vi.stubEnv("RESEND_API_KEY", "k");
    vi.stubEnv("RESEND_FROM", "a@from.com");
    vi.stubEnv("RESEND_FROM_EMAIL", "");
    let seen = "";
    const res = await sendBrandedEmail(base, {
      send: async (_key, payload) => { seen = payload.from; return { id: "1" }; },
    });
    expect(res.ok).toBe(true);
    expect(seen).toBe("a@from.com");
  });

  it("falls back to RESEND_FROM_EMAIL — the name production actually uses", async () => {
    vi.stubEnv("RESEND_API_KEY", "k");
    vi.stubEnv("RESEND_FROM", "");
    vi.stubEnv("RESEND_FROM_EMAIL", "b@prod.com");
    let seen = "";
    const res = await sendBrandedEmail(base, {
      send: async (_key, payload) => { seen = payload.from; return { id: "1" }; },
    });
    expect(res.ok).toBe(true);
    expect(seen).toBe("b@prod.com");
  });

  it("still fails closed when neither is set", async () => {
    vi.stubEnv("RESEND_API_KEY", "k");
    vi.stubEnv("RESEND_FROM", "");
    vi.stubEnv("RESEND_FROM_EMAIL", "");
    const res = await sendBrandedEmail(base);
    expect(res.ok).toBe(false);
  });
});

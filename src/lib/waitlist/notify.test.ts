import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>>, result: { ok: true } as { ok: boolean; error?: string }, throws: false }));

vi.mock("@/lib/email", () => ({
  sendBrandedEmail: async (input: Record<string, unknown>) => {
    if (sent.throws) throw new Error("transport exploded");
    sent.calls.push(input);
    return sent.result;
  },
}));

import { notifyWaitlistSignup } from "./notify";

describe("notifyWaitlistSignup", () => {
  beforeEach(() => {
    sent.calls = [];
    sent.result = { ok: true };
    sent.throws = false;
  });

  it("does nothing when no platform admins are configured", async () => {
    vi.stubEnv("ARC_PLATFORM_ADMIN_EMAILS", "");
    const res = await notifyWaitlistSignup({ email: "new@example.com", source: "landing-hero" });
    expect(res).toEqual({ ok: false, reason: "no_recipients" });
    expect(sent.calls).toHaveLength(0);
  });

  it("emails every configured admin with the signup and its source", async () => {
    vi.stubEnv("ARC_PLATFORM_ADMIN_EMAILS", "a@x.com, B@Y.com");
    const res = await notifyWaitlistSignup({ email: "new@example.com", source: "landing-cta", total: 42 });
    expect(res).toEqual({ ok: true, notified: ["a@x.com", "b@y.com"] });
    expect(sent.calls).toHaveLength(1);
    const call = sent.calls[0];
    expect(call.to).toEqual(["a@x.com", "b@y.com"]);
    expect(String(call.subject)).toContain("new@example.com");
    const body = (call.bodyBlocks as string[]).join(" ");
    expect(body).toContain("new@example.com");
    expect(body).toContain("landing-cta");
    expect(body).toContain("42");
  });

  it("omits the running total when it isn't known", async () => {
    vi.stubEnv("ARC_PLATFORM_ADMIN_EMAILS", "a@x.com");
    await notifyWaitlistSignup({ email: "n@e.com", source: "landing-hero" });
    expect((sent.calls[0].bodyBlocks as string[]).join(" ")).not.toMatch(/signups so far/);
  });

  it("reports a send failure without throwing", async () => {
    vi.stubEnv("ARC_PLATFORM_ADMIN_EMAILS", "a@x.com");
    sent.result = { ok: false, error: "resend down" };
    const res = await notifyWaitlistSignup({ email: "n@e.com", source: "landing-hero" });
    expect(res).toEqual({ ok: false, reason: "send_failed", error: "resend down" });
  });

  it("swallows a thrown transport error — a signup must never fail on notification", async () => {
    vi.stubEnv("ARC_PLATFORM_ADMIN_EMAILS", "a@x.com");
    sent.throws = true;
    const res = await notifyWaitlistSignup({ email: "n@e.com", source: "landing-hero" });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ reason: "send_failed" });
  });
});

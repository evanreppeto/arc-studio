import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  persist: { ok: true, status: "created" } as { ok: boolean; status?: string; error?: string },
  notifyCalls: [] as Array<{ email: string; source: string }>,
  notifyThrows: false,
}));

vi.mock("@/lib/waitlist/persistence", () => ({
  isSupabaseAdminConfigured: () => true,
  persistWaitlistSignup: async () => state.persist,
}));

vi.mock("@/lib/waitlist/notify", () => ({
  notifyWaitlistSignup: async (p: { email: string; source: string }) => {
    if (state.notifyThrows) throw new Error("mail exploded");
    state.notifyCalls.push(p);
    return { ok: true, notified: ["a@x.com"] };
  },
}));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));

describe("POST /api/waitlist — signup notifications", () => {
  beforeEach(() => {
    state.persist = { ok: true, status: "created" };
    state.notifyCalls = [];
    state.notifyThrows = false;
  });

  it("notifies on a genuinely new signup", async () => {
    const res = await post({ email: "New@Example.com", source: "landing-hero" });
    expect(res.status).toBe(201);
    expect(state.notifyCalls).toEqual([{ email: "new@example.com", source: "landing-hero" }]);
  });

  it("does NOT notify when the email is already on the list", async () => {
    state.persist = { ok: true, status: "exists" };
    const res = await post({ email: "dupe@example.com" });
    expect(res.status).toBe(200);
    expect(state.notifyCalls).toHaveLength(0);
  });

  it("still succeeds when the notification throws — the row is already saved", async () => {
    state.notifyThrows = true;
    const res = await post({ email: "new@example.com" });
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ status: "created" });
  });

  it("never notifies for an invalid email", async () => {
    const res = await post({ email: "nope" });
    expect(res.status).toBe(400);
    expect(state.notifyCalls).toHaveLength(0);
  });
});

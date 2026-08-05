import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { checkEmailSuppression, listEmailSuppressions, loadSuppressedAddresses, recordEmailSuppression } from "./persistence";

const CLEAN = {
  email_suppressions: { data: null, error: null },
  contacts: { data: { email_unsubscribed_at: null, status: "active" }, error: null },
};

describe("checkEmailSuppression", () => {
  it("passes a recipient who is on neither key", async () => {
    const client = createSupabaseQueryMock(CLEAN as never);
    await expect(
      checkEmailSuppression({ orgId: "org-1", contactId: "ct-1", address: "sam@example.com" }, client),
    ).resolves.toEqual({ suppressed: false });
  });

  it("refuses an address in the register even when the contact row looks clean", async () => {
    // The re-import case: a fresh contact row has a NULL opt-out timestamp, so
    // the contact-keyed check alone would let this through.
    const client = createSupabaseQueryMock({
      ...CLEAN,
      email_suppressions: { data: { reason: "complaint" }, error: null },
    } as never);
    const result = await checkEmailSuppression({ orgId: "org-1", contactId: "ct-new", address: "sam@example.com" }, client);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toMatch(/spam/i);
  });

  it("normalizes the address before looking it up", async () => {
    const client = createSupabaseQueryMock(CLEAN as never);
    await checkEmailSuppression({ orgId: "org-1", contactId: "ct-1", address: "  Sam@Example.COM " }, client);
    const eqCalls = client.calls.filter(([method]) => method === "eq");
    expect(eqCalls.some(([, column, value]) => column === "email" && value === "sam@example.com")).toBe(true);
  });

  it("refuses a contact who unsubscribed, keyed by id when no address is known", async () => {
    const client = createSupabaseQueryMock({
      email_suppressions: { data: null, error: null },
      contacts: { data: { email_unsubscribed_at: "2026-08-01T00:00:00.000Z", status: "active" }, error: null },
    } as never);
    const result = await checkEmailSuppression({ orgId: "org-1", contactId: "ct-1", address: null }, client);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toMatch(/unsubscrib/i);
  });

  it("refuses a do_not_contact contact at SEND time, not only at list-build", async () => {
    // The window this closes: marking someone do-not-contact after their
    // dispatch was already queued used to let the mail go out anyway.
    const client = createSupabaseQueryMock({
      email_suppressions: { data: null, error: null },
      contacts: { data: { email_unsubscribed_at: null, status: "do_not_contact" }, error: null },
    } as never);
    const result = await checkEmailSuppression({ orgId: "org-1", contactId: "ct-1", address: "sam@example.com" }, client);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toMatch(/do-not-contact/i);
  });

  it("org-scopes the contact lookup", async () => {
    const client = createSupabaseQueryMock(CLEAN as never);
    await checkEmailSuppression({ orgId: "org-1", contactId: "ct-1", address: "sam@example.com" }, client);
    const eqCalls = client.calls.filter(([method]) => method === "eq");
    expect(eqCalls.some(([, column, value]) => column === "org_id" && value === "org-1")).toBe(true);
  });

  it("FAILS CLOSED when the register read errors", async () => {
    // Load-bearing: emailing someone who opted out is worse than holding a send
    // a retry will deliver. Do not relax this into a permissive default.
    const client = createSupabaseQueryMock({
      email_suppressions: { data: null, error: { message: "boom" } },
    } as never);
    const result = await checkEmailSuppression({ orgId: "org-1", contactId: "ct-1", address: "sam@example.com" }, client);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toMatch(/held/i);
  });

  it("FAILS CLOSED when the contact read errors", async () => {
    const client = createSupabaseQueryMock({
      email_suppressions: { data: null, error: null },
      contacts: { data: null, error: { message: "boom" } },
    } as never);
    const result = await checkEmailSuppression({ orgId: "org-1", contactId: "ct-1", address: "sam@example.com" }, client);
    expect(result.suppressed).toBe(true);
  });
});

describe("loadSuppressedAddresses", () => {
  it("returns a normalized set", async () => {
    const client = createSupabaseQueryMock({
      email_suppressions: { data: [{ email: "A@Example.com" }, { email: "b@example.com" }], error: null },
    } as never);
    const set = await loadSuppressedAddresses("org-1", client);
    expect(set.has("a@example.com")).toBe(true);
    expect(set.has("b@example.com")).toBe(true);
  });

  it("THROWS rather than returning an empty set on a read failure", async () => {
    // An empty set reads as "nobody is suppressed" and would queue every
    // opted-out address (BSR-575).
    const client = createSupabaseQueryMock({
      email_suppressions: { data: null, error: { message: "boom" } },
    } as never);
    await expect(loadSuppressedAddresses("org-1", client)).rejects.toThrow(/boom/);
  });
});

describe("recordEmailSuppression", () => {
  it("writes the register and mirrors onto the contact", async () => {
    const client = createSupabaseQueryMock({
      email_suppressions: { data: null, error: null },
      contacts: { data: null, error: null },
    } as never);
    const result = await recordEmailSuppression(
      { orgId: "org-1", address: " Sam@Example.com ", reason: "complaint", source: "resend", contactId: "ct-1" },
      client,
    );
    expect(result).toEqual({ ok: true, recorded: true });

    const upsert = client.calls.find(([method]) => method === "upsert");
    expect(upsert?.[1]).toMatchObject({ org_id: "org-1", email: "sam@example.com", reason: "complaint", source: "resend" });
    // Idempotent: a redelivered webhook or a double one-click must not move the
    // original timestamp.
    expect(upsert?.[2]).toMatchObject({ onConflict: "org_id,email", ignoreDuplicates: true });
    expect(client.calls.some(([method]) => method === "update")).toBe(true);
  });

  it("still suppresses the contact when no address is known", async () => {
    const client = createSupabaseQueryMock({ contacts: { data: null, error: null } } as never);
    const result = await recordEmailSuppression(
      { orgId: "org-1", address: null, reason: "bounce", source: "resend", contactId: "ct-1" },
      client,
    );
    expect(result).toEqual({ ok: true, recorded: true });
    expect(client.calls.some(([method]) => method === "upsert")).toBe(false);
    expect(client.calls.some(([method]) => method === "update")).toBe(true);
  });

  it("is a no-op with neither an address nor a contact", async () => {
    const client = createSupabaseQueryMock({} as never);
    await expect(
      recordEmailSuppression({ orgId: "org-1", address: null, reason: "manual", source: "Evan" }, client),
    ).resolves.toEqual({ ok: true, recorded: false });
    expect(client.calls.length).toBe(0);
  });
});

describe("listEmailSuppressions", () => {
  it("throws rather than reporting an empty register on a read failure", async () => {
    const client = createSupabaseQueryMock({
      email_suppressions: { data: null, error: { message: "boom" } },
    } as never);
    await expect(listEmailSuppressions({ orgId: "org-1" }, client)).rejects.toThrow(/boom/);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { executeResendDispatch } from "./execute-resend";

function findCalls(supabase: { calls: Array<[string, ...unknown[]]> }, method: string) {
  return supabase.calls.filter(([m]) => m === method).map(([, arg]) => arg as Record<string, unknown>);
}

const APPROVED = { status: "approved" };
// An asset an operator actually approved (approved_at is written only by
// campaigns/decisions.ts) and then deployed (dispatch_locked cleared by launch).
const DEPLOYED_ASSET = { status: "approved", dispatch_locked: false, approved_at: "2026-07-01T00:00:00.000Z" };
const ENABLED_RESEND = { enabled: true, env_var: "RESEND_API_KEY", config: { fromEmail: "Arc <mark@bsg.com>" } };

// What a compliant send needs beyond approval: a contact who hasn't opted out,
// and a workspace sender identity with the postal address CAN-SPAM requires.
// Without these the executor now refuses — see the dedicated gate tests below.
const COMPLIANCE_ROWS = {
  contacts: { data: { email_unsubscribed_at: null }, error: null },
  app_settings: {
    data: [
      { key: "email_sender_name", value: "Big Shoulders Restoration" },
      { key: "email_postal_address", value: "123 W Example St, Chicago IL 60601" },
    ],
    error: null,
  },
  business_profiles: {
    data: { logo_url: null, accent: "#C8A24B", display_name: "Big Shoulders Restoration" },
    error: null,
  },
};

function queuedDispatch(overrides: Record<string, unknown> = {}) {
  return {
    id: "d1",
    org_id: "org-1",
    status: "queued",
    approval_item_id: "appr-1",
    channel: "email",
    campaign_id: "c1",
    campaign_asset_id: "a1",
    contact_id: "ct-1",
    provider_message_id: null,
    payload: { to: "lead@example.com", subject: "Roof inspection", html: "<p>Hello</p>" },
    ...overrides,
  };
}

// Live sending is armed for the whole suite; the gate itself is covered by its
// own test below.
beforeEach(() => {
  vi.stubEnv("ARC_SEND_ENABLED", "1");
  // Unsubscribe links are HMAC-signed; without a secret the executor refuses.
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", "test-unsubscribe-secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("executeResendDispatch", () => {
  it("refuses when live sending is not armed (ARC_SEND_ENABLED unset)", async () => {
    vi.stubEnv("ARC_SEND_ENABLED", "");
    const send = vi.fn();
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: ENABLED_RESEND, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, { apiKey: "re_test", send });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/ARC_SEND_ENABLED|turned off|armed/i);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends an approved queued dispatch, stamps the provider message id, and logs dispatch_sent", async () => {
    const send = vi.fn().mockResolvedValue({ id: "resend-123" });
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: ENABLED_RESEND, error: null },
      campaign_events: { data: null, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, {
      apiKey: "re_test",
      send,
    });

    expect(result).toMatchObject({ ok: true, providerMessageId: "resend-123" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("re_test", expect.objectContaining({ to: ["lead@example.com"], subject: "Roof inspection" }));

    const updates = findCalls(supabase, "update");
    expect(updates).toContainEqual(
      expect.objectContaining({ status: "sent", provider: "resend", provider_message_id: "resend-123" }),
    );
    expect(updates.some((u) => "dispatched_at" in u)).toBe(true);
    expect(findCalls(supabase, "insert")).toContainEqual(expect.objectContaining({ event_type: "dispatch_sent" }));
  });

  it("tags first-party links in the body and records an outbound attribution touch", async () => {
    const CAMPAIGN_UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const ASSET_UUID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const CONTACT_UUID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const send = vi.fn().mockResolvedValue({ id: "resend-999" });
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: {
        data: queuedDispatch({
          campaign_id: CAMPAIGN_UUID,
          campaign_asset_id: ASSET_UUID,
          contact_id: CONTACT_UUID,
          payload: { to: "lead@example.com", subject: "Storm prep", html: '<a href="https://bigshoulders.com/book">Book now</a>' },
        }),
        error: null,
      },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: ENABLED_RESEND, error: null },
      campaign_events: { data: null, error: null },
      engagement_events: { data: null, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, { apiKey: "re_test", send });
    expect(result.ok).toBe(true);

    // The body's first-party CTA now carries this campaign's attribution.
    const sentPayload = send.mock.calls[0][1] as { html?: string };
    expect(sentPayload.html).toMatch(/bsg_at=/);
    expect(sentPayload.html).toContain(`utm_campaign=${CAMPAIGN_UUID}`);

    // A durable outbound touch is recorded for last-touch attribution + traffic.
    const touch = findCalls(supabase, "insert").find((row) => row.event_type === "outbound_send");
    expect(touch).toMatchObject({
      event_type: "outbound_send",
      direction: "outbound",
      channel: "email",
      campaign_id: CAMPAIGN_UUID,
      campaign_asset_id: ASSET_UUID,
      contact_id: CONTACT_UUID,
      org_id: "org-1",
    });
  });

  it("sends a scheduled dispatch when the operator forces it (send now)", async () => {
    const send = vi.fn().mockResolvedValue({ id: "resend-sched" });
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch({ status: "scheduled" }), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: ENABLED_RESEND, error: null },
      campaign_events: { data: null, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, {
      apiKey: "re_test",
      send,
    });

    expect(result).toMatchObject({ ok: true, providerMessageId: "resend-sched" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(findCalls(supabase, "update")).toContainEqual(expect.objectContaining({ status: "sent" }));
  });

  it("is idempotent — returns the existing id and never re-sends an already-dispatched row", async () => {
    const send = vi.fn();
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch({ status: "sent", provider_message_id: "resend-prior" }), error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, { apiKey: "re_test", send });

    expect(result).toMatchObject({ ok: true, providerMessageId: "resend-prior" });
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a dispatch that is not queued", async () => {
    const send = vi.fn();
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch({ status: "canceled" }), error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, { apiKey: "re_test", send });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/canceled|queued/i);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses when the dispatch has no linked approval", async () => {
    const send = vi.fn();
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch({ approval_item_id: null }), error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, { apiKey: "re_test", send });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/approval/i);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses when the linked approval is not approved", async () => {
    const send = vi.fn();
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: { status: "pending" }, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, { apiKey: "re_test", send });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/approv/i);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses when no workspace key is stored and RESEND_API_KEY is absent", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const send = vi.fn();
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: ENABLED_RESEND, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, { send });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/RESEND_API_KEY|configured/i);
    expect(send).not.toHaveBeenCalled();
  });

  it("prefers the workspace's stored Resend key over the deployment env var", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_env_deployment");
    const send = vi.fn().mockResolvedValue({ id: "resend-ws" });
    const readCredential = vi.fn().mockResolvedValue("re_workspace_stored");
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: { ...ENABLED_RESEND, credential_ref: "vault-ref-1" }, error: null },
      campaign_events: { data: null, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, { send, readCredential });

    expect(result).toMatchObject({ ok: true, providerMessageId: "resend-ws" });
    expect(readCredential).toHaveBeenCalledWith("vault-ref-1");
    expect(send).toHaveBeenCalledWith("re_workspace_stored", expect.anything());
  });

  it("falls back to RESEND_API_KEY when the workspace has no stored key", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_env_deployment");
    const send = vi.fn().mockResolvedValue({ id: "resend-env" });
    const readCredential = vi.fn();
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: ENABLED_RESEND, error: null }, // no credential_ref
      campaign_events: { data: null, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, { send, readCredential });

    expect(result).toMatchObject({ ok: true, providerMessageId: "resend-env" });
    expect(readCredential).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith("re_env_deployment", expect.anything());
  });

  it("refuses when the Resend connection is disabled (kill-switch off)", async () => {
    const send = vi.fn();
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: { ...ENABLED_RESEND, enabled: false }, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, { apiKey: "re_test", send });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/disabled/i);
    expect(send).not.toHaveBeenCalled();
  });

  /**
   * BSR-757. `!connection?.enabled` covered "no row" and "row disabled" alike,
   * so a workspace that had never connected Resend was told it was "connected
   * but disabled" — false, and it points at a toggle that does not exist for
   * them. This is the first error a workspace hits on its first send.
   */
  it("says Resend is NOT CONNECTED when the workspace has no connection row", async () => {
    const send = vi.fn();
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      // maybeSingle() with no matching row.
      connections: { data: null, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, { apiKey: "re_test", send });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/isn't connected/i);
    // The remedy has to be "connect", not "enable" — the toggle isn't there yet.
    expect(result.message).not.toMatch(/connected but disabled/i);
    expect(send).not.toHaveBeenCalled();
  });

  it("records a failure (status=failed, last_error) and logs dispatch_failed when Resend throws", async () => {
    const send = vi.fn().mockRejectedValue(new Error("Resend send failed (422): invalid from"));
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: ENABLED_RESEND, error: null },
      campaign_events: { data: null, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, { apiKey: "re_test", send });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/422|invalid from/i);
    const updates = findCalls(supabase, "update");
    expect(updates).toContainEqual(expect.objectContaining({ status: "failed" }));
    expect(updates.some((u) => "last_error" in u)).toBe(true);
    expect(findCalls(supabase, "insert")).toContainEqual(expect.objectContaining({ event_type: "dispatch_failed" }));
  });

  // The engagement_events row is the only fuel the journey/attribution layer gets
  // from an outbound send, so it's worth asserting the shape — and, more
  // importantly, that a lost write is audible rather than silent.
  it("records the send as an outbound attribution touch in engagement_events", async () => {
    const send = vi.fn().mockResolvedValue({ id: "resend-123" });
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch({ contact_id: "ct-1", campaign_asset_id: "as-1" }), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: ENABLED_RESEND, error: null },
      campaign_events: { data: null, error: null },
      engagement_events: { data: null, error: null },
    });

    await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, { apiKey: "re_test", send });

    expect(findCalls(supabase, "insert")).toContainEqual(
      expect.objectContaining({
        event_type: "outbound_send",
        direction: "outbound",
        channel: "email",
        external_event_id: "resend-123",
        campaign_id: "c1",
        contact_id: "ct-1",
      }),
    );
  });

  it("warns (but still reports success) when the engagement_events touch can't be written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn().mockResolvedValue({ id: "resend-123" });
    // postgrest resolves with `{ error }` rather than rejecting — the shape a real
    // constraint violation takes, and the one the old bare `catch` never saw.
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: ENABLED_RESEND, error: null },
      campaign_events: { data: null, error: null },
      engagement_events: { data: null, error: { message: 'violates check constraint "engagement_events_subject_check"' } },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, { apiKey: "re_test", send });

    // The mail is already gone; a lost touch must never retroactively fail the send.
    expect(result).toMatchObject({ ok: true, providerMessageId: "resend-123" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("engagement_events insert failed"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("engagement_events_subject_check"));
    warn.mockRestore();
  });

  // The three below are the gap this file previously had no opinion on: the send
  // path decided "approved" from approval_items.status alone and never looked at the
  // asset. The first reproduces prod exactly.
  it("refuses a seeded approval whose asset no operator ever approved", async () => {
    // Prod's actual shape (3 rows like this): the approval row says approved, while
    // the asset is still pending_approval, dispatch_locked, approved_at NULL. Nobody
    // decided anything. Asserting `approved_at: null` is the whole point — with the
    // old code this sent.
    const send = vi.fn().mockResolvedValue({ id: "resend-should-not-happen" });
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: { status: "pending_approval", dispatch_locked: true, approved_at: null }, error: null },
      connections: { data: ENABLED_RESEND, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, { apiKey: "re_test", send });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/never approved by a human|no operator approval/i);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses an approved asset that has not been deployed (still dispatch_locked)", async () => {
    const send = vi.fn().mockResolvedValue({ id: "resend-should-not-happen" });
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: { status: "approved", dispatch_locked: true, approved_at: "2026-07-01T00:00:00.000Z" }, error: null },
      connections: { data: ENABLED_RESEND, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, { apiKey: "re_test", send });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/locked for dispatch|deploy it/i);
    expect(send).not.toHaveBeenCalled();
  });

  // ————— Compliance gates —————
  //
  // `contacts.email_unsubscribed_at` existed since 2026-07-10 but nothing read
  // it, so an unsubscribed contact still received mail. These lock that shut.

  it("refuses to send to a contact who unsubscribed", async () => {
    const send = vi.fn();
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      contacts: { data: { email_unsubscribed_at: "2026-07-01T00:00:00.000Z" }, error: null },
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: ENABLED_RESEND, error: null },
      campaign_events: { data: null, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, {
      apiKey: "re_test",
      send,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/unsubscribed/i);
    expect(send).not.toHaveBeenCalled();
  });

  // Fail CLOSED: if we can't confirm consent, holding the send is the safer
  // error than mailing someone who may have opted out.
  it("holds the send when the consent lookup fails", async () => {
    const send = vi.fn();
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      contacts: { data: null, error: { message: "boom" } },
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: ENABLED_RESEND, error: null },
      campaign_events: { data: null, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, {
      apiKey: "re_test",
      send,
    });

    expect(result.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  // Commercial email without a postal address is unlawful in the US, so this
  // refuses rather than warning.
  it("refuses when the workspace has no postal address configured", async () => {
    const send = vi.fn();
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      app_settings: { data: [{ key: "email_sender_name", value: "BSR" }], error: null },
      business_profiles: { data: { logo_url: null, accent: null, display_name: "BSR" }, error: null },
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: ENABLED_RESEND, error: null },
      campaign_events: { data: null, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, {
      apiKey: "re_test",
      send,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/postal address/i);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses when there is no contact, since no unsubscribe link can be built", async () => {
    const send = vi.fn();
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch({ contact_id: null }), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: ENABLED_RESEND, error: null },
      campaign_events: { data: null, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, {
      apiKey: "re_test",
      send,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/unsubscribe/i);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the wrapped body with the address, an unsubscribe link, and List-Unsubscribe headers", async () => {
    const send = vi.fn().mockResolvedValue({ id: "resend-999" });
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: ENABLED_RESEND, error: null },
      campaign_events: { data: null, error: null },
    });

    await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, {
      apiKey: "re_test",
      send,
    });

    const payload = send.mock.calls[0][1] as { html: string; headers: Record<string, string> };
    expect(payload.html).toContain("123 W Example St");
    expect(payload.html).toContain("/api/unsubscribe");
    // Without List-Unsubscribe-Post, Gmail won't offer one-click and scanners
    // may GET the link, unsubscribing people who never asked.
    expect(payload.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(payload.headers["List-Unsubscribe"]).toMatch(/^<https?:\/\/.+\/api\/unsubscribe\?.+>$/);
  });

  it("refuses a dispatch with no asset to verify, rather than trusting the approval row", async () => {
    const send = vi.fn().mockResolvedValue({ id: "resend-should-not-happen" });
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch({ campaign_asset_id: null }), error: null },
      approval_items: { data: APPROVED, error: null },
      connections: { data: ENABLED_RESEND, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, { apiKey: "re_test", send });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/isn't linked to a campaign asset/i);
    expect(send).not.toHaveBeenCalled();
  });

  it("scopes the asset lookup to the dispatch's org", async () => {
    // The admin client bypasses RLS, so an unscoped .eq("id", …) would happily read
    // another tenant's asset and take its approval as this dispatch's.
    //
    // Asserting a bare ["eq","org_id","org-1"] anywhere would pass without the asset
    // lookup existing at all — the connections read scopes by org too. So look for it
    // specifically between `from("campaign_assets")` and the next `from`.
    const send = vi.fn().mockResolvedValue({ id: "resend-1" });
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: ENABLED_RESEND, error: null },
    });

    await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, { apiKey: "re_test", send });

    const from = supabase.calls.findIndex(([m, t]) => m === "from" && t === "campaign_assets");
    expect(from).toBeGreaterThan(-1);
    const next = supabase.calls.findIndex(([m], i) => m === "from" && i > from);
    const scopedTo = supabase.calls.slice(from, next === -1 ? undefined : next);
    expect(scopedTo).toContainEqual(["eq", "org_id", "org-1"]);
    expect(scopedTo).toContainEqual(["eq", "id", "a1"]);
  });
});

// BSR-501 degrade order. The rule: hitting the AI allowance must never destroy or
// block already-approved outbound. Delivering an approved email costs no model
// spend, so an over-cap workspace still sends; only a lapsed TRIAL pauses
// outbound, and even then the queued row is left untouched for later.
describe("degrade order under billing pressure", () => {
  const OVER_CAP_USAGE = [{ cost_estimate_cents: 9_999_999 }];

  it("still sends an approved dispatch when the org is over its AI allowance", async () => {
    vi.stubEnv("ARC_BILLING_ENFORCEMENT", "1");
    const send = vi.fn().mockResolvedValue({ id: "resend-over-cap" });
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: ENABLED_RESEND, error: null },
      campaign_events: { data: null, error: null },
      org_plans: { data: { plan_tier: "starter", monthly_cap_cents: null }, error: null },
      ai_usage_events: { data: OVER_CAP_USAGE, error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, {
      apiKey: "re_test",
      send,
    });

    expect(result.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("pauses outbound for a lapsed trial without discarding the queued dispatch", async () => {
    vi.stubEnv("ARC_BILLING_ENFORCEMENT", "1");
    const send = vi.fn();
    const supabase = createSupabaseQueryMock({
      ...COMPLIANCE_ROWS,
      campaign_dispatches: { data: queuedDispatch(), error: null },
      approval_items: { data: APPROVED, error: null },
      campaign_assets: { data: DEPLOYED_ASSET, error: null },
      connections: { data: ENABLED_RESEND, error: null },
      campaign_events: { data: null, error: null },
      org_plans: {
        data: {
          plan_tier: "free",
          monthly_cap_cents: null,
          trial_ends_at: new Date(Date.now() - 86_400_000).toISOString(),
        },
        error: null,
      },
      ai_usage_events: { data: [], error: null },
    });

    const result = await executeResendDispatch({ dispatchId: "d1", operator: "Operator" }, supabase, {
      apiKey: "re_test",
      send,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/trial has ended/i);
    expect(send).not.toHaveBeenCalled();

    // Nothing was cancelled or failed — the row stays queued and goes out
    // untouched once a plan is added.
    const statuses = findCalls(supabase, "update").map((u) => u.status);
    expect(statuses).not.toContain("failed");
    expect(statuses).not.toContain("cancelled");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { buildExternalSendPackage, recordExternalSend } from "./external-send";

const CAMPAIGN_ID = "10000000-0000-4000-8000-000000000021";
const ASSET_ID = "20000000-0000-4000-8000-000000000042";
const TENANT = { org_id: "org-1", workspace_id: "ws-1" } as never;

function approvedAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSET_ID,
    campaign_id: CAMPAIGN_ID,
    org_id: "org-1",
    channel: "email",
    title: "Spring gutter check",
    status: "approved",
    approved_at: "2026-07-23T12:00:00.000Z",
    approved_body: "Book your inspection: https://bigshoulders.example/book\n\nSee you soon.",
    edited_body: null,
    draft_body: null,
    ...overrides,
  };
}

const CONTACTS = [
  { id: "ct-1", persona: "persona_property_manager", status: "active", email: "pm@example.com", phone: null, full_name: "Pat Manager", company_id: null, email_unsubscribed_at: null },
  { id: "ct-2", persona: "persona_property_manager", status: "do_not_contact", email: "no@example.com", phone: null, full_name: "Do Not Contact", company_id: null, email_unsubscribed_at: null },
];

// The export is a marketing send like any other, so it now needs what one needs:
// a postal address and a signing secret for the unsubscribe links (BSR-482).
const SENDER_IDENTITY = {
  app_settings: {
    data: [
      { key: "email_sender_name", value: "Big Shoulders Restoration" },
      { key: "email_postal_address", value: "123 W Example St, Chicago IL 60601" },
    ],
    error: null,
  },
  business_profiles: { data: { logo_url: null, accent: "#C8A24B", display_name: "Big Shoulders Restoration" }, error: null },
};

function clientFor(
  asset: Record<string, unknown> | null,
  extra: Record<string, { data: unknown; error: unknown }> = {},
) {
  return createSupabaseQueryMock({
    ...SENDER_IDENTITY,
    campaign_assets: { data: asset, error: null },
    campaigns: { data: { persona: "persona_property_manager", contact_id: null, company_id: null }, error: null },
    contacts: { data: CONTACTS, error: null },
    email_suppressions: { data: [], error: null },
    engagement_events: { data: null, error: null },
    campaign_events: { data: null, error: null },
    ...extra,
  } as never);
}

beforeEach(() => vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", "test-unsubscribe-secret"));
afterEach(() => vi.unstubAllEnvs());

describe("buildExternalSendPackage", () => {
  it("exports the approved body with campaign attribution stamped into links", async () => {
    const result = await buildExternalSendPackage({ campaignId: CAMPAIGN_ID, assetId: ASSET_ID, tenant: TENANT }, clientFor(approvedAsset()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pkg.subject).toBe("Spring gutter check");
    // The same stamping the native send applies: utm + the bsg_at token
    // resolveAttribution reads back on click-through.
    expect(result.pkg.text).toContain("bsg_at=");
    expect(result.pkg.html).toContain("utm_campaign");
    // Audience: active contact in, do_not_contact suppressed.
    expect(result.pkg.recipients).toHaveLength(1);
    expect(result.pkg.suppressedCount).toBe(1);
    const csv = result.pkg.audienceCsv.split("\n");
    expect(csv[0]).toBe("email,name,persona,unsubscribe_url");
    // Each row carries its OWN unsubscribe link — one static body can't hold N
    // per-contact links, so the ESP merges this column into the token.
    expect(csv[1]).toContain("pm@example.com,Pat Manager,persona_property_manager,");
    expect(csv[1]).toContain("/api/unsubscribe?c=ct-1");
  });

  it("carries the postal address and an unsubscribe token in the exported body", async () => {
    const result = await buildExternalSendPackage({ campaignId: CAMPAIGN_ID, assetId: ASSET_ID, tenant: TENANT }, clientFor(approvedAsset()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The leak this closes: the export used to ship a bare body with no address,
    // no unsubscribe and no footer, into the one send path our gate can't reach.
    expect(result.pkg.html).toContain("123 W Example St, Chicago IL 60601");
    expect(result.pkg.text).toContain("123 W Example St, Chicago IL 60601");
    expect(result.pkg.html).toContain(result.pkg.unsubscribeMergeToken);
    expect(result.pkg.text).toContain(result.pkg.unsubscribeMergeToken);
  });

  it("leaves suppressed addresses out of the export entirely", async () => {
    // Suppressed by ADDRESS, not by contact flag — the case a re-import creates,
    // and the one the old contact-keyed check could never catch.
    const client = clientFor(approvedAsset(), {
      email_suppressions: { data: [{ email: "pm@example.com" }], error: null },
    });
    const result = await buildExternalSendPackage({ campaignId: CAMPAIGN_ID, assetId: ASSET_ID, tenant: TENANT }, client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pkg.recipients).toHaveLength(0);
    expect(result.pkg.unsubscribedCount).toBe(1);
    expect(result.pkg.audienceCsv).not.toContain("pm@example.com");
  });

  it("refuses to export at all without a postal address", async () => {
    const client = clientFor(approvedAsset(), { app_settings: { data: [], error: null } });
    const result = await buildExternalSendPackage({ campaignId: CAMPAIGN_ID, assetId: ASSET_ID, tenant: TENANT }, client);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("postal address") });
  });

  it("refuses a deliverable without a human approval signature", async () => {
    const result = await buildExternalSendPackage(
      { campaignId: CAMPAIGN_ID, assetId: ASSET_ID, tenant: TENANT },
      clientFor(approvedAsset({ approved_at: null })),
    );
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("approved") });
  });

  it("refuses when the asset isn't in this workspace", async () => {
    const result = await buildExternalSendPackage({ campaignId: CAMPAIGN_ID, assetId: ASSET_ID, tenant: TENANT }, clientFor(null));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("workspace") });
  });
});

describe("recordExternalSend", () => {
  it("writes one idempotent outbound touch per recipient and a campaign event", async () => {
    const client = clientFor(approvedAsset());
    const result = await recordExternalSend(
      { campaignId: CAMPAIGN_ID, assetId: ASSET_ID, operator: "Evan", tool: "Mailchimp", tenant: TENANT },
      client,
    );
    expect(result).toEqual({ ok: true, recipients: 1 });

    const upsert = client.calls.find(([method]) => method === "upsert");
    const rows = upsert?.[1] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_type: "outbound_send",
      direction: "outbound",
      source_system: "external",
      external_event_id: `ext-send:${ASSET_ID}:ct-1`,
      contact_id: "ct-1",
      campaign_id: CAMPAIGN_ID,
      campaign_asset_id: ASSET_ID,
    });
    expect(upsert?.[2]).toMatchObject({ onConflict: "source_system,external_event_id", ignoreDuplicates: true });

    const insert = client.calls.find(([method]) => method === "insert");
    expect(insert?.[1]).toMatchObject({ event_type: "exported", actor: "Evan" });
    expect((insert?.[1] as { detail: string }).detail).toContain("Mailchimp");
  });

  it("records touches only for the filtered audience, never for a suppressed address", async () => {
    const client = clientFor(approvedAsset(), {
      email_suppressions: { data: [{ email: "pm@example.com" }], error: null },
    });
    const result = await recordExternalSend(
      { campaignId: CAMPAIGN_ID, assetId: ASSET_ID, operator: "Evan", tenant: TENANT },
      client,
    );
    // Nothing left to record — and crucially no outbound touch invented for
    // someone the export never contained.
    expect(result.ok).toBe(false);
    expect(client.calls.some(([method]) => method === "upsert")).toBe(false);
  });

  it("refuses an unapproved deliverable — the human gate applies to external sends too", async () => {
    const client = clientFor(approvedAsset({ approved_at: null }));
    const result = await recordExternalSend(
      { campaignId: CAMPAIGN_ID, assetId: ASSET_ID, operator: "Evan", tenant: TENANT },
      client,
    );
    expect(result.ok).toBe(false);
    expect(client.calls.some(([method]) => method === "upsert")).toBe(false);
  });
});

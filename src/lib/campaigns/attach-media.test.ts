import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { attachMediaToCampaignAsset, listAttachableMedia } from "./attach-media";

function libraryAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: "lib-1",
    file_name: "crew-on-site.png",
    public_url: "https://cdn.example/library/crew-on-site.png",
    storage_path: "library/org-1/crew-on-site.png",
    kind: "image",
    source: "uploaded",
    provenance: {},
    risk_flags: [],
    ...overrides,
  };
}

function existingAsset(mediaAssets: unknown[] = []) {
  return {
    id: "asset-1",
    campaign_id: "camp-1",
    audit_payload: { media_assets: mediaAssets, outbound_locked: true },
  };
}

/** Pull the values passed to the recorded `.update(values)` call. */
function updatePayload(calls: Array<[string, ...unknown[]]>): Record<string, unknown> | null {
  const call = calls.find((c) => c[0] === "update");
  return call ? (call[1] as Record<string, unknown>) : null;
}

describe("attachMediaToCampaignAsset", () => {
  it("appends the library asset to the existing asset's media_assets with a provenance link", async () => {
    const client = createSupabaseQueryMock({
      media_assets: { data: libraryAsset(), error: null },
      campaign_assets: [
        { data: existingAsset([]), error: null },
        { data: null, error: null },
      ],
      campaign_events: { data: { id: "evt-1" }, error: null },
    });

    const result = await attachMediaToCampaignAsset(
      { assetId: "asset-1", libraryAssetId: "lib-1", operator: "Evan", tenant: { org_id: "org-1", workspace_id: "workspace-1" } },
      client,
    );

    expect(result).toMatchObject({ assetId: "asset-1", campaignId: "camp-1", attached: true });

    const payload = updatePayload(client.calls);
    const audit = payload?.audit_payload as { media_assets: Array<Record<string, unknown>>; outbound_locked: boolean };
    expect(audit.media_assets).toHaveLength(1);
    expect(audit.media_assets[0]).toMatchObject({
      url: "https://cdn.example/library/crew-on-site.png",
      library_asset_id: "lib-1",
    });
    // Attaching media must never unlock outbound.
    expect(audit.outbound_locked).toBe(true);
    expect(payload).not.toHaveProperty("dispatch_locked", false);
  });

  it("is idempotent — re-attaching the same library asset does not duplicate or update", async () => {
    const already = { url: "https://cdn.example/library/crew-on-site.png", library_asset_id: "lib-1" };
    const client = createSupabaseQueryMock({
      media_assets: { data: libraryAsset(), error: null },
      campaign_assets: { data: existingAsset([already]), error: null },
    });

    const result = await attachMediaToCampaignAsset(
      { assetId: "asset-1", libraryAssetId: "lib-1", operator: "Evan", tenant: { org_id: "org-1", workspace_id: "workspace-1" } },
      client,
    );

    expect(result).toMatchObject({ attached: false });
    expect(client.calls.filter((c) => c[0] === "update")).toHaveLength(0);
  });

  it("carries generation provenance so AI-generated library media renders as generated", async () => {
    const client = createSupabaseQueryMock({
      media_assets: {
        data: libraryAsset({ source: "ai_generated", provenance: { model: "higgsfield", job_id: "job-9" } }),
        error: null,
      },
      campaign_assets: [
        { data: existingAsset([]), error: null },
        { data: null, error: null },
      ],
      campaign_events: { data: { id: "evt-1" }, error: null },
    });

    await attachMediaToCampaignAsset(
      { assetId: "asset-1", libraryAssetId: "lib-1", operator: "Evan", tenant: { org_id: "org-1", workspace_id: "workspace-1" } },
      client,
    );

    const audit = updatePayload(client.calls)?.audit_payload as { media_assets: Array<Record<string, unknown>> };
    expect(audit.media_assets[0]).toMatchObject({ model: "higgsfield", job_id: "job-9" });
  });

  it("throws when the library asset is unknown / out of org", async () => {
    const client = createSupabaseQueryMock({
      media_assets: { data: null, error: null },
    });

    await expect(
      attachMediaToCampaignAsset({ assetId: "asset-1", libraryAssetId: "missing", operator: "Evan" }, client),
    ).rejects.toThrow(/media/i);
  });
});

describe("listAttachableMedia", () => {
  it("maps org media rows to compact picker items and scopes by org", async () => {
    const client = createSupabaseQueryMock({
      media_assets: {
        data: [
          { id: "m1", file_name: "a.png", public_url: "https://cdn/a.png", kind: "image", width: 1200, height: 800 },
          { id: "m2", file_name: "logo.svg", public_url: "https://cdn/logo.svg", kind: "logo", width: null, height: null },
        ],
        error: null,
      },
    });

    const items = await listAttachableMedia("org-1", client);

    expect(items).toEqual([
      { id: "m1", fileName: "a.png", url: "https://cdn/a.png", kind: "image", dimensions: "1200 × 800" },
      { id: "m2", fileName: "logo.svg", url: "https://cdn/logo.svg", kind: "logo", dimensions: null },
    ]);
    expect(client.calls).toContainEqual(["eq", "org_id", "org-1"]);
  });
});

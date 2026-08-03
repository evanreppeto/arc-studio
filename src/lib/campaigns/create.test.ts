import { describe, expect, it, vi } from "vitest";

import { parseCampaignDraft } from "@/domain";
import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { createOperatorCampaign } from "./create";

function insertsFor(supabase: { calls: Array<[string, ...unknown[]]> }, table: string) {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < supabase.calls.length; i++) {
    const [method, arg] = supabase.calls[i];
    if (method === "from" && arg === table && supabase.calls[i + 1]?.[0] === "insert") {
      out.push(supabase.calls[i + 1][1] as Record<string, unknown>);
    }
  }
  return out;
}

const draft = parseCampaignDraft({
  name: "Spring flood push",
  persona: "persona_homeowner_emergency",
  restorationFocus: "flood",
  channel: "social",
  audienceSummary: "North side homeowners",
});

describe("createOperatorCampaign", () => {
  it("creates a draft campaign, an approved asset+approval per photo, a decision, and a created event", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: { data: { id: "camp-1" }, error: null },
      campaign_assets: { data: { id: "asset-1" }, error: null },
      approval_items: { data: { id: "appr-1" }, error: null },
      approval_decisions: { data: null, error: null },
      campaign_events: { data: null, error: null },
    });
    const uploader = vi.fn(async (path: string) => `https://cdn.test/${path}`);

    const out = await createOperatorCampaign({
      draft,
      operator: "evan@test",
      photos: [{ filename: "a.png", contentType: "image/png", bytes: new Uint8Array([1, 2, 3]) }],
      client: supabase,
      uploader,
      tenant: { org_id: "org-1", workspace_id: "workspace-1" },
    });

    expect(out.campaignId).toBe("camp-1");
    expect(uploader).toHaveBeenCalledTimes(1);

    expect(insertsFor(supabase, "campaigns")[0]).toMatchObject({
      name: "Spring flood push",
      persona: "persona_homeowner_emergency",
      restoration_focus: "flood",
      status: "draft",
      source_system: "operator",
      launch_locked: true,
      owner: "evan@test",
      audience_summary: "North side homeowners",
      org_id: "org-1",
    });
    const asset = insertsFor(supabase, "campaign_assets")[0];
    expect(asset).toMatchObject({ campaign_id: "camp-1", asset_type: "social_ad", status: "approved", dispatch_locked: true, org_id: "org-1" });
    const media = (asset.audit_payload as { media_assets: { url: string; path: string }[] }).media_assets[0];
    expect(media.url).toBe("https://cdn.test/operator-campaigns/camp-1/0-a.png");
    expect(media.path).toBe("operator-campaigns/camp-1/0-a.png");
    expect(insertsFor(supabase, "approval_items")[0]).toMatchObject({ campaign_id: "camp-1", campaign_asset_id: "asset-1", status: "approved", item_type: "campaign_asset", org_id: "org-1" });
    expect(insertsFor(supabase, "approval_decisions")[0]).toMatchObject({ approval_item_id: "appr-1", decision: "approved", org_id: "org-1" });
    expect(insertsFor(supabase, "campaign_events")[0]).toMatchObject({ campaign_id: "camp-1", event_type: "created", actor: "evan@test", org_id: "org-1" });
  });

  it("iterates per photo — uploads, asset, and approval row for each", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: { data: { id: "camp-1" }, error: null },
      campaign_assets: { data: { id: "asset-1" }, error: null },
      approval_items: { data: { id: "appr-1" }, error: null },
      approval_decisions: { data: null, error: null },
      campaign_events: { data: null, error: null },
    });
    const uploader = vi.fn(async (path: string) => `https://cdn.test/${path}`);

    await createOperatorCampaign({
      draft,
      operator: "evan@test",
      photos: [
        { filename: "a.png", contentType: "image/png", bytes: new Uint8Array([1]) },
        { filename: "b.png", contentType: "image/png", bytes: new Uint8Array([2]) },
      ],
      client: supabase,
      uploader,
      tenant: { org_id: "org-1", workspace_id: "workspace-1" },
    });

    expect(uploader).toHaveBeenCalledTimes(2);
    expect(uploader.mock.calls[0][0]).toBe("operator-campaigns/camp-1/0-a.png");
    expect(uploader.mock.calls[1][0]).toBe("operator-campaigns/camp-1/1-b.png");
    expect(insertsFor(supabase, "campaign_assets")).toHaveLength(2);
    expect(insertsFor(supabase, "approval_items")).toHaveLength(2);
    expect(insertsFor(supabase, "approval_decisions")).toHaveLength(2);
    expect(insertsFor(supabase, "campaign_events")).toHaveLength(1);
  });

  it("creates a campaign with no assets when there are no photos", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: { data: { id: "camp-2" }, error: null },
      campaign_events: { data: null, error: null },
    });
    const uploader = vi.fn();
    const out = await createOperatorCampaign({
      draft,
      operator: "evan@test",
      photos: [],
      client: supabase,
      uploader,
      tenant: { org_id: "org-1", workspace_id: "workspace-1" },
    });
    expect(out.campaignId).toBe("camp-2");
    expect(uploader).not.toHaveBeenCalled();
    expect(insertsFor(supabase, "campaign_assets")).toHaveLength(0);
  });

  // BSR-639. campaigns.workspace_id used to be nullable and the write path
  // dropped it (orgTenantFields returns org_id only), so every campaign created
  // through this path landed unowned by any workspace and was then listed in all
  // of them. The column is NOT NULL now; these two tests are what keep it stamped.
  it("stamps the workspace on the campaign row, not just the org", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: { data: { id: "camp-3" }, error: null },
      campaign_events: { data: null, error: null },
    });

    await createOperatorCampaign({
      draft,
      operator: "evan@test",
      photos: [],
      client: supabase,
      uploader: vi.fn(),
      tenant: { org_id: "org-1", workspace_id: "workspace-1" },
    });

    expect(insertsFor(supabase, "campaigns")[0]).toMatchObject({
      org_id: "org-1",
      workspace_id: "workspace-1",
    });
  });

  it("refuses to create a campaign with no resolved workspace", async () => {
    const supabase = createSupabaseQueryMock({
      campaigns: { data: { id: "camp-4" }, error: null },
      campaign_events: { data: null, error: null },
    });

    await expect(
      createOperatorCampaign({ draft, operator: "evan@test", photos: [], client: supabase, uploader: vi.fn() }),
    ).rejects.toThrow(/without a resolved org and workspace/);

    // And it fails before writing, rather than leaving a half-created campaign.
    expect(insertsFor(supabase, "campaigns")).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";

import { type ArcBusinessContext, EMPTY_BRAND_PALETTE } from "@/domain";
import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { runArcPartnerCampaign } from "./orchestrator";

const TEST_CONTEXT: ArcBusinessContext = {
  businessName: "Big Shoulders Restoration",
  industry: "home_property_services",
  services: ["Water mitigation", "Documentation", "Rebuild coordination"],
  tone: "reassuring",
  voiceGuidance: null,
  preferredPhrases: [],
  bannedPhrases: ["insurance will cover", "claim will be approved", "we guarantee"],
  proofPoints: [],
  personas: [],
  guardrails: { disallowedClaims: [], complianceNotes: "Coverage-neutral language required." },
  brainFacts: [],
  palette: EMPTY_BRAND_PALETTE,
  logoUrl: null,
  tagline: null,
  description: null,
  websiteUrl: null,
  serviceAreas: [],
};

type InsertArg = {
  org_id?: string;
  workspace_id?: string;
  channel?: string;
  asset_type?: string;
  dispatch_locked?: boolean;
  audit_payload?: { media_assets?: Array<{ url: string }> };
};

describe("runArcPartnerCampaign creativeAssets", () => {
  it("persists each creative as a campaign_asset carrying media_assets, dispatch locked", async () => {
    const supabase = createSupabaseQueryMock({});

    await runArcPartnerCampaign(
      {
        creativeAssets: [
          { type: "image", url: "https://cdn.example/hero.png", title: "Hero" },
          { type: "video", url: "https://cdn.example/spot.mp4" },
        ],
      },
      supabase,
      TEST_CONTEXT,
      { org_id: "org-1", workspace_id: "workspace-1" },
    );

    const inserts = supabase.calls.filter(([method]) => method === "insert").map(([, arg]) => arg as InsertArg);
    const creativeInserts = inserts.filter((arg) => Array.isArray(arg.audit_payload?.media_assets));

    const mediaUrls = creativeInserts.flatMap((arg) => arg.audit_payload!.media_assets!.map((media) => media.url));
    expect(mediaUrls).toEqual(
      expect.arrayContaining(["https://cdn.example/hero.png", "https://cdn.example/spot.mp4"]),
    );

    const image = creativeInserts.find((arg) => arg.channel === "image");
    const video = creativeInserts.find((arg) => arg.channel === "video");
    expect(image?.asset_type).toBe("image_prompt");
    expect(video?.asset_type).toBe("video_prompt");

    // every creative is dispatch-locked, and nothing in the run unlocks outbound
    for (const arg of inserts) {
      expect(arg).not.toHaveProperty("dispatch_locked", false);
    }
    expect(image?.dispatch_locked).toBe(true);
  });

  it("stamps generated campaign, approval, output, and task rows with the Arc token tenant", async () => {
    const supabase = createSupabaseQueryMock({});

    await runArcPartnerCampaign(
      {},
      supabase,
      TEST_CONTEXT,
      { org_id: "org-1", workspace_id: "workspace-1" },
    );

    const inserts = supabase.calls.filter(([method]) => method === "insert").map(([, arg]) => arg as InsertArg);
    const tenantOwnedRows = inserts.filter((arg) => "org_id" in arg);

    expect(tenantOwnedRows.length).toBeGreaterThan(0);
    expect(tenantOwnedRows.every((arg) => arg.org_id === "org-1")).toBe(true);
    expect(tenantOwnedRows.some((arg) => arg.workspace_id === "workspace-1")).toBe(true);
  });
});

// BSR-720. `campaigns.workspace_id` became NOT NULL in BSR-639, but this
// orchestrator still wrote through `withOrg`, which stamps org_id only — so
// runArcPartnerCampaign could not create a campaign at all, and no test noticed
// because a mocked insert cannot see a not-null constraint.
//
// These assert the columns are present in the payload, which is the only thing a
// mock CAN prove and the exact thing that was missing.
describe("runArcPartnerCampaign stamps the workspace on workspace-owned tables", () => {
  async function insertsByTable() {
    const supabase = createSupabaseQueryMock({});
    await runArcPartnerCampaign({}, supabase, TEST_CONTEXT, { org_id: "org-1", workspace_id: "workspace-1" });

    const byTable = new Map<string, InsertArg[]>();
    let current = "";
    for (const [method, arg] of supabase.calls as Array<[string, unknown]>) {
      if (method === "from") current = String(arg);
      if (method === "insert") {
        if (!byTable.has(current)) byTable.set(current, []);
        byTable.get(current)!.push(arg as InsertArg);
      }
    }
    return byTable;
  }

  it("stamps workspace_id on campaigns — the write that was outright broken", async () => {
    const byTable = await insertsByTable();
    const campaigns = byTable.get("campaigns") ?? [];
    expect(campaigns.length).toBeGreaterThan(0);
    for (const row of campaigns) {
      expect(row).toMatchObject({ org_id: "org-1", workspace_id: "workspace-1" });
    }
  });

  it("stamps workspace_id on every other migrated table it writes", async () => {
    const byTable = await insertsByTable();
    for (const table of ["campaign_assets", "approval_items", "agent_outputs", "campaign_events"]) {
      for (const row of byTable.get(table) ?? []) {
        expect({ table, ...row }).toMatchObject({ org_id: "org-1", workspace_id: "workspace-1" });
      }
    }
  });

  it("does NOT stamp a workspace on the org-owned CRM tables", async () => {
    // companies / contacts / leads are shared across a company's workspaces by
    // design and have no such column — stamping one would break the insert.
    const byTable = await insertsByTable();
    for (const table of ["companies", "contacts", "leads"]) {
      for (const row of byTable.get(table) ?? []) {
        expect(row).not.toHaveProperty("workspace_id");
      }
    }
  });
});

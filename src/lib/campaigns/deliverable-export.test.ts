import { describe, expect, it } from "vitest";

import { buildCampaignExport, buildDeliverableExport, exportSlug, isExportable } from "./deliverable-export";
import { type CampaignMediaAsset, type CampaignWorkspaceAsset } from "./read-model";

const NOW = "2026-08-03";

function media(over: Partial<CampaignMediaAsset> = {}): CampaignMediaAsset {
  return {
    id: "m1",
    type: "image",
    origin: "attached",
    title: "Driveway photo",
    url: "https://cdn.example.com/driveway.png",
    thumbnailUrl: null,
    mimeType: "image/png",
    description: null,
    source: "library",
    virality: null,
    format: null,
    riskFlags: [],
    libraryAssetId: null,
    storagePath: null,
    review: { state: "unreviewed", reviewer: null, reviewedAt: null, notes: null },
    lineage: [],
    prompt: null,
    ...over,
  };
}

function asset(over: Partial<CampaignWorkspaceAsset> = {}): CampaignWorkspaceAsset {
  return {
    id: "a1",
    title: "Spring reactivation email",
    assetType: "email",
    category: "virtual",
    channel: "email",
    status: "approved",
    body: "We restored your basement last March. Here is what to watch for this spring.",
    preview: "",
    complianceNotes: "",
    guardrailFlags: [],
    blockedPhrases: [],
    dispatchLocked: false,
    toolSource: null,
    updatedAt: "2026-08-01T00:00:00.000Z",
    media: [],
    revision: null,
    approval: null,
    recommendation: null,
    findings: [],
    claimsReviewed: true,
    ...over,
  };
}

describe("isExportable", () => {
  it("allows approved deliverables and nothing else", () => {
    expect(isExportable({ status: "approved" })).toBe(true);
    expect(isExportable({ status: "approved_with_edits" })).toBe(true);
    expect(isExportable({ status: "pending_approval" })).toBe(false);
    expect(isExportable({ status: "declined" })).toBe(false);
    expect(isExportable({ status: "draft" })).toBe(false);
  });
});

describe("exportSlug", () => {
  it("makes a filesystem-safe slug", () => {
    expect(exportSlug("Spring Reactivation — Email!")).toBe("spring-reactivation-email");
  });

  it("never returns an empty string", () => {
    expect(exportSlug("!!!")).toBe("deliverable");
    expect(exportSlug("")).toBe("deliverable");
  });
});

describe("buildDeliverableExport", () => {
  it("carries the copy and the identifying context", () => {
    const out = buildDeliverableExport(asset(), { campaignName: "Spring 2026", now: NOW });
    expect(out).toContain("# Spring reactivation email");
    expect(out).toContain("**Campaign:** Spring 2026");
    expect(out).toContain("**Channel:** email");
    expect(out).toContain("We restored your basement last March.");
  });

  it("lists attached media as links but omits referenced (unverified) URLs", () => {
    const out = buildDeliverableExport(
      asset({ media: [media(), media({ id: "m2", origin: "referenced", title: "Scraped", url: "https://evil.example/x.png" })] }),
      { campaignName: "Spring 2026", now: NOW },
    );
    expect(out).toContain("[Driveway photo](https://cdn.example.com/driveway.png)");
    expect(out).not.toContain("evil.example");
  });

  it("says so plainly when a deliverable is media-only rather than rendering an empty section", () => {
    const out = buildDeliverableExport(asset({ body: "   ", media: [media()] }), { campaignName: "C", now: NOW });
    expect(out).toContain("carries no copy");
  });

  it("surfaces blocked phrases so a compliance problem travels with the file", () => {
    const out = buildDeliverableExport(asset({ blockedPhrases: ["guaranteed coverage"] }), { campaignName: "C", now: NOW });
    expect(out).toContain("guaranteed coverage");
  });
});

describe("buildCampaignExport", () => {
  const campaign = { name: "Spring 2026", persona: "Past client", objective: "Reactivate past clients" };

  it("includes only approved deliverables and counts what it left out", () => {
    const result = buildCampaignExport(
      campaign,
      [
        asset({ id: "a1", title: "Approved email" }),
        asset({ id: "a2", title: "Draft SMS", status: "pending_approval", body: "unapproved copy" }),
      ],
      NOW,
    );
    expect(result.approvedCount).toBe(1);
    expect(result.omittedCount).toBe(1);
    expect(result.content).toContain("Approved email");
    expect(result.content).not.toContain("unapproved copy");
    expect(result.content).toContain("1 deliverable(s) are not approved yet");
  });

  it("exports a non-email channel — the gap the email-only send path left open", () => {
    const result = buildCampaignExport(
      campaign,
      [asset({ channel: "sms", assetType: "sms", category: "virtual", body: "Water in the basement? We answer 24/7." })],
      NOW,
    );
    expect(result.approvedCount).toBe(1);
    expect(result.content).toContain("**Channel:** sms");
    expect(result.content).toContain("We answer 24/7.");
  });

  it("explains itself rather than emitting an empty file when nothing is approved", () => {
    const result = buildCampaignExport(campaign, [asset({ status: "pending_approval" })], NOW);
    expect(result.approvedCount).toBe(0);
    expect(result.content).toContain("Approve a deliverable first");
  });

  it("omits the exclusion notice when everything is approved", () => {
    const result = buildCampaignExport(campaign, [asset()], NOW);
    expect(result.omittedCount).toBe(0);
    expect(result.content).not.toContain("not approved yet and are deliberately not included");
  });
});

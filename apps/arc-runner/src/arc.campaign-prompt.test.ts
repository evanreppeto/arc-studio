import { describe, expect, it } from "vitest";

import { buildCampaignTaskPrompt } from "./arc";
import type { ArcCampaignTaskPayload } from "./types";

function payload(over: Partial<ArcCampaignTaskPayload> = {}): ArcCampaignTaskPayload {
  return {
    type: "arc_campaign_task",
    agentTaskId: "task-1",
    campaignId: "camp-1",
    conversationId: null,
    message: "our logo needs to be on the truck",
    operator: "Robby",
    taskType: "campaign_asset_revision",
    assetId: "asset-1",
    ...over,
  } as ArcCampaignTaskPayload;
}

describe("buildCampaignTaskPrompt", () => {
  it("keeps every task type approval-gated and scoped to one campaign", () => {
    const prompt = buildCampaignTaskPrompt(payload({ taskType: "campaign_brief_draft", assetId: undefined }));
    expect(prompt).toContain('campaign_id "camp-1"');
    expect(prompt).toMatch(/Do not send, publish, launch, approve, unlock dispatch, or spend/);
  });

  it("carries the operator's instruction through verbatim", () => {
    expect(buildCampaignTaskPrompt(payload())).toContain("our logo needs to be on the truck");
  });

  describe("a revision", () => {
    // BSR-695: the payload used to carry only campaignId, so an instruction like
    // "add the logo" arrived with no way to tell which asset it meant.
    it("names the asset being revised", () => {
      expect(buildCampaignTaskPrompt(payload())).toContain('REVISION of the existing asset "asset-1"');
    });

    it("says to preserve what the operator did not ask to change", () => {
      const prompt = buildCampaignTaskPrompt(payload());
      expect(prompt).toMatch(/keep everything they did not ask you to change/);
      expect(prompt).toMatch(/Do not start an unrelated concept from scratch/);
    });

    // BSR-706: hardenImagePrompt strips text and logos from EVERY generation, so
    // regenerating in response to "add our logo" returns an image that still has
    // no logo. compose_creative is the only path that puts the real one on.
    it("routes branding asks to compositing instead of regeneration", () => {
      const prompt = buildCampaignTaskPrompt(payload());
      expect(prompt).toMatch(/compose_creative/);
      expect(prompt).toMatch(/background_url/);
      expect(prompt).toMatch(/do NOT regenerate the background/i);
    });

    it("requires Arc to state the limit rather than quietly missing the ask", () => {
      // The logo is placed by the layout, not painted into the scene, so "on the
      // truck" cannot be honored literally. Saying so beats returning a draft
      // that looks like the request was ignored.
      const prompt = buildCampaignTaskPrompt(payload());
      expect(prompt).toMatch(/NOT painted onto an object inside the photo/);
      expect(prompt).toMatch(/say plainly in your reply that you cannot paint it into the image/);
    });
  });

  it("adds none of the revision guidance to a non-revision task", () => {
    const prompt = buildCampaignTaskPrompt(payload({ taskType: "campaign_brief_draft", assetId: undefined }));
    expect(prompt).not.toMatch(/REVISION of the existing asset/);
    expect(prompt).not.toMatch(/compose_creative/);
  });

  it("omits the revision guidance when the wake carries no assetId", () => {
    // An older app instance can still wake this runner without assetId. Better a
    // plain campaign prompt than one telling Arc to revise an asset it cannot name.
    const prompt = buildCampaignTaskPrompt(payload({ assetId: undefined }));
    expect(prompt).not.toMatch(/REVISION of the existing asset/);
    expect(prompt).toContain("our logo needs to be on the truck");
  });
});

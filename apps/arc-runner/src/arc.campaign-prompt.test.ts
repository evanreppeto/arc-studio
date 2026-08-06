import { describe, expect, it } from "vitest";

import { buildCampaignTaskPrompt } from "./arc";
import { resolveArcSkill } from "./skills";
import { allowedToolNames } from "./tools";
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

    // BSR-759: for two months no tool could edit an existing asset's copy, so a
    // copy revision ran to `completed` and wrote nothing. The prompt has to name
    // the write path, and name the wrong-but-plausible alternative as wrong.
    it("routes copy asks to revise_campaign_asset, on the asset being revised", () => {
      const prompt = buildCampaignTaskPrompt(payload({ message: "use our real 24/7 number in the SMS" }));
      expect(prompt).toMatch(/revise_campaign_asset with asset_id "asset-1"/);
      expect(prompt).toMatch(/COMPLETE revised body/);
      expect(prompt).toMatch(/create_campaign_draft does NOT revise anything/);
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
    expect(prompt).not.toMatch(/revise_campaign_asset/);
  });

  /**
   * The general form of BSR-759, which is what makes it worth a test rather than
   * a fix. `notifyArcCampaignTask` wakes EVERY campaign task under
   * `approval-gated-drafting`, and `filterToolsForSkill` deletes anything off
   * that skill's allowlist. So a prompt that names a tool the skill does not
   * grant produces a well-reasoned refusal — the symptom is Arc politely
   * declining, never an error, which is why a real prod run was the first thing
   * to notice. Naming a tool here and forgetting the allowlist must fail loudly.
   */
  it("never names a tool the skill behind a campaign wake does not grant", () => {
    const skill = resolveArcSkill("approval-gated-drafting");
    const granted = new Set(allowedToolNames("draft", skill).map((n) => n.replace("mcp__arc__", "")));
    // Every tool that exists in draft mode at all — the vocabulary to scan for.
    const everyTool = allowedToolNames("draft").map((n) => n.replace("mcp__arc__", ""));

    const prompt = buildCampaignTaskPrompt(payload());
    const named = everyTool.filter((name) => prompt.includes(name));

    expect(named.length, "the campaign prompt should name at least one tool").toBeGreaterThan(0);
    for (const name of named) {
      expect(granted.has(name), `the campaign prompt tells Arc to use ${name}, but approval-gated-drafting does not grant it`).toBe(true);
    }
  });

  it("omits the revision guidance when the wake carries no assetId", () => {
    // An older app instance can still wake this runner without assetId. Better a
    // plain campaign prompt than one telling Arc to revise an asset it cannot name.
    const prompt = buildCampaignTaskPrompt(payload({ assetId: undefined }));
    expect(prompt).not.toMatch(/REVISION of the existing asset/);
    expect(prompt).toContain("our logo needs to be on the truck");
  });
});

import { describe, expect, it, vi } from "vitest";

import type { ArcClient } from "../arc-client";
import type { ArcActionCard, DraftForReview } from "../types";
import type { TurnSink } from "./helpers";
import { draftWorkProductTools } from "./drafts";

/** A sink that records what the tools collect. */
function testSink() {
  const cards: ArcActionCard[] = [];
  const drafts: DraftForReview[] = [];
  const sink: TurnSink = {
    card: (c) => cards.push(c),
    suggestion: () => {},
    source: () => {},
    question: () => {},
    draft: (d) => drafts.push(d),
  };
  return { cards, drafts, sink };
}

function setup(apiPostImpl: () => Promise<unknown>) {
  const { cards, drafts, sink } = testSink();
  const client = { apiPost: vi.fn(apiPostImpl) } as unknown as ArcClient;
  const step = vi.fn(async () => {});
  const [createDraft] = draftWorkProductTools(client, step, sink);
  const call = (args: Record<string, unknown>) =>
    (createDraft.handler as (a: Record<string, unknown>, e?: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>)(args);
  return { cards, drafts, client, call, createDraft };
}

describe("create_campaign_draft", () => {
  it("is named create_campaign_draft", () => {
    const { createDraft } = setup(async () => ({ campaignId: "c1", assetId: "a1" }));
    expect(createDraft.name).toBe("create_campaign_draft");
  });

  it("posts to the draft-asset endpoint and auto-emits a draft card with the approval block", async () => {
    const { cards, client, call } = setup(async () => ({ ok: true, campaignId: "c1", assetId: "a1" }));
    const out = await call({
      asset_type: "social_ad",
      title: "Fall ad",
      body: "Before winter…",
      name: "Fall",
      persona: "persona_homeowner_emergency",
      restoration_focus: "water",
    });

    expect(client.apiPost).toHaveBeenCalledWith(
      "/api/v1/arc/campaigns/draft-asset",
      expect.objectContaining({ asset_type: "social_ad", title: "Fall ad" }),
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      kind: "draft",
      title: "Fall ad",
      approval: { kind: "campaign", campaignId: "c1", assetId: "a1" },
    });
    expect(out.content[0].text).toContain("a1");
  });

  it("does not emit a card when the create fails", async () => {
    const { cards, call } = setup(async () => {
      throw new Error("boom");
    });
    const out = await call({ asset_type: "social_ad", title: "Fall ad", campaign_id: "c1" });
    expect(cards).toHaveLength(0);
    expect(out.content[0].text).toContain("failed");
  });

  it("forwards conversation_id from ctx to the draft-asset route", async () => {
    const client = { apiPost: vi.fn(async () => ({ campaignId: "c1", assetId: "a1" })) } as unknown as ArcClient;
    const noStep = vi.fn(async () => {});
    const [createDraft] = draftWorkProductTools(client, noStep, testSink().sink, { conversationId: "conv1" });
    await (createDraft.handler as (a: Record<string, unknown>, e?: unknown) => Promise<unknown>)({
      asset_type: "email",
      title: "x",
      campaign_id: "c1",
    });
    expect(client.apiPost).toHaveBeenCalledWith(
      "/api/v1/arc/campaigns/draft-asset",
      expect.objectContaining({ conversation_id: "conv1" }),
    );
  });

  it("defaults to the active campaign from ctx when Arc omits campaign_id", async () => {
    const client = { apiPost: vi.fn(async () => ({ campaignId: "campaign-ctx", assetId: "asset-1" })) } as unknown as ArcClient;
    const noStep = vi.fn(async () => {});
    const [createDraft] = draftWorkProductTools(client, noStep, testSink().sink, { campaignId: "campaign-ctx" });
    await (createDraft.handler as (a: Record<string, unknown>, e?: unknown) => Promise<unknown>)({
      asset_type: "email",
      title: "Follow-up email",
      body: "Copy",
    });
    expect(client.apiPost).toHaveBeenCalledWith(
      "/api/v1/arc/campaigns/draft-asset",
      expect.objectContaining({ campaign_id: "campaign-ctx" }),
    );
  });
});

describe("submit_draft", () => {
  function getSubmit(apiPostImpl: () => Promise<unknown>) {
    const client = { apiPost: vi.fn(apiPostImpl) } as unknown as ArcClient;
    const step = vi.fn(async () => {});
    const submit = draftWorkProductTools(client, step, testSink().sink).find((t) => t.name === "submit_draft")!;
    const call = (args: Record<string, unknown>) =>
      (submit.handler as (a: Record<string, unknown>, e?: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>)(args);
    return { client, call };
  }

  it("submits a generic non-campaign draft into the approval queue with only the provided fields", async () => {
    const { client, call } = getSubmit(async () => ({ ok: true, status: "drafted", approvalItemId: "ap1", agentOutputId: "out1" }));
    const out = await call({
      item_type: "partner_handoff_note",
      draft: "Call Acme re: the flood job their tenant reported.",
      lead_id: "L1",
    });
    expect(client.apiPost).toHaveBeenCalledWith("/api/v1/arc/drafts", {
      item_type: "partner_handoff_note",
      draft: "Call Acme re: the flood job their tenant reported.",
      lead_id: "L1",
    });
    expect(out.content[0].text).toContain("ap1");
  });

  it("is exposed alongside create_campaign_draft", () => {
    const names = draftWorkProductTools({} as ArcClient, async () => {}, testSink().sink).map((t) => t.name);
    expect(names).toEqual(["create_campaign_draft", "submit_draft", "record_campaign_summary"]);
  });
});

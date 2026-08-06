import { describe, expect, it, vi } from "vitest";

import type { ArcClient } from "../arc-client";
import type { ArcActionCard, DraftForReview } from "../types";
import { campaignReviseTools } from "./campaigns";
import type { TurnSink } from "./helpers";

type HandlerResult = { content: Array<{ type: string; text: string }> };

const noStep = async () => {};

function harness(apiPost: ReturnType<typeof vi.fn>) {
  const cards: ArcActionCard[] = [];
  const drafts: DraftForReview[] = [];
  const sink: TurnSink = {
    card: (c) => cards.push(c),
    suggestion: () => {},
    source: () => {},
    question: () => {},
    draft: (d) => drafts.push(d),
  };
  const client = { apiPost } as unknown as ArcClient;
  const [revise] = campaignReviseTools(client, noStep, sink);
  const call = (args: Record<string, unknown>): Promise<HandlerResult> =>
    (revise.handler as (a: Record<string, unknown>, e?: unknown) => Promise<HandlerResult>)(args);
  return { revise, call, cards, drafts };
}

const RESPONSE = {
  assetId: "asset-1",
  campaignId: "camp-1",
  assetType: "sms",
  title: "Storm response SMS",
  body: "Water damage? Call (773) 900-8407 — crews out today.",
  assetStatus: "pending_approval",
  blockedPhrases: [] as string[],
};

const text = (result: HandlerResult) => result.content.map((c) => c.text).join("");

describe("revise_campaign_asset", () => {
  it("is the campaign write tool a revision reaches for", () => {
    const { revise } = harness(vi.fn());
    expect(revise.name).toBe("revise_campaign_asset");
    // The plausible wrong answer sits right next to it in the toolset, so the
    // description has to rule it out rather than merely describe this tool.
    expect(revise.description).toMatch(/create_campaign_draft/);
    expect(revise.description).toMatch(/COMPLETE revised copy/);
  });

  it("sends the asset id and the full revised body to the revise endpoint", async () => {
    const apiPost = vi.fn(async () => RESPONSE);
    const { call } = harness(apiPost);

    await call({ asset_id: "asset-1", body: RESPONSE.body, summary: "Real 24/7 number" });

    expect(apiPost).toHaveBeenCalledWith("/api/v1/arc/campaigns/revise-asset", {
      asset_id: "asset-1",
      body: RESPONSE.body,
      summary: "Real 24/7 number",
    });
  });

  it("hands the revised copy to the critic, not the copy it replaced", async () => {
    // The critic checks what will actually ship. After a revision that is the new
    // text — reviewing the superseded draft would clear copy nobody will send.
    const { call, drafts } = harness(vi.fn(async () => RESPONSE));

    await call({ asset_id: "asset-1", body: RESPONSE.body });

    expect(drafts).toEqual([
      { assetId: "asset-1", campaignId: "camp-1", title: RESPONSE.title, assetType: "sms", body: RESPONSE.body },
    ]);
  });

  it("emits a card the operator can approve from, pointing at the SAME asset", async () => {
    const { call, cards } = harness(vi.fn(async () => RESPONSE));

    await call({ asset_id: "asset-1", body: RESPONSE.body });

    expect(cards[0]?.approval).toEqual({ kind: "campaign", campaignId: "camp-1", assetId: "asset-1" });
    expect(cards[0]?.status).toBe("revision");
  });

  it("reports a refusal as a failure the model can repeat, not as a revision", async () => {
    // BSR-759's whole shape: a revision that changed nothing read as success. The
    // endpoint refuses identical copy, and that refusal has to reach the model as
    // text — otherwise Arc tells the operator it revised the asset.
    const apiPost = vi.fn(async () => {
      throw new Error("The copy you sent is identical to what is already on the asset — nothing was written.");
    });
    const { call, drafts, cards } = harness(apiPost);

    const result = await call({ asset_id: "asset-1", body: "unchanged" });

    expect(text(result)).toMatch(/identical to what is already on the asset/);
    expect(drafts, "nothing was written, so nothing goes to the critic").toEqual([]);
    expect(cards, "a failed revision must not render an approvable card").toEqual([]);
  });

  it("surfaces blocked copy as a risk flag instead of a clean draft", async () => {
    const apiPost = vi.fn(async () => ({
      ...RESPONSE,
      assetStatus: "needs_compliance",
      blockedPhrases: ["guaranteed"],
    }));
    const { call, cards } = harness(apiPost);

    const result = await call({ asset_id: "asset-1", body: "guaranteed results" });

    expect(cards[0]?.flags[0]).toMatchObject({ tone: "risk" });
    expect(text(result)).toMatch(/needs_compliance/);
  });
});

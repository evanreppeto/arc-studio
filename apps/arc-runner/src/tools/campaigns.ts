import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { ArcClient } from "../arc-client";
import { runTool, textResult, type StepFn, type TurnSink } from "./helpers";
import { enforce, expectList, expectRecord } from "./expectations";

/** Read-only campaign + approval visibility. Available in all modes. */
export function campaignReadTools(client: ArcClient, step: StepFn) {
  const listCampaigns = tool(
    "list_campaigns",
    "List campaigns and their status. Use `needs_review` to find campaigns with items awaiting approval.",
    {
      status: z.string().optional(),
      needs_review: z.boolean().optional().describe("Only campaigns with pending approvals"),
      limit: z.number().optional(),
    },
    async (args) =>
      runTool(step, "Listing campaigns", async () => {
        const params = { status: args.status, limit: args.limit, needs_review: args.needs_review ? "true" : undefined };
        const r = await client.apiGet<{ campaigns: unknown[] }>("/api/v1/arc/campaigns", params);
        return enforce(r, expectList("campaigns")).campaigns;
      }),
  );

  const getCampaign = tool(
    "get_campaign",
    "Fetch one campaign's full detail (brief, assets, approval state) by id.",
    { id: z.string() },
    async (args) =>
      runTool(step, "Loading campaign", async () => {
        const r = await client.apiGet<{ campaign: unknown }>(`/api/v1/arc/campaigns/${args.id}`);
        return enforce(r, expectRecord("campaign")).campaign ?? null;
      }),
  );

  const listApprovals = tool(
    "list_approvals",
    "List items in the human approval queue. Optional comma-separated `status` filter.",
    {
      status: z.string().optional().describe("Comma-separated statuses, e.g. pending_owner_approval,revision_requested"),
      limit: z.number().optional(),
    },
    async (args) =>
      runTool(step, "Listing approvals", async () => {
        const r = await client.apiGet<{ approvals: unknown[] }>("/api/v1/arc/approvals", args);
        return enforce(r, expectList("approvals")).approvals;
      }),
  );

  return [listCampaigns, getCampaign, listApprovals];
}

/**
 * Changing a deliverable that already exists. act/draft only.
 *
 * This is the tool a revision request needs, and its absence is why revisions
 * ran to `completed` having changed nothing (BSR-759): `create_campaign_draft`
 * mints a new asset, `submit_draft` is for non-campaign drafts, `update_record`
 * is CRM — nothing wrote to an existing campaign asset's copy. The description
 * has to say that out loud, because the plausible-looking wrong answer
 * (create_campaign_draft) leaves the asset the operator is looking at untouched
 * and adds a second one beside it.
 */
export function campaignReviseTools(client: ArcClient, step: StepFn, sink: TurnSink) {
  const reviseCampaignAsset = tool(
    "revise_campaign_asset",
    "Rewrite an EXISTING campaign deliverable's copy in place. This is the ONLY tool that changes an asset that is already in the approval queue — use it whenever an operator asks for a change to a specific deliverable (reword this, use this phone number, shorten the subject line, change the offer). Read the asset's current text first (get_campaign returns each asset's body) and pass the COMPLETE revised copy in `body` — not a diff, not a description of the change, and not the original text. Do NOT answer a revision with create_campaign_draft: that adds a second asset and leaves the one they asked about unchanged. For a change to an IMAGE (logo, business name, phone number or any words ON the image) use compose_creative instead — copy revisions only here. The asset goes back into the human review queue and stays dispatch-locked; nothing is sent. Refuses, rather than reporting success, if the copy is identical to what is already there or if the asset is already approved.",
    {
      asset_id: z.string().describe("The campaign asset being revised (the id the revision task names)"),
      body: z.string().optional().describe("The COMPLETE revised copy, ready to review — not a diff"),
      title: z.string().optional().describe("New title, when the revision changes it"),
      summary: z.string().optional().describe("One line on what you changed, for the campaign timeline"),
    },
    async (args) => {
      const label = "Revising deliverable";
      await step(label, "running");
      try {
        const r = await client.apiPost<{
          assetId: string;
          campaignId: string;
          assetType: string;
          title: string;
          body: string;
          assetStatus: string;
          blockedPhrases?: string[];
        }>("/api/v1/arc/campaigns/revise-asset", {
          asset_id: args.asset_id,
          ...(args.body ? { body: args.body } : {}),
          ...(args.title ? { title: args.title } : {}),
          ...(args.summary ? { summary: args.summary } : {}),
        });
        await step(label, "done");

        sink.card({
          kind: "draft",
          title: r.title,
          rows: [],
          flags: r.blockedPhrases?.length
            ? [{ tone: "risk" as const, label: `Blocked phrase: ${r.blockedPhrases.join(", ")}` }]
            : [],
          status: "revision",
          ...(r.body ? { preview: r.body.slice(0, 280) } : {}),
          approval: { kind: "campaign", campaignId: r.campaignId, assetId: r.assetId },
        });
        // The critic checks what will actually ship, and after a revision that is
        // the new copy — not the draft it reviewed before the change.
        if (r.body?.trim()) {
          sink.draft({
            assetId: r.assetId,
            campaignId: r.campaignId,
            title: r.title,
            assetType: r.assetType,
            body: r.body,
          });
        }
        return textResult(
          JSON.stringify({
            assetId: r.assetId,
            campaignId: r.campaignId,
            status: `revised, now ${r.assetStatus} — back with the operator for review`,
            ...(r.blockedPhrases?.length ? { blockedPhrases: r.blockedPhrases } : {}),
          }),
        );
      } catch (error) {
        await step(label, "done");
        return textResult(`${label} failed: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    },
  );

  return [reviseCampaignAsset];
}

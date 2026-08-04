import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { ArcClient } from "../arc-client";
import { runTool, type StepFn } from "./helpers";
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

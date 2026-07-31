import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { ArcClient } from "../arc-client";
import { runTool, type StepFn } from "./helpers";
import { enforce, expectRecord } from "./expectations";

/**
 * Approval-item visibility (read, all modes). `get_approval` opens one item in
 * the human approval queue — its assets, campaign context, decision state, and
 * any recommendations Arc has already left on it (returned inline). Pairs with
 * `list_approvals` (the queue) and `recommend_on_approval` (weigh in).
 */
export function approvalReadTools(client: ArcClient, step: StepFn) {
  const getApproval = tool(
    "get_approval",
    "Open one item in the human approval queue by id (id from list_approvals): its assets, campaign context, current decision state, and any recommendations Arc has already left on it. Use before recommend_on_approval to ground your advice in what's actually pending.",
    { id: z.string().describe("Approval item id (from list_approvals).") },
    async (args) =>
      runTool(step, "Loading approval item", async () => {
        const r = await client.apiGet<{ approval: unknown }>(`/api/v1/arc/approvals/${args.id}`);
        return enforce(r, expectRecord("approval")).approval ?? null;
      }),
  );

  return [getApproval];
}

/**
 * Advisory recommendation on an approval item (act/draft modes). `recommend_on_approval`
 * writes to the `approval_recommendations` ledger ONLY — it NEVER approves, declines,
 * launches, sends, or publishes. The human decision gate is untouched; outbound stays
 * locked. This is how Arc gives the operator a source-backed "here's what I'd do and why"
 * on a pending item without crossing the approval boundary.
 */
export function approvalWriteTools(client: ArcClient, step: StepFn) {
  const recommendOnApproval = tool(
    "recommend_on_approval",
    "Add an ADVISORY recommendation to a pending approval item (id from list_approvals / get_approval) — your verdict plus the reasoning behind it. This is advisory ONLY: it never approves, declines, sends, launches, or publishes anything; the human still decides. Use it to tell the operator what you'd do (e.g. 'approve', 'request revision', 'decline') and why, with concrete risk flags and suggested edits. Always ground the rationale in real evidence (proof points, brand sources, CRM signals).",
    {
      approval_id: z.string().describe("Approval item id (from list_approvals / get_approval)."),
      recommendation: z
        .string()
        .describe("Your verdict, e.g. 'approve' | 'request revision' | 'decline' (a short sentence is fine)."),
      rationale: z.string().optional().describe("Why — the evidence-backed reasoning behind the recommendation."),
      risk_flags: z
        .array(z.string())
        .optional()
        .describe("Concrete risks to surface, e.g. claim_risk | privacy | unrealistic_scene | embedded_text."),
      suggested_edits: z.string().optional().describe("Specific changes you'd make before this ships."),
    },
    async (args) =>
      runTool(step, "Recommending on approval item", () =>
        client.apiPost(`/api/v1/arc/approvals/${args.approval_id}/recommendation`, {
          recommendation: args.recommendation,
          ...(args.rationale ? { rationale: args.rationale } : {}),
          ...(args.risk_flags ? { risk_flags: args.risk_flags } : {}),
          ...(args.suggested_edits ? { suggested_edits: args.suggested_edits } : {}),
        }),
      ),
  );

  return [recommendOnApproval];
}

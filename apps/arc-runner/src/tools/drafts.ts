import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { ArcClient } from "../arc-client";
import type { ToolContext } from "./index";
import { runTool, textResult, type StepFn, type TurnSink } from "./helpers";

/**
 * Map an asset type to the card's channel/format so the chat thumbnail can render
 * a typed preview (email layout, SMS bubble, document) instead of a blank tile.
 * The app's AssetThumb keys off lowercased `${channel} ${format}` — keep these
 * strings matching its checks (email / sms / pdf / 1:1 …).
 */
function cardChannelFormat(assetType: string): { channel?: string; format?: string } {
  switch (assetType.toLowerCase()) {
    case "email":
      return { channel: "Email" };
    case "sms":
    case "text":
      return { channel: "SMS" };
    case "one_pager":
    case "pdf":
      return { channel: "One-pager", format: "pdf" };
    case "landing_page":
      return { channel: "Landing page" };
    case "social_ad":
      return { channel: "Paid social", format: "1:1" };
    case "video_prompt":
    case "video_ad":
      return { channel: "Video", format: "9:16" };
    case "image":
    case "image_prompt":
      return { channel: "Image", format: "1:1" };
    default:
      return {};
  }
}

/**
 * Draft work products (act/draft mode). `create_campaign_draft` creates a real,
 * approval-gated campaign asset (pending_approval, dispatch_locked) and auto-emits
 * a draft card carrying the inline Approve/Decline block. Nothing goes outbound;
 * the operator approves before anything is usable.
 */
export function draftWorkProductTools(
  client: ArcClient,
  step: StepFn,
  sink: TurnSink,
  ctx: ToolContext = {},
) {
  const collectCard = sink.card;
  const createCampaignDraft = tool(
    "create_campaign_draft",
    "Create an approval-gated campaign DRAFT asset (e.g. social_ad, email, sms, image_prompt, video_prompt, landing_page, one_pager). Attach to an existing campaign with campaign_id, or create a new draft campaign by giving name + persona (use a persona key) + campaign_theme (a short phrase for what the campaign is about, in this workspace's own terms — e.g. 'Spring storm roof response', 'Q4 onboarding push', 'Lapsed-customer win-back'). The asset is created pending approval and surfaced with an inline Approve/Decline card — nothing is sent. Returns campaignId + assetId.",
    {
      campaign_id: z.string().optional().describe("Existing campaign to attach to; omit to create a new draft campaign"),
      name: z.string().optional().describe("New campaign name (required when campaign_id is omitted)"),
      persona: z.string().optional().describe("Persona key (required when creating a new campaign)"),
      campaign_theme: z
        .string()
        .optional()
        .describe("Short, industry-appropriate campaign theme, required when creating a new campaign (what the campaign is about, in the workspace's own terms)"),
      restoration_focus: z
        .string()
        .optional()
        .describe("Legacy restoration loss-focus (BSR only) — optional; prefer campaign_theme"),
      asset_type: z.string().describe("Asset type, e.g. social_ad | email | sms | image_prompt | landing_page | one_pager"),
      title: z.string().describe("Short title for the asset"),
      body: z.string().optional().describe("The draft copy/content"),
      media_url: z.string().optional().describe("Optional reference media URL"),
      // Without these three, a package drafted in chat lost its provenance: the
      // campaign recorded no objective, no audience, and no link to the signal it
      // came from, so the opportunity stayed `pending` and the next scan
      // re-proposed work that was already done (BSR-675/677).
      opportunity_id: z
        .string()
        .optional()
        .describe(
          "The opportunity this campaign is being drafted FROM, when you know it (e.g. from list_opportunities). Links the campaign to the signal that justified it and marks the opportunity drafted, so it stops being re-proposed. Pass it whenever you are acting on an opportunity.",
        ),
      objective: z
        .string()
        .optional()
        .describe("One line: what this campaign is for. Recorded on the campaign so the package reads complete."),
      audience_summary: z
        .string()
        .optional()
        .describe("One line: who this targets and why they were grouped."),
      handoff_note: z
        .string()
        .optional()
        .describe(
          "The sales/partner handoff note — what a human picking this up needs to know. Recorded on the campaign and shown on its page.",
        ),
      considered_audiences: z
        .array(
          z.object({
            label: z.string().describe("The audience you weighed, in this workspace's own words"),
            reason: z.string().describe("Why it was NOT chosen — a label with no reason explains nothing"),
            size_estimate: z.number().optional().describe("Rough size, only when you actually know it"),
          }),
        )
        .optional()
        .describe(
          "Audiences you considered and set aside, each with the reason. Say what you rejected and why, not just what you picked.",
        ),
    },
    async (args) => {
      const label = "Creating campaign draft";
      await step(label, "running");
      try {
        const r = await client.apiPost<{ campaignId: string; assetId: string }>(
          "/api/v1/arc/campaigns/draft-asset",
          {
            ...args,
            ...(args.campaign_id ? {} : ctx.campaignId ? { campaign_id: ctx.campaignId } : {}),
            ...(ctx.opportunityId ? { opportunity_id: ctx.opportunityId } : {}),
            ...(ctx.conversationId ? { conversation_id: ctx.conversationId } : {}),
          },
        );
        await step(label, "done");
        collectCard({
          kind: "draft",
          title: args.title,
          rows: [],
          flags: [],
          status: "draft",
          ...cardChannelFormat(args.asset_type),
          ...(args.body ? { preview: args.body.slice(0, 280) } : {}),
          ...(args.media_url ? { media: { kind: "image", url: args.media_url } } : {}),
          approval: { kind: "campaign", campaignId: r.campaignId, assetId: r.assetId },
        });
        // Hand the full copy to the critic's work list. The card only carries a
        // 280-char preview; the critic has to check what will actually ship.
        if (args.body?.trim()) {
          sink.draft({
            assetId: r.assetId,
            campaignId: r.campaignId,
            title: args.title,
            assetType: args.asset_type,
            body: args.body,
          });
        }
        return textResult(
          JSON.stringify({ campaignId: r.campaignId, assetId: r.assetId, status: "draft created, pending approval" }),
        );
      } catch (error) {
        await step(label, "done");
        const reason = error instanceof Error ? error.message : "unknown error";
        return textResult(`${label} failed: ${reason}`);
      }
    },
  );

  const submitDraft = tool(
    "submit_draft",
    "Submit a GENERIC, non-campaign draft into the human approval queue — e.g. a partner/sales handoff note, a one-off outreach message, or a record-specific recommendation that isn't a campaign asset. For campaign creative (social_ad, email, sms, image, landing page) use create_campaign_draft instead. The item is created pending_approval and locked; nothing is sent. You MUST link it to the record it's about with at least one of campaign_id / company_id / contact_id / lead_id (a draft with no subject is rejected); task_id alone is not enough. Returns approvalItemId.",
    {
      item_type: z.string().describe("What kind of draft this is, e.g. partner_handoff_note | outreach_message | record_recommendation"),
      draft: z.string().describe("The draft content the human will review."),
      title: z.string().optional().describe("Short title for the queue entry"),
      summary: z.string().optional().describe("One-line summary of what this is and why"),
      risk_level: z.string().optional().describe("low | medium | high"),
      campaign_id: z.string().optional().describe("Link to a campaign, if relevant"),
      company_id: z.string().optional().describe("Link to a CRM company"),
      contact_id: z.string().optional().describe("Link to a CRM contact"),
      lead_id: z.string().optional().describe("Link to a CRM lead"),
      task_id: z.string().optional().describe("Link to an agent task"),
    },
    async (args) =>
      runTool(step, "Submitting draft for approval", () =>
        client.apiPost("/api/v1/arc/drafts", {
          item_type: args.item_type,
          draft: args.draft,
          ...(args.title ? { title: args.title } : {}),
          ...(args.summary ? { summary: args.summary } : {}),
          ...(args.risk_level ? { risk_level: args.risk_level } : {}),
          ...(args.campaign_id ? { campaign_id: args.campaign_id } : {}),
          ...(args.company_id ? { company_id: args.company_id } : {}),
          ...(args.contact_id ? { contact_id: args.contact_id } : {}),
          ...(args.lead_id ? { lead_id: args.lead_id } : {}),
          ...(args.task_id ? { task_id: args.task_id } : {}),
        }),
      ),
  );

  /**
   * Metadata only. Exists because `create_campaign_draft` used to be the only
   * way to write these fields onto an existing campaign, so documenting a
   * campaign meant minting a deliverable to carry the note — an asset nobody
   * would ever send, sitting in the approval queue as work to review.
   */
  const recordCampaignSummary = tool(
    "record_campaign_summary",
    "Record what a campaign IS — its objective, audience summary, sales/partner handoff note, and the audiences you considered and set aside. Metadata only: creates no asset and no approval item, so use this rather than create_campaign_draft when you are documenting a campaign rather than adding a deliverable to it. Additive — omit a field to leave it as it is. Needs the campaign's FULL uuid, not a short prefix.",
    {
      campaign_id: z.string().describe("The campaign's full uuid"),
      objective: z.string().optional().describe("One line: what this campaign is for"),
      audience_summary: z.string().optional().describe("One line: who it targets and why they were grouped"),
      handoff_note: z
        .string()
        .optional()
        .describe("What a human picking this up needs to know — including anything unfinished or wrong with it"),
      considered_audiences: z
        .array(
          z.object({
            label: z.string().describe("The audience you weighed, in this workspace's own words"),
            reason: z.string().describe("Why it was NOT chosen — a label with no reason explains nothing"),
            size_estimate: z.number().optional().describe("Rough size, only when you actually know it"),
          }),
        )
        .optional()
        .describe("Audiences considered and set aside, each with its reason"),
    },
    async (args) =>
      runTool(step, "Recording campaign summary", () => client.apiPost("/api/v1/arc/campaigns/summary", args)),
  );

  return [createCampaignDraft, submitDraft, recordCampaignSummary];
}

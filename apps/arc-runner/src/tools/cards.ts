import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { ArcActionCard } from "../types";
import { textResult } from "./helpers";

/**
 * `emit_card` lets Arc attach a structured card to its reply. Available in every
 * mode — surfacing a card is safe; the operator still makes any approval decision.
 * Cards are collected per-turn and posted as `metadata.actions`. The app
 * re-validates them with parseActions on read.
 *
 * IMPORTANT: only include an `approval` block when referencing an EXISTING
 * campaign asset (campaignId + assetId from get_campaign) — Arc cannot mint
 * assets yet, and the inline Approve/Decline resolves a real campaign_assets.id.
 */
export function emitCardTool(collectCard: (card: ArcActionCard) => void) {
  return tool(
    "emit_card",
    "Attach a structured card to your reply (renders below your text). Use kind 'result' to present records you found (rows = clickable record lines: name + optional meta/badge/href). Use kind 'draft' to present a proposed asset for review (preview + flags). Only add an `approval` block { kind:'campaign', campaignId, assetId } when referencing an EXISTING campaign asset you read via get_campaign — never invent ids. Call alongside your text reply. Use kind 'navigate' to hand back a one-click deep link into the app: set appState.href to an in-app route (from get_app_map) with query filters, and appState.filters to the human-readable filter labels.",
    {
      kind: z.enum(["result", "draft", "navigate"]),
      title: z.string(),
      href: z.string().optional(),
      rows: z
        .array(
          z.object({
            name: z.string(),
            meta: z.string().optional(),
            badge: z.string().optional(),
            href: z.string().optional(),
          }),
        )
        .optional(),
      flags: z.array(z.object({ tone: z.enum(["ok", "warn", "risk"]), label: z.string() })).optional(),
      preview: z.string().optional(),
      approval: z
        .object({ kind: z.literal("campaign"), campaignId: z.string(), assetId: z.string() })
        .optional(),
      channel: z.string().optional(),
      format: z.string().optional(),
      status: z.enum(["draft", "revision", "approved", "rejected"]).optional(),
      media: z
        .object({
          kind: z.enum(["image", "video"]),
          url: z.string(),
          alt: z.string().optional(),
          caption: z.string().optional(),
          source: z.enum(["bsr_real", "ai_generated", "composite", "stock", "external"]).optional(),
          format: z.string().optional(),
          status: z.enum(["draft", "revision", "approved", "rejected"]).optional(),
          riskFlags: z.array(z.string()).optional(),
          sourceId: z.string().optional(),
          jobId: z.string().optional(),
          model: z.string().optional(),
        })
        .optional()
        .describe("Thumbnail + provenance. Use a real url (e.g. approved BSR media, source:'bsr_real'); never invent a url."),
      appState: z
        .object({
          href: z.string().describe("In-app route only, must start with '/'. Build it from get_app_map routes + query filters."),
          filters: z.array(z.string()).optional().describe("Human-readable filter labels shown as chips, e.g. 'persona: landlord'."),
        })
        .optional()
        .describe("For kind:'navigate' — a pre-filtered in-app view the operator opens in one click."),
    },
    async (args) => {
      const card: ArcActionCard = {
        kind: args.kind,
        title: args.title,
        rows: args.rows ?? [],
        flags: args.flags ?? [],
        ...(args.href ? { href: args.href } : {}),
        ...(args.preview ? { preview: args.preview } : {}),
        ...(args.approval ? { approval: args.approval } : {}),
        ...(args.channel ? { channel: args.channel } : {}),
        ...(args.format ? { format: args.format } : {}),
        ...(args.status ? { status: args.status } : {}),
        ...(args.media ? { media: args.media } : {}),
        ...(args.appState ? { appState: args.appState } : {}),
      };
      collectCard(card);
      return textResult(`Attached ${args.kind} card: ${args.title}`);
    },
    // Never deferred behind tool search: see ALWAYS_LOADED_REPLY_TOOLS in ./index.
    { alwaysLoad: true },
  );
}

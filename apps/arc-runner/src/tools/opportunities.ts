import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { ArcClient } from "../arc-client";
import { runTool, type StepFn } from "./helpers";

/**
 * The canonical kinds, mirroring src/domain/opportunity-kinds.ts — the runner is a
 * standalone package (its own package.json + npm ci) and cannot import @/domain, so
 * these two lists are kept in step by a test in the app suite.
 *
 * They are an enum rather than a hint because `kind` and `subject_type` are two
 * thirds of the inbox's dedup key (org_id, kind, subject_type, subject_id). While
 * these were `z.string()` with the values only *suggested* in a description, Arc
 * coined a fresh synonym on most days and each one slipped past the dedup: one
 * company arrived as both `dormant_account` and `account_expansion`, one persona as
 * both `segment_gap` and `persona_gap` — same insight, left sitting twice.
 */
const OPPORTUNITY_KINDS = [
  "crm_inactivity",
  "new_lead_discovery",
  "weather_event",
  "competitor_signal",
  "approved_media",
  "performance_anomaly",
  "persona_segment_gap",
  "account_expansion",
  "partner_network",
  "attribution_gap",
  "next_iteration",
  "news_signal",
] as const;

const OPPORTUNITY_SUBJECT_TYPES = [
  "company",
  "contact",
  "lead",
  "persona",
  "competitor",
  "segment",
  "campaign",
  "weather_event",
  "competitor_signal",
  "feed_item",
] as const;

/**
 * Write tool (approval-safe): propose a source-backed opportunity into the inbox.
 * Everything lands status=pending; the operator approves before anything happens.
 * Only available in the opportunity-scan tool set.
 */
export function proposeOpportunityTool(client: ArcClient, step: StepFn) {
  return tool(
    "propose_opportunity",
    "Propose a source-backed opportunity into the inbox (status pending — the operator approves it before anything happens). Use during an opportunity scan after reviewing CRM / personas / brand / activity. Give concrete evidence/source refs and a STABLE subject id (CRM id, persona key, competitor id) so duplicates of an existing open opportunity are skipped. Pick the closest `kind` from the list rather than coining a new one: kind is part of the dedup key, so a synonym re-files the same finding as a new card. Set `persona` whenever the opportunity targets an audience — without it the opportunity cannot become a campaign draft on its own. WHO READS THIS: `title`, `summary`, `evidence` and `recommended_action` are rendered verbatim on a card the business owner reads — not a log line. Write them the way you would say it out loud to that owner. NEVER put a record id/UUID, a tool name (read_recent_activity, query_brain, mcp__*), a column or field name (mediaAvailable, demo_seed, persona_property_manager), or a query description into any of them. Name things the way the owner names them: the campaign's title, the customer's name, the county, the persona's label.",
    {
      kind: z.enum(OPPORTUNITY_KINDS).describe("Closest canonical kind — part of the dedup key"),
      subject_type: z.enum(OPPORTUNITY_SUBJECT_TYPES),
      subject_id: z.string().describe("Stable id for the subject — used for dedup. This is the ONLY field an id belongs in."),
      title: z.string().describe("One plain-English line the owner could read aloud. No ids, no tool or field names."),
      summary: z
        .string()
        .describe(
          "Why this is an opportunity now, in 2-3 sentences of plain English for the business owner. Lead with the finding, then the evidence for it, then any caveat. Refer to things by name, never by id — \"the Suburban Home background asset\", not its UUID — and never mention which tools you called to find it.",
        ),
      confidence: z.number().min(0).max(100).optional(),
      urgency: z.enum(["low", "medium", "high"]).optional(),
      evidence: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "The facts backing the claim, each one something the owner could go and check. Keys become row labels on the card, so name them as short plain-English labels (`advisory_area`, `days_since_contact`) — not tool names, not database columns. Values must be readable: names, counts, dates, places, links. Do NOT file the tools you called under `source`; `source` is where the business's own source goes (a publication, the National Weather Service, a CRM record).",
        ),
      persona: z
        .string()
        .optional()
        .describe(
          "Persona key this opportunity targets, from the workspace's own persona list (e.g. persona_property_manager). Set it whenever the opportunity plausibly has one: an opportunity with no persona CANNOT be turned into a campaign draft automatically and will sit in the inbox until a human picks one. Leave it unset only when the finding genuinely targets no audience — a data-quality or attribution gap, say — rather than guessing.",
        ),
      recommended_action: z
        .string()
        .optional()
        .describe("What the owner should do next, in their words. One sentence, no ids and no tool names."),
      recommended_campaign_type: z.string().optional(),
    },
    async (args) =>
      runTool(step, "Proposing opportunity", () =>
        client.apiPost("/api/v1/arc/opportunities/propose", args),
      ),
  );
}

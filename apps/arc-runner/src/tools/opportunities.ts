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
    "Propose a source-backed opportunity into the inbox (status pending — the operator approves it before anything happens). Use during an opportunity scan after reviewing CRM / personas / brand / activity. Give concrete evidence/source refs and a STABLE subject id (CRM id, persona key, competitor id) so duplicates of an existing open opportunity are skipped. Pick the closest `kind` from the list rather than coining a new one: kind is part of the dedup key, so a synonym re-files the same finding as a new card. Set `persona` whenever the opportunity targets an audience — without it the opportunity cannot become a campaign draft on its own.",
    {
      kind: z.enum(OPPORTUNITY_KINDS).describe("Closest canonical kind — part of the dedup key"),
      subject_type: z.enum(OPPORTUNITY_SUBJECT_TYPES),
      subject_id: z.string().describe("Stable id for the subject — used for dedup"),
      title: z.string(),
      summary: z
        .string()
        .describe(
          "Why this is an opportunity now, written for the business owner who will read it on their home page. Name records the way they would ('Suburban Home Background Asset'), never by id — a UUID in this text renders on their front page. Do not name the tools you used; the operator wants the finding, not the trace.",
        ),
      confidence: z.number().min(0).max(100).optional(),
      urgency: z.enum(["low", "medium", "high"]).optional(),
      evidence: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Source links / refs / signals backing it. EVERY key and value here is rendered verbatim to a non-technical operator as the proof for this card, so write values a person can read: names, counts, places, dates. Never a bare row id, and never a list of tool calls — 'active_flood_advisories: [<uuid>, <uuid>]' tells them nothing, 'active_flood_advisories: 2' or the advisory names tell them everything.",
        ),
      persona: z
        .string()
        .optional()
        .describe(
          "Persona key this opportunity targets, from the workspace's own persona list (e.g. persona_property_manager). Set it whenever the opportunity plausibly has one: an opportunity with no persona CANNOT be turned into a campaign draft automatically and will sit in the inbox until a human picks one. Leave it unset only when the finding genuinely targets no audience — a data-quality or attribution gap, say — rather than guessing.",
        ),
      recommended_action: z.string().optional(),
      recommended_campaign_type: z.string().optional(),
    },
    async (args) =>
      runTool(step, "Proposing opportunity", () =>
        client.apiPost("/api/v1/arc/opportunities/propose", args),
      ),
  );
}

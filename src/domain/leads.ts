import { z } from "zod";

import { INTERNAL_UNASSIGNED_PERSONA, OFFICIAL_PERSONA_MAPPINGS } from "./personas";

const PERSONA_VALUES = [
  ...OFFICIAL_PERSONA_MAPPINGS,
  INTERNAL_UNASSIGNED_PERSONA,
] as [string, ...string[]];

export const LEAD_STATUSES = [
  "new",
  "validated",
  "needs_review",
  "qualified",
  "converted",
  "lost",
  "archived",
] as const;
/**
 * Row-level status validation is a NON-EMPTY STRING, not an enum.
 *
 * `LeadSchema.parse(row)` runs on every lead read from the database. Once a
 * tenant can define its own pipeline stages (BSR-495), a lead sitting in
 * "conflicts_check" would throw here and take down their entire lead list — a
 * per-org vocabulary is useless if reading it crashes.
 *
 * WHICH values are allowed is an app-layer question, answered against the org's
 * `pipeline_stages` (see isWonStatus / findStage in domain/pipeline-stages.ts),
 * exactly as persona validation is answered against the org's own taxonomy.
 * `LEAD_STATUSES` survives as the default/offline set.
 */
export const LeadStatusSchema = z.string().trim().min(1);
export type LeadStatus = string;

export const ROUTING_RECOMMENDATIONS = ["target", "elevated", "downgraded", "isolated", "archived"] as const;
export const RoutingRecommendationSchema = z.enum(ROUTING_RECOMMENDATIONS);
export type RoutingRecommendation = z.infer<typeof RoutingRecommendationSchema>;

export const LeadRowSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid().nullable(),
  contact_id: z.string().uuid().nullable(),
  property_id: z.string().uuid().nullable(),
  // Non-empty string, not z.enum(PERSONA_VALUES): personas have been per-org
  // since migration 20260713120000, so enumerating BSR's twelve here meant a
  // tenant's OWN persona threw on read. Same reasoning as status above.
  persona: z.string().trim().min(1),
  status: LeadStatusSchema,
  routing_recommendation: RoutingRecommendationSchema,
  source: z.string().min(1),
  external_lead_id: z.string().nullable(),
  loss_summary: z.string().nullable(),
  loss_signals: z.array(z.string()),
  matched_target_keywords: z.array(z.string()),
  matched_non_target_keywords: z.array(z.string()),
  lead_score: z.number().int().min(0).max(100),
  received_at: z.string().datetime({ offset: true }),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const LeadSchema = LeadRowSchema.transform((row) => ({
  id: row.id,
  companyId: row.company_id,
  contactId: row.contact_id,
  propertyId: row.property_id,
  persona: row.persona,
  status: row.status,
  routingRecommendation: row.routing_recommendation,
  source: row.source,
  externalLeadId: row.external_lead_id,
  lossSummary: row.loss_summary,
  lossSignals: row.loss_signals,
  matchedTargetKeywords: row.matched_target_keywords,
  matchedNonTargetKeywords: row.matched_non_target_keywords,
  leadScore: row.lead_score,
  receivedAt: row.received_at,
  metadata: row.metadata,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
}));

export type LeadRow = z.infer<typeof LeadRowSchema>;
export type Lead = z.infer<typeof LeadSchema>;

/**
 * The compact projection Arc's lead SEARCH returns — enough to triage and pick a
 * lead, not the whole row. A full lead is ~833 chars, so a default page of 25
 * overflows the runner's 8000-char tool budget and gets trimmed to ~9; this keeps
 * the fields a caller needs to choose a record and leaves the rest to `get_lead`.
 *
 * Dropped here (all recoverable via `get_lead`): the FK uuids, `external_lead_id`,
 * the loss/keyword arrays, `metadata`, and the created/updated timestamps.
 * `company_id`/`contact_id` ARE still selected — they're the join keys the route
 * resolves to names — but they don't reach Arc (see `withCrmNamesCompact`).
 *
 * Built by picking from `LeadRowSchema` so the field definitions never fork.
 */
export const LeadSummaryRowSchema = LeadRowSchema.pick({
  id: true,
  company_id: true,
  contact_id: true,
  persona: true,
  status: true,
  routing_recommendation: true,
  source: true,
  loss_summary: true,
  lead_score: true,
  received_at: true,
});

export const LeadSummarySchema = LeadSummaryRowSchema.transform((row) => ({
  id: row.id,
  companyId: row.company_id,
  contactId: row.contact_id,
  persona: row.persona,
  status: row.status,
  routingRecommendation: row.routing_recommendation,
  source: row.source,
  lossSummary: row.loss_summary,
  leadScore: row.lead_score,
  receivedAt: row.received_at,
}));

/**
 * The PostgREST `select()` column list for a lead summary, derived from the schema
 * so the columns fetched and the columns parsed can never drift. Keeping this in
 * lock-step is the point: a wider `select` than the schema would silently ship the
 * heavy fields the trim exists to drop.
 */
export const LEAD_SUMMARY_COLUMNS = Object.keys(LeadSummaryRowSchema.shape).join(", ");

export type LeadSummaryRow = z.infer<typeof LeadSummaryRowSchema>;
export type LeadSummary = z.infer<typeof LeadSummarySchema>;

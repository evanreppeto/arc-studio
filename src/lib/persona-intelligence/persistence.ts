import { type SupabaseClient } from "@supabase/supabase-js";

import { buildPersonaProfile, type LeadIngestionResult, type ParsedLeadIngestionInput, type PersonaProfile } from "../../domain";
import { type PersistedLeadIngestion } from "../lead-ingestion/persistence";
import { workspaceIdFields } from "../tenancy/resolve-workspace";

type AcceptedLeadIngestionResult = Extract<LeadIngestionResult, { ok: true }>;

type PersistPersonaIntelligenceInput = {
  input: ParsedLeadIngestionInput;
  result: AcceptedLeadIngestionResult;
  persisted: PersistedLeadIngestion;
  supabase: SupabaseClient;
  /**
   * The owning workspace. Required — and the reason is nastier than it looks.
   *
   * persona_snapshots / engagement_events / next_best_actions are `org_id NOT
   * NULL`, but they also carry `default default_organization_id()`, which is
   * hardcoded to the 'big-shoulders-restoration' slug. So omitting org_id does
   * NOT fail and does NOT write an unscoped row — it silently writes the row into
   * BSR's workspace. That was invisible while lead ingest was single-tenant
   * (everything was BSR anyway); the moment ingest resolves a real per-workspace
   * org, a tenant's lead would persist to their org while its persona snapshot,
   * engagement events and next-best-action landed in BSR's. Passing org_id
   * explicitly is what stops that.
   */
  orgId: string;
};

type InsertResult = {
  id: string;
};

export type PersistedPersonaIntelligence = {
  personaSnapshotId: string;
  engagementEventIds: string[];
  nextBestActionId: string;
};

export async function persistPersonaIntelligenceForLead({
  input,
  result,
  persisted,
  supabase,
  orgId,
}: PersistPersonaIntelligenceInput): Promise<PersistedPersonaIntelligence> {
  const profile = buildProfile(input, result);
  const workspaceFields = await workspaceIdFields(supabase, orgId);
  const personaSnapshotId = await insertAndReturnId(supabase, "persona_snapshots", {
    org_id: orgId,
    ...workspaceFields,
    persona: result.persona,
    company_id: persisted.companyId,
    contact_id: persisted.contactId,
    property_id: persisted.propertyId,
    lead_id: persisted.leadId,
    relationship_stage: profile.relationshipStage,
    value_tier: profile.valueTier,
    dominant_loss_pattern: profile.dominantLossPattern,
    preferred_channel: profile.preferredChannel,
    message_posture: profile.messagePosture,
    recommended_offer: profile.recommendedOffer,
    next_best_action: profile.nextBestAction,
    confidence_score: profile.confidenceScore,
    risk_flags: profile.riskFlags,
    source_events: profile.sourceEvents,
    reasoning_payload: {
      routing: result.routing,
      classification: result.classification.classification,
      matched_target_keywords: result.classification.matchedTargetKeywords,
      matched_non_target_keywords: result.classification.matchedNonTargetKeywords,
      lead_score: result.scores.leadScore,
      partner_score: result.scores.partnerScore,
    },
    audit_payload: {
      mode: "ingest_auto_generated",
      generated_at: result.scores.calculatedAt,
      source: input.source,
    },
  });

  const engagementEventIds = await insertManyAndReturnIds(supabase, "engagement_events", [
    {
      org_id: orgId,
      company_id: persisted.companyId,
      contact_id: persisted.contactId,
      property_id: persisted.propertyId,
      lead_id: persisted.leadId,
      event_type: "lead_received",
      channel: input.source,
      occurred_at: result.scores.calculatedAt,
      summary: input.lossSummary ?? input.lossSignals.join(", "),
      direction: "inbound",
      metadata: {
        external_lead_id: input.externalLeadId ?? null,
        loss_signals: input.lossSignals,
      },
      reasoning_payload: {},
    },
    {
      org_id: orgId,
      company_id: persisted.companyId,
      contact_id: persisted.contactId,
      property_id: persisted.propertyId,
      lead_id: persisted.leadId,
      event_type: "loss_classified",
      channel: "system",
      occurred_at: result.scores.calculatedAt,
      summary: `${result.classification.classification} routed as ${result.routing}.`,
      direction: "internal",
      metadata: {
        matched_target_keywords: result.classification.matchedTargetKeywords,
        matched_non_target_keywords: result.classification.matchedNonTargetKeywords,
      },
      reasoning_payload: {
        routing_recommendation: result.classification.routingRecommendation,
      },
    },
    {
      org_id: orgId,
      company_id: persisted.companyId,
      contact_id: persisted.contactId,
      property_id: persisted.propertyId,
      lead_id: persisted.leadId,
      event_type: "persona_snapshot_created",
      channel: "system",
      occurred_at: result.scores.calculatedAt,
      summary: profile.nextBestAction,
      direction: "internal",
      metadata: {
        persona_snapshot_id: personaSnapshotId,
      },
      reasoning_payload: {
        confidence_score: profile.confidenceScore,
        risk_flags: profile.riskFlags,
      },
    },
  ]);

  const nextBestActionId = await insertAndReturnId(supabase, "next_best_actions", {
    org_id: orgId,
    ...workspaceFields,
    persona_snapshot_id: personaSnapshotId,
    company_id: persisted.companyId,
    contact_id: persisted.contactId,
    property_id: persisted.propertyId,
    lead_id: persisted.leadId,
    title: profile.nextBestAction,
    action_type: profile.actionType,
    status: "open",
    priority: profile.confidenceScore,
    approval_required: profile.approvalRequired,
    recommendation: profile.recommendedOffer,
    reason: profile.actionReason,
    reasoning_payload: {
      message_posture: profile.messagePosture,
      preferred_channel: profile.preferredChannel,
      routing: result.routing,
    },
    audit_payload: {
      mode: "ingest_auto_generated",
      generated_at: result.scores.calculatedAt,
    },
  });

  return {
    personaSnapshotId,
    engagementEventIds,
    nextBestActionId,
  };
}

/** Map an accepted lead ingest onto the pure persona-profile input. The derivation
 *  logic now lives in src/domain/persona-profile.ts and is unit-tested there. */
function buildProfile(input: ParsedLeadIngestionInput, result: AcceptedLeadIngestionResult): PersonaProfile {
  return buildPersonaProfile({
    source: input.source,
    lossSignals: input.lossSignals,
    persona: result.persona,
    routing: result.routing,
    leadScore: result.scores.leadScore,
    partnerScore: result.scores.partnerScore,
    matchedTargetKeywords: result.classification.matchedTargetKeywords,
    matchedNonTargetKeywords: result.classification.matchedNonTargetKeywords,
  });
}

async function insertAndReturnId(
  supabase: SupabaseClient,
  table: "persona_snapshots" | "next_best_actions",
  values: Record<string, unknown>,
) {
  const { data, error } = await supabase.from(table).insert(values).select("id").single<InsertResult>();

  if (error) {
    throw new Error(`Failed to persist ${table}: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error(`Failed to persist ${table}: insert did not return an id.`);
  }

  return data.id;
}

async function insertManyAndReturnIds(
  supabase: SupabaseClient,
  table: "engagement_events",
  values: Array<Record<string, unknown>>,
) {
  const { data, error } = await supabase.from(table).insert(values).select("id").returns<InsertResult[]>();

  if (error) {
    throw new Error(`Failed to persist ${table}: ${error.message}`);
  }

  if (!data?.length) {
    throw new Error(`Failed to persist ${table}: insert did not return ids.`);
  }

  return data.map((row) => row.id);
}

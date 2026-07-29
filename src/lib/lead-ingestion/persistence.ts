import { type SupabaseClient } from "@supabase/supabase-js";

import { pickLastTouchAttribution, type LeadIngestionResult, type ParsedLeadIngestionInput, type ResolvedAttribution } from "../../domain";

/** How far back an outbound touch can be and still attribute an inbound lead. */
const LAST_TOUCH_WINDOW_DAYS = 30;

type AcceptedLeadIngestionResult = Extract<LeadIngestionResult, { ok: true }>;

export type LeadProvenance = {
  origin: "operator" | "agent";
  reviewStatus: "active" | "proposed" | "dismissed";
  agentConfidence?: number | null;
};

type PersistLeadInput = {
  input: ParsedLeadIngestionInput;
  result: AcceptedLeadIngestionResult;
  supabase: SupabaseClient;
  orgId: string;
  /** When set, stamps companies/contacts/properties/leads with origin + review_status. */
  provenance?: LeadProvenance;
  /** Pre-resolved (deduped) ids to reuse instead of inserting. */
  existing?: {
    companyId?: string | null;
    contactId?: string | null;
    propertyId?: string | null;
    /** When set, the matching lead is UPDATED in place instead of inserting a new row. */
    leadId?: string | null;
  };
};

type InsertResult = {
  id: string;
};

export type PersistedLeadIngestion = {
  companyId: string | null;
  contactId: string | null;
  propertyId: string | null;
  leadId: string;
  /** false when an existing lead was updated rather than inserted. */
  leadCreated: boolean;
};

export async function persistLeadIngestion({
  input,
  result,
  supabase,
  orgId,
  provenance,
  existing,
}: PersistLeadInput): Promise<PersistedLeadIngestion> {
  const stamp = provenance
    ? { origin: provenance.origin, review_status: provenance.reviewStatus }
    : {};

  // A partial address can't become a `properties` row (all four address columns
  // are NOT NULL), so preserve it as structured location metadata instead of
  // dropping it. Attached to both the company and lead so it surfaces either way.
  const locationMetadata = toLocationMetadata(input.location);

  const companyId = existing?.companyId
    ? existing.companyId
    : input.company
      ? await insertAndReturnId(supabase, "companies", orgId, {
          name: input.company.name,
          persona: result.persona,
          partner_tier: input.company.partnerTier ?? null,
          ...stamp,
          metadata: {
            network_connection: input.company.networkConnection ?? null,
            ingestion_source: input.source,
            ...(locationMetadata ? { location: locationMetadata } : {}),
          },
        })
      : null;

  const contactId = existing?.contactId
    ? existing.contactId
    : input.contact
      ? await insertAndReturnId(supabase, "contacts", orgId, {
          company_id: companyId,
          persona: result.persona,
          first_name: input.contact.firstName ?? null,
          last_name: input.contact.lastName ?? null,
          email: input.contact.email ?? null,
          phone: input.contact.phone ?? null,
          ...stamp,
          metadata: {
            ingestion_source: input.source,
          },
        })
      : null;

  const propertyId = existing?.propertyId
    ? existing.propertyId
    : input.property
      ? await insertAndReturnId(supabase, "properties", orgId, {
          company_id: companyId,
          contact_id: contactId,
          persona: result.persona,
          street_line_1: input.property.streetLine1,
          street_line_2: input.property.streetLine2 ?? null,
          city: input.property.city,
          state: input.property.state.toUpperCase(),
          postal_code: input.property.postalCode,
          ...stamp,
          metadata: {
            ingestion_source: input.source,
          },
        })
      : null;

  // Last-touch backfill: a lead that carried no campaign of its own still counts
  // toward the campaign that last reached this contact. Fills attribution from the
  // most recent outbound touch (recorded at dispatch) so the loop self-completes
  // even without the landing page forwarding a bsg_at token. Lowest precedence —
  // only runs when nothing else attributed the lead.
  const attribution = await resolveLastTouchAttribution(supabase, orgId, contactId, result.attribution);

  const leadValues = {
    // Only set when the caller supplied real history (a CSV import carrying a
    // last-contacted date). Omitted otherwise so the column default of now()
    // still applies to genuinely new leads.
    ...(input.receivedAt ? { received_at: input.receivedAt } : {}),
    company_id: companyId,
    contact_id: contactId,
    property_id: propertyId,
    persona: result.persona,
    status: result.routing === "archived" ? "archived" : "validated",
    routing_recommendation: toDatabaseRoutingRecommendation(result.routing),
    source: input.source,
    external_lead_id: input.externalLeadId ?? null,
    loss_summary: input.lossSummary ?? null,
    loss_signals: input.lossSignals,
    matched_target_keywords: result.classification.matchedTargetKeywords,
    matched_non_target_keywords: result.classification.matchedNonTargetKeywords,
    lead_score: result.scores.leadScore,
    attributed_campaign_id: attribution.campaignId,
    attributed_asset_id: attribution.assetId,
    attribution_channel: attribution.channel,
    attribution_method: attribution.method,
    attribution_utm: attribution.utm,
    ...stamp,
    agent_confidence: provenance?.agentConfidence ?? null,
    metadata: {
      ...input.metadata,
      classification: result.classification.classification,
      partner_score: result.scores.partnerScore,
      calculated_at: result.scores.calculatedAt,
      ...(locationMetadata ? { location: locationMetadata } : {}),
    },
  };

  let leadId: string;
  let leadCreated: boolean;
  if (existing?.leadId) {
    const { data, error } = await supabase
      .from("leads")
      .update({ ...leadValues, updated_at: new Date().toISOString() })
      .eq("id", existing.leadId)
      .eq("org_id", orgId)
      .select("id")
      .single<InsertResult>();
    if (error) throw new Error(`Failed to update lead: ${error.message}`);
    if (!data?.id) throw new Error("Failed to update lead: no row matched.");
    leadId = data.id;
    leadCreated = false;
  } else {
    leadId = await insertAndReturnId(supabase, "leads", orgId, leadValues);
    leadCreated = true;
  }

  // Best-effort Brain mirror of the new lead (recall degrades gracefully without it).
  try {
    const { syncRecordToBrain } = await import("@/lib/brain-ingestion/sync");
    await syncRecordToBrain("leads", leadId, { client: supabase, orgId });
  } catch { /* ignore */ }

  return { companyId, contactId, propertyId, leadId, leadCreated };
}

/**
 * Normalizes a parsed partial-address `location` block into the snake_case shape
 * stored in metadata, dropping absent fields and upper-casing the state code.
 * Returns null when there is no location to persist.
 */
function toLocationMetadata(
  location: ParsedLeadIngestionInput["location"],
): Record<string, string> | null {
  if (!location) {
    return null;
  }

  const entries: Array<[string, string | undefined]> = [
    ["street_line_1", location.streetLine1],
    ["street_line_2", location.streetLine2],
    ["city", location.city],
    ["state", location.state?.toUpperCase()],
    ["postal_code", location.postalCode],
  ];

  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (value) {
      out[key] = value;
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

type TouchRow = {
  campaign_id: string | null;
  campaign_asset_id: string | null;
  channel: string | null;
  occurred_at: string | null;
};

/**
 * When the lead resolved to no campaign of its own, attribute it to the most
 * recent outbound campaign touch to the same contact (recorded at dispatch in
 * engagement_events). Best-effort and read-only — any lookup failure or absent
 * contact simply leaves the resolved attribution unchanged.
 */
async function resolveLastTouchAttribution(
  supabase: SupabaseClient,
  orgId: string,
  contactId: string | null,
  resolved: ResolvedAttribution,
): Promise<ResolvedAttribution> {
  if (resolved.method !== "unattributed" || !contactId) return resolved;

  // Best-effort: any lookup failure (or a client that can't serve the query)
  // must leave ingestion untouched — attribution enrichment never blocks a lead.
  try {
    const cutoff = new Date(Date.now() - LAST_TOUCH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("engagement_events")
      .select("campaign_id,campaign_asset_id,channel,occurred_at")
      .eq("org_id", orgId)
      .eq("contact_id", contactId)
      .eq("direction", "outbound")
      .gte("occurred_at", cutoff)
      .order("occurred_at", { ascending: false })
      .limit(20);
    if (error || !data) return resolved;

    const touch = pickLastTouchAttribution(
      (data as TouchRow[]).map((r) => ({
        campaignId: r.campaign_id,
        assetId: r.campaign_asset_id,
        channel: r.channel,
        occurredAt: r.occurred_at,
      })),
      Date.now(),
      LAST_TOUCH_WINDOW_DAYS,
    );
    return touch ?? resolved;
  } catch {
    return resolved;
  }
}

function toDatabaseRoutingRecommendation(routing: AcceptedLeadIngestionResult["routing"]) {
  if (routing === "needs_review") {
    return "target";
  }

  return routing;
}

async function insertAndReturnId(
  supabase: SupabaseClient,
  table: "companies" | "contacts" | "properties" | "leads",
  orgId: string,
  values: Record<string, unknown>,
) {
  const { data, error } = await supabase.from(table).insert({ ...values, org_id: orgId }).select("id").single<InsertResult>();

  if (error) {
    throw new Error(`Failed to persist ${table}: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error(`Failed to persist ${table}: insert did not return an id.`);
  }

  return data.id;
}

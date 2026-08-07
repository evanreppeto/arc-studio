import { type SupabaseClient } from "@supabase/supabase-js";
import { reportDegraded } from "@/lib/observability/report-degraded";
import { unavailableRead } from "@/lib/observability/unavailable";

import {
  DEFAULT_PIPELINE_STAGES,
  findStage,
  isLostStatus,
  isPipelineObjectKey,
  isWonStatus,
  orderedStages,
  statusAccent,
  statusTone,
  type PipelineObjectKey,
  type PipelineStage,
  type PipelineTone,
} from "@/domain";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { getPipelineStages } from "@/lib/pipeline-stages/read-model";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "../supabase/server";
import { requireCount } from "../supabase/count";
import { resolveTenantReadHandle } from "../supabase/tenant-client";

export type CrmTone = "amber" | "green" | "red" | "blue";

export type CrmPipelineRow = {
  id: string;
  record: string;
  account: string;
  type: string;
  objectType: "lead" | "job" | "partner";
  stage: string;
  owner: string;
  value: string;
  nextStep: string;
  updated: string;
  score: number;
  personaTag: string;
  serviceTags: string[];
  urgencyTag: string;
  sourceTag: string;
  lifecycleTag: string;
  missingTags: string[];
  href: string;
  tone: CrmTone;
};

export type CrmWorkspaceStat = {
  /**
   * Which CRM object this stat counts, when it counts one.
   *
   * The label below is a FALLBACK. This read-model has no workspace vocabulary,
   * so it cannot know that `companies` is "Organizations" here and "Accounts"
   * there — and hardcoding a noun put "Companies" in the header directly above a
   * tab reading "Organizations", the same number under two different names.
   * BSR-656 made the header count the same records as the tabs; this makes it
   * call them the same thing. The page relabels from `getProductLanguage`.
   */
  objectKey?: CrmObjectKey;
  /** Word after the object noun, if any: "Leads **found**", "Projects **tracked**". */
  qualifier?: string;
  label: string;
  value: number | string;
  delta: string;
  forecast: string;
};

export type CrmObjectRow = {
  id: string;
  name: string;
  detail: string;
  /** The tenant's own word for the stage this record sits in. */
  status: string;
  /**
   * Display tone for that status, resolved HERE rather than in the page.
   *
   * The page only receives the label, and a label is exactly what stops being
   * readable once a tenant renames a stage — "Retained" matches none of the
   * won patterns. Deciding the tone next to the stage set, where the semantic
   * flags are, is what keeps the pill honest after a rename.
   */
  statusTone: PipelineTone;
  owner: string;
  updated: string;
  objectKey: CrmObjectKey;
  href: string;
  personaTag: string;
  sourceLabel: string;
  score: number | null;
  valueLabel: string;
  nextStep: string;
  relationships: CrmRecordRelationship[];
  missingFields: string[];
  /** Open follow-up tasks (crm_tasks) attached to this record. Decorated post-build; optional so the row builds without it. */
  openTasks?: number;
  /**
   * When this record was archived, or null while it is live.
   *
   * Archived is a COLUMN, not a status value (20260806120000). It used to be a
   * status, which three of the six objects have no room for — properties has no
   * status column at all, and jobs/outcomes statuses are the tenant's own
   * pipeline stages, where writing "archived" invents a stage they never
   * defined. Reading the column means every object can answer the question the
   * same way, and a renamed stage cannot change the answer.
   */
  archivedAt: string | null;
};

export type CrmObjectData = {
  status: "live";
  key: CrmObjectKey;
  label: string;
  href: string;
  description: string;
  count: number;
  relationships: string;
  lastActivity: string;
  primaryField: string;
  secondaryField: string;
  sampleRows: CrmObjectRow[];
};

export type CrmObjectKey = "companies" | "contacts" | "properties" | "leads" | "jobs" | "outcomes";

export type CrmOverviewData =
  | {
      status: "live";
      stats: CrmWorkspaceStat[];
      rows: CrmPipelineRow[];
    }
  | {
      status: "unavailable";
      message: string;
    };

export type CrmNavCounts =
  | {
      status: "live";
      counts: Record<CrmObjectKey, number>;
    }
  | {
      status: "unavailable";
      message: string;
    };

export type CrmObjectReadResult =
  | CrmObjectData
  | {
      status: "unavailable";
      message: string;
    };

export type CrmRecordField = {
  label: string;
  value: string;
};

export type CrmRecordRelationship = {
  label: string;
  value: string;
  href: string;
};

export type CrmRecordMetric = {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "ok" | "amber" | "red" | "accent";
};

export type CrmRecordScoreBar = {
  label: string;
  value: number | null;
  max?: number;
  caption?: string;
  tone?: "ok" | "amber" | "red" | "accent";
};

export type CrmRecordQualityItem = {
  label: string;
  present: boolean;
};

/** A node in the small relationship graph rendered on the detail page. */
export type CrmRecordGraphNode = {
  id: string;
  label: string;
  kind: "self" | "company" | "contact" | "property" | "lead" | "job" | "outcome";
  href?: string;
};

export type CrmRecordData = {
  status: "live";
  key: CrmObjectKey;
  label: string;
  href: string;
  id: string;
  name: string;
  detail: string;
  lifecycleStatus: string;
  owner: string;
  updated: string;
  persona: string;
  confidence: string;
  journeyStage: string;
  urgency: string;
  leadScore: number | null;
  partnerScore: number | null;
  revenueScore: string | null;
  attentionReason: string;
  nextBestAction: string;
  cta: string;
  messageAngle: string;
  guardrailStatus: string;
  proofPoints: string[];
  evidence: Array<{ label: string; href?: string | null; detail?: string | null }>;
  fields: CrmRecordField[];
  relationships: CrmRecordRelationship[];
  missingFields: string[];
  /** Headline metric chips rendered in the record header band. Additive. */
  /** Larger KPI strip shown above the detail body (companies/jobs/outcomes). Additive. */
  quickStats: CrmRecordMetric[];
  /** Score bars (lead / relationship / revenue signal) for the intelligence rail. Additive. */
  scoreBars: CrmRecordScoreBar[];
  /** Engagement / activity counters surfaced in the body. Additive. */
  engagement: CrmRecordMetric[];
  /** Data-contract completeness checklist for the provenance card. Additive. */
  dataQuality: CrmRecordQualityItem[];
  /** Nodes for the small relationship graph (self is always first). Additive. */
  graph: CrmRecordGraphNode[];
  /** Who created this record: 'agent' = Arc, 'operator' = human. */
  origin: "operator" | "agent";
};

export type CrmRecordReadResult =
  | CrmRecordData
  | {
      status: "unavailable";
      message: string;
    }
  | {
      status: "not_found";
    };

const CRM_TABLE_BUNDLE_LIMIT = 1000;

type CrmBundleShape = {
  companies: CompanyRow[];
  contacts: ContactRow[];
  properties: PropertyRow[];
  leads: LeadRow[];
  jobs: JobRow[];
  outcomes: OutcomeRow[];
  /**
   * The org's own pipeline stages, carried on the bundle so every builder below
   * can ask a status what it MEANS instead of comparing it to "won".
   *
   * On the bundle rather than threaded through a dozen signatures because these
   * builders are called from six entry points; a parameter would have been
   * optional at each one, and an optional stage set is one that gets forgotten.
   */
  stages: Record<PipelineObjectKey, PipelineStage[]>;
};

/** The stage a record's status refers to, or null when it maps to none. */
function stageFor(data: CrmBundleShape, objectKey: PipelineObjectKey, status: string | null | undefined) {
  return findStage(data.stages[objectKey], status);
}

/**
 * The tenant's own word for a stage.
 *
 * Falls back to titleizing the stored key, which is exactly what every call
 * site below did before — so an unmapped status still reads as something rather
 * than blank, and a workspace on the default stages sees the same words it
 * always has.
 */
function stageLabel(
  stages: readonly PipelineStage[],
  status: string | null | undefined,
  fallback: string,
): string {
  return findStage(stages, status)?.label ?? titleize(status ?? fallback);
}

/**
 * The tenant's word for winning, lowercased, for use inside a sentence.
 *
 * These KPI deltas read "12 completed" / "9 won outcomes". Once a workspace
 * renames its closing stage, our word for it is simply wrong — the count would
 * be right and the label would still say someone else's vocabulary. Uses the
 * first won stage; a pipeline with two (the default outcomes set has Won and
 * Paid) is summarised by the earlier one.
 */
function wonWord(stages: readonly PipelineStage[], fallback: string): string {
  const won = orderedStages(stages).find((stage) => stage.isWon);
  return (won?.label ?? fallback).toLowerCase();
}

// ---------------------------------------------------------------------------
// Demo fallback bundle
// ---------------------------------------------------------------------------
// When Supabase is not configured (local preview) — or when a live query comes
// back empty — the CRM should still render a believable Meridian
// pipeline instead of an "unavailable" / empty state. This is
// read-only display data. It is routed through the same builder functions as
// live rows so personas, scores, tags, and readiness logic stay consistent.

function ts(daysAgo: number, hoursAgo = 0): string {
  return new Date(Date.now() - daysAgo * 86_400_000 - hoursAgo * 3_600_000).toISOString();
}

function buildDemoCrmBundle(): CrmBundleShape {
  const companies: CompanyRow[] = [
    {
      id: "demo-co-northside-plumbing",
      name: "Larkfield Partners",
      persona: "persona_plumbing_partner",
      status: "active",
      website_url: "https://larkfieldpartners.example",
      phone: "312-555-0142",
      email: "partners@larkfieldpartners.example",
      partner_tier: "A",
      metadata: { partner_score: 91, owner: "Robby", service_area_zips: ["60618", "60625", "60647"], confidence: "High" },
      created_at: ts(180),
      updated_at: ts(0, 3),
    },
    {
      id: "demo-co-lakeview-property",
      name: "Lakeview Digital",
      persona: "persona_property_manager",
      status: "active",
      website_url: "https://lakeviewdigital.example",
      phone: "773-555-0188",
      email: "ops@lakeviewdigital.example",
      partner_tier: "A",
      metadata: { partner_score: 88, owner: "Robby", portfolio_units: 1240, confidence: "High" },
      created_at: ts(220),
      updated_at: ts(0, 6),
    },
    {
      id: "demo-co-harborpoint-hoa",
      name: "Harbor Point Group",
      persona: "persona_hoa_board",
      status: "active",
      website_url: "https://harborpointgroup.example",
      phone: "847-555-0119",
      email: "team@harborpointgroup.example",
      partner_tier: "B",
      metadata: { partner_score: 74, owner: "Robby", confidence: "Medium" },
      created_at: ts(140),
      updated_at: ts(2),
    },
    {
      id: "demo-co-summit-facilities",
      name: "Summit Systems",
      persona: "persona_property_manager",
      status: "active",
      website_url: "https://summitsystems.example",
      phone: "630-555-0173",
      email: "ops@summitsystems.example",
      partner_tier: "B",
      metadata: { partner_score: 79, owner: "Robby", confidence: "Medium" },
      created_at: ts(95),
      updated_at: ts(1),
    },
    {
      id: "demo-co-evanston-insurance",
      name: "Evanston Analytics",
      persona: "persona_insurance_agent",
      status: "active",
      website_url: "https://evanstonanalytics.example",
      phone: "847-555-0204",
      email: "procurement@evanstonanalytics.example",
      partner_tier: "A",
      metadata: { partner_score: 85, owner: "Robby", confidence: "High" },
      created_at: ts(260),
      updated_at: ts(4),
    },
    {
      id: "demo-co-elmwood-realty",
      name: "Elmwood Group",
      persona: "persona_listing_agent",
      status: "active",
      website_url: "https://elmwoodgroup.example",
      phone: "708-555-0150",
      email: "hello@elmwoodgroup.example",
      partner_tier: "C",
      metadata: { partner_score: 61, owner: "Robby", confidence: "Medium" },
      created_at: ts(70),
      updated_at: ts(5),
    },
    {
      id: "demo-co-prairie-gc",
      name: "Prairie Systems",
      persona: "persona_gc_remodeler_partner",
      status: "active",
      website_url: "https://prairiesystems.example",
      phone: "815-555-0166",
      email: "partners@prairiesystems.example",
      partner_tier: "B",
      metadata: { partner_score: 72, owner: "Robby", confidence: "Medium" },
      created_at: ts(110),
      updated_at: ts(8),
    },
    {
      id: "demo-co-private-homeowner",
      name: "Individual Evaluator",
      persona: "persona_homeowner_emergency",
      status: "active",
      website_url: null,
      phone: null,
      email: null,
      partner_tier: null,
      metadata: { owner: "Robby" },
      created_at: ts(3),
      updated_at: ts(0, 1),
    },
  ];

  const contacts: ContactRow[] = [
    {
      id: "demo-ct-daniel-harper",
      company_id: "demo-co-northside-plumbing",
      persona: "persona_plumbing_partner",
      status: "active",
      first_name: "Daniel",
      last_name: "Harper",
      full_name: "Daniel Harper",
      email: "daniel.harper@larkfieldpartners.example",
      phone: "312-555-0198",
      title: "Operations Manager",
      metadata: { owner: "Robby", relationship_stage: "engaged", confidence: "High" },
      created_at: ts(180),
      updated_at: ts(0, 3),
    },
    {
      id: "demo-ct-marisa-nolan",
      company_id: "demo-co-lakeview-property",
      persona: "persona_property_manager",
      status: "active",
      first_name: "Marisa",
      last_name: "Nolan",
      full_name: "Marisa Nolan",
      email: "marisa.nolan@lakeviewdigital.example",
      phone: "773-555-0144",
      title: "Director of Operations",
      metadata: { owner: "Robby", relationship_stage: "engaged", confidence: "High" },
      created_at: ts(220),
      updated_at: ts(0, 6),
    },
    {
      id: "demo-ct-andre-whitfield",
      company_id: "demo-co-harborpoint-hoa",
      persona: "persona_hoa_board",
      status: "active",
      first_name: "Andre",
      last_name: "Whitfield",
      full_name: "Andre Whitfield",
      email: "andre.whitfield@harborpointgroup.example",
      phone: "847-555-0121",
      title: "VP of Engineering",
      metadata: { owner: "Robby", relationship_stage: "new_target" },
      created_at: ts(140),
      updated_at: ts(2),
    },
    {
      id: "demo-ct-tasha-greene",
      company_id: "demo-co-evanston-insurance",
      persona: "persona_insurance_agent",
      status: "active",
      first_name: "Tasha",
      last_name: "Greene",
      full_name: "Tasha Greene",
      email: "tasha.greene@evanstonanalytics.example",
      phone: "847-555-0207",
      title: "Senior Procurement Manager",
      metadata: { owner: "Robby", relationship_stage: "engaged", confidence: "High" },
      created_at: ts(260),
      updated_at: ts(4),
    },
    {
      id: "demo-ct-victor-reyes",
      company_id: "demo-co-summit-facilities",
      persona: "persona_property_manager",
      status: "active",
      first_name: "Victor",
      last_name: "Reyes",
      full_name: "Victor Reyes",
      email: "victor.reyes@summitsystems.example",
      phone: "630-555-0177",
      title: "IT Operations Manager",
      metadata: { owner: "Robby", relationship_stage: "qualified" },
      created_at: ts(95),
      updated_at: ts(1),
    },
    {
      id: "demo-ct-claire-donovan",
      company_id: "demo-co-private-homeowner",
      persona: "persona_homeowner_emergency",
      status: "active",
      first_name: "Claire",
      last_name: "Donovan",
      full_name: "Claire Donovan",
      email: "claire.donovan@example.com",
      phone: "312-555-0233",
      title: null,
      metadata: { owner: "Robby" },
      created_at: ts(3),
      updated_at: ts(0, 1),
    },
    {
      id: "demo-ct-owen-marsh",
      company_id: "demo-co-elmwood-realty",
      persona: "persona_listing_agent",
      status: "active",
      first_name: "Owen",
      last_name: "Marsh",
      full_name: "Owen Marsh",
      email: "owen.marsh@elmwoodgroup.example",
      phone: "708-555-0159",
      title: "Founder",
      metadata: { owner: "Robby", relationship_stage: "new_target" },
      created_at: ts(70),
      updated_at: ts(5),
    },
  ];

  const properties: PropertyRow[] = [
    {
      id: "demo-pr-clark-st",
      company_id: "demo-co-lakeview-property",
      contact_id: "demo-ct-marisa-nolan",
      persona: "persona_property_manager",
      street_line_1: "2340 N Clark St",
      street_line_2: "Unit 4B",
      city: "Chicago",
      state: "IL",
      postal_code: "60614",
      property_type: "multifamily",
      metadata: {},
      created_at: ts(120),
      updated_at: ts(2),
    },
    {
      id: "demo-pr-harbor-tower",
      company_id: "demo-co-harborpoint-hoa",
      contact_id: "demo-ct-andre-whitfield",
      persona: "persona_hoa_board",
      street_line_1: "150 Harbor Point Dr",
      street_line_2: null,
      city: "Chicago",
      state: "IL",
      postal_code: "60601",
      property_type: "condominium",
      metadata: {},
      created_at: ts(140),
      updated_at: ts(2),
    },
    {
      id: "demo-pr-summit-warehouse",
      company_id: "demo-co-summit-facilities",
      contact_id: "demo-ct-victor-reyes",
      persona: "persona_property_manager",
      street_line_1: "880 Commerce Pkwy",
      street_line_2: null,
      city: "Aurora",
      state: "IL",
      postal_code: "60563",
      property_type: "commercial",
      metadata: {},
      created_at: ts(95),
      updated_at: ts(1),
    },
    {
      id: "demo-pr-donovan-home",
      company_id: "demo-co-private-homeowner",
      contact_id: "demo-ct-claire-donovan",
      persona: "persona_homeowner_emergency",
      street_line_1: "517 Elm Ave",
      street_line_2: null,
      city: "Oak Park",
      state: "IL",
      postal_code: "60302",
      property_type: "single_family",
      metadata: {},
      created_at: ts(3),
      updated_at: ts(0, 1),
    },
    {
      id: "demo-pr-evanston-duplex",
      company_id: "demo-co-elmwood-realty",
      contact_id: "demo-ct-owen-marsh",
      persona: "persona_listing_agent",
      street_line_1: "1209 Maple Ave",
      street_line_2: null,
      city: "Evanston",
      state: "IL",
      postal_code: "60202",
      property_type: "single_family",
      metadata: {},
      created_at: ts(70),
      updated_at: ts(5),
    },
  ];

  const leads: LeadRow[] = [
    {
      id: "demo-ld-donovan-basement",
      company_id: "demo-co-private-homeowner",
      contact_id: "demo-ct-claire-donovan",
      property_id: "demo-pr-donovan-home",
      persona: "persona_homeowner_emergency",
      status: "needs_review",
      routing_recommendation: "dispatch",
      source: "web_form",
      loss_summary: "Trial user activated their workspace overnight and invited five teammates; hit the plan's seat limit within hours.",
      loss_signals: ["trial_active", "seat_limit_reached", "team_invites"],
      lead_score: 92,
      received_at: ts(0, 1),
      metadata: {
        confidence: "High",
        reason_found: "After-hours signup with rapid team activation and high buying intent.",
        recommended_action: "Reach out with a tailored walkthrough and confirm plan fit.",
        evidence_urls: ["https://larkfieldpartners.example/referral/donovan"],
        urgency: "high_value_urgent",
      },
      created_at: ts(0, 1),
      updated_at: ts(0, 1),
    },
    {
      id: "demo-ld-northside-referral",
      company_id: "demo-co-northside-plumbing",
      contact_id: "demo-ct-daniel-harper",
      property_id: null,
      persona: "persona_plumbing_partner",
      status: "needs_review",
      routing_recommendation: "target",
      source: "partner_referral",
      loss_summary: "Partner referred an account evaluating Meridian for a distributed team after an internal tooling review.",
      loss_signals: ["partner_referral", "evaluating_tools", "team_expansion"],
      lead_score: 88,
      received_at: ts(0, 3),
      metadata: {
        confidence: "High",
        reason_found: "Trusted Tier-A partner referral from a priority account segment.",
        recommended_action: "Approve lead and review partner outreach campaign draft.",
        evidence_urls: ["https://larkfieldpartners.example"],
        urgency: "high_value_urgent",
      },
      created_at: ts(0, 3),
      updated_at: ts(0, 3),
    },
    {
      id: "demo-ld-lakeview-mold",
      company_id: "demo-co-lakeview-property",
      contact_id: "demo-ct-marisa-nolan",
      property_id: "demo-pr-clark-st",
      persona: "persona_property_manager",
      status: "qualified",
      routing_recommendation: "estimate",
      source: "account_review",
      loss_summary: "Recurring workflow bottleneck surfaced across two teams during a quarterly account review.",
      loss_signals: ["usage_growth", "multi_team", "expansion_signal"],
      lead_score: 81,
      received_at: ts(1),
      metadata: {
        confidence: "High",
        recommended_action: "Schedule a tailored walkthrough and prepare a multi-team expansion quote.",
        evidence_urls: ["https://lakeviewdigital.example/review/clark-st"],
        urgency: "review_next",
      },
      created_at: ts(1),
      updated_at: ts(0, 6),
    },
    {
      id: "demo-ld-harbor-roof",
      company_id: "demo-co-harborpoint-hoa",
      contact_id: "demo-ct-andre-whitfield",
      property_id: "demo-pr-harbor-tower",
      persona: "persona_hoa_board",
      status: "new",
      routing_recommendation: "estimate",
      source: "intent_signal",
      loss_summary: "Pricing-page surge from a buying committee evaluating Meridian for a company-wide rollout.",
      loss_signals: ["pricing_page_visit", "committee_evaluation", "company_wide"],
      lead_score: 67,
      received_at: ts(2),
      metadata: {
        confidence: "Medium",
        recommended_action: "Confirm the committee's decision process and offer a company-wide walkthrough.",
        urgency: "review_next",
      },
      created_at: ts(2),
      updated_at: ts(2),
    },
    {
      id: "demo-ld-summit-sprinkler",
      company_id: "demo-co-summit-facilities",
      contact_id: "demo-ct-victor-reyes",
      property_id: "demo-pr-summit-warehouse",
      persona: "persona_property_manager",
      status: "qualified",
      routing_recommendation: "estimate",
      source: "inbound_call",
      loss_summary: "Usage spiked across 6,000 monthly active users during an enterprise pilot.",
      loss_signals: ["usage_spike", "enterprise_pilot", "large_account"],
      lead_score: 84,
      received_at: ts(1, 4),
      metadata: {
        confidence: "High",
        recommended_action: "Prepare an enterprise rollout plan and expansion quote.",
        evidence_urls: ["https://summitsystems.example/pilot/4471"],
        urgency: "high_value_urgent",
      },
      created_at: ts(1, 4),
      updated_at: ts(1),
    },
    {
      id: "demo-ld-evanston-claim",
      company_id: "demo-co-evanston-insurance",
      contact_id: "demo-ct-tasha-greene",
      property_id: null,
      persona: "persona_insurance_agent",
      status: "qualified",
      routing_recommendation: "target",
      source: "partner_referral",
      loss_summary: "Procurement flagged a migration off a legacy tool needing data import, onboarding, and rollout coordination.",
      loss_signals: ["tool_migration", "onboarding", "data_import"],
      lead_score: 79,
      received_at: ts(3),
      metadata: {
        confidence: "High",
        recommended_action: "Confirm scope and provide a procurement-ready security and pricing packet.",
        evidence_urls: ["https://evanstonanalytics.example/review/8821"],
        urgency: "review_next",
      },
      created_at: ts(3),
      updated_at: ts(4, 2),
    },
    {
      id: "demo-ld-elmwood-listing",
      company_id: "demo-co-elmwood-realty",
      contact_id: "demo-ct-owen-marsh",
      property_id: "demo-pr-evanston-duplex",
      persona: "persona_listing_agent",
      status: "new",
      routing_recommendation: "nurture",
      source: "agent_outreach",
      loss_summary: "Founder needs a quick workspace cleanup and setup before an all-hands rollout.",
      loss_signals: ["setup_help", "quick_win", "pre_rollout"],
      lead_score: 58,
      received_at: ts(5),
      metadata: {
        confidence: "Medium",
        recommended_action: "Send onboarding options and a simple starter quote.",
        urgency: "needs_enrichment",
      },
      created_at: ts(5),
      updated_at: ts(5),
    },
    {
      id: "demo-ld-prairie-rebuild",
      company_id: "demo-co-prairie-gc",
      contact_id: null,
      property_id: null,
      persona: "persona_gc_remodeler_partner",
      status: "new",
      routing_recommendation: "target",
      source: "partner_referral",
      loss_summary: "Agency partner has a client migration and wants a trial-to-onboarding handoff.",
      loss_signals: ["tool_migration", "onboarding", "partner_handoff"],
      lead_score: 71,
      received_at: ts(6),
      metadata: {
        confidence: "Medium",
        recommended_action: "Align scope split and confirm referral handoff process.",
        urgency: "review_next",
      },
      created_at: ts(6),
      updated_at: ts(6),
    },
    {
      id: "demo-ld-wicker-sewer",
      company_id: null,
      contact_id: null,
      property_id: null,
      persona: "persona_homeowner_emergency",
      status: "new",
      routing_recommendation: "dispatch",
      source: "web_form",
      loss_summary: "Trial user hit repeated errors during setup; blocked onboarding and at risk of churning.",
      loss_signals: ["onboarding_blocked", "setup_errors", "churn_risk"],
      lead_score: 76,
      received_at: ts(0, 9),
      metadata: {
        confidence: "Medium",
        recommended_action: "Reach out and confirm the onboarding blocker is cleared.",
        urgency: "high_value_urgent",
      },
      created_at: ts(0, 9),
      updated_at: ts(0, 9),
    },
    {
      id: "demo-ld-skokie-preventative",
      company_id: null,
      contact_id: null,
      property_id: null,
      persona: "persona_homeowner_preventative",
      status: "lost",
      routing_recommendation: "nurture",
      source: "web_form",
      loss_summary: "Evaluator inquired about a workflow add-on but chose a point solution instead.",
      loss_signals: ["evaluating", "add_on_interest"],
      lead_score: 41,
      received_at: ts(9),
      metadata: {
        confidence: "Low",
        recommended_action: "Archive and add to the long-term nurture list.",
        urgency: "needs_enrichment",
      },
      created_at: ts(9),
      updated_at: ts(7),
    },
    {
      id: "demo-ld-berwyn-landlord",
      company_id: null,
      contact_id: null,
      property_id: null,
      persona: "persona_landlord",
      status: "converted",
      routing_recommendation: "estimate",
      source: "referral",
      loss_summary: "Multi-account owner consolidated several team workspaces; onboarding completed and expansion booked.",
      loss_signals: ["consolidation", "expansion", "multi_account"],
      lead_score: 73,
      received_at: ts(14),
      metadata: {
        confidence: "High",
        recommended_action: "Track the expansion rollout and capture outcome.",
        urgency: "review_next",
      },
      created_at: ts(14),
      updated_at: ts(8),
    },
  ];

  const jobs: JobRow[] = [
    {
      id: "demo-jb-summit-dryout",
      lead_id: "demo-ld-summit-sprinkler",
      company_id: "demo-co-summit-facilities",
      contact_id: "demo-ct-victor-reyes",
      property_id: "demo-pr-summit-warehouse",
      persona: "persona_property_manager",
      status: "in_progress",
      job_number: "MRD-2041",
      scheduled_at: ts(-1),
      completed_at: null,
      estimated_revenue_cents: 4_820_000,
      metadata: { owner: "Ops", service_tags: ["enterprise_pilot", "large_account"] },
      created_at: ts(1),
      updated_at: ts(0, 5),
    },
    {
      id: "demo-jb-lakeview-mold",
      lead_id: "demo-ld-lakeview-mold",
      company_id: "demo-co-lakeview-property",
      contact_id: "demo-ct-marisa-nolan",
      property_id: "demo-pr-clark-st",
      persona: "persona_property_manager",
      status: "scheduled",
      job_number: "MRD-2038",
      scheduled_at: ts(-3),
      completed_at: null,
      estimated_revenue_cents: 1_640_000,
      metadata: { owner: "Ops", service_tags: ["multi_team", "expansion_signal"] },
      created_at: ts(1),
      updated_at: ts(0, 6),
    },
    {
      id: "demo-jb-berwyn-rebuild",
      lead_id: "demo-ld-berwyn-landlord",
      company_id: null,
      contact_id: null,
      property_id: null,
      persona: "persona_landlord",
      status: "in_progress",
      job_number: "MRD-2019",
      scheduled_at: ts(6),
      completed_at: null,
      estimated_revenue_cents: 2_180_000,
      metadata: { owner: "Ops", service_tags: ["consolidation", "expansion"] },
      created_at: ts(13),
      updated_at: ts(2),
    },
    {
      id: "demo-jb-evanston-fire",
      lead_id: "demo-ld-evanston-claim",
      company_id: "demo-co-evanston-insurance",
      contact_id: "demo-ct-tasha-greene",
      property_id: null,
      persona: "persona_insurance_agent",
      status: "completed",
      job_number: "MRD-1994",
      scheduled_at: ts(22),
      completed_at: ts(9),
      estimated_revenue_cents: 6_350_000,
      metadata: { owner: "Ops", service_tags: ["tool_migration", "onboarding"] },
      created_at: ts(24),
      updated_at: ts(9),
    },
  ];

  const outcomes: OutcomeRow[] = [
    {
      id: "demo-oc-evanston-fire",
      job_id: "demo-jb-evanston-fire",
      lead_id: "demo-ld-evanston-claim",
      company_id: "demo-co-evanston-insurance",
      contact_id: "demo-ct-tasha-greene",
      property_id: null,
      persona: "persona_insurance_agent",
      status: "won",
      gross_revenue_cents: 6_350_000,
      gross_margin_cents: 2_410_000,
      closed_at: ts(9),
      metadata: { owner: "Revenue", attribution: "partner_referral" },
      created_at: ts(9),
      updated_at: ts(9),
    },
    {
      id: "demo-oc-rogers-water",
      job_id: null,
      lead_id: null,
      company_id: "demo-co-northside-plumbing",
      contact_id: "demo-ct-daniel-harper",
      property_id: null,
      persona: "persona_plumbing_partner",
      status: "won",
      gross_revenue_cents: 1_870_000,
      gross_margin_cents: 720_000,
      closed_at: ts(16),
      metadata: { owner: "Revenue", attribution: "partner_referral" },
      created_at: ts(16),
      updated_at: ts(16),
    },
    {
      id: "demo-oc-skokie-lost",
      job_id: null,
      lead_id: "demo-ld-skokie-preventative",
      company_id: null,
      contact_id: null,
      property_id: null,
      persona: "persona_homeowner_preventative",
      status: "lost",
      gross_revenue_cents: 0,
      gross_margin_cents: 0,
      closed_at: ts(7),
      metadata: { owner: "Revenue", attribution: "web_form", loss_reason: "chose_competitor" },
      created_at: ts(7),
      updated_at: ts(7),
    },
  ];

  // The demo bundle uses the default stages, which are the same values the
  // migration seeds — so a preview and a real workspace agree.
  return {
    companies, contacts, properties, leads, jobs, outcomes,
    stages: {
      leads: [...DEFAULT_PIPELINE_STAGES.leads],
      jobs: [...DEFAULT_PIPELINE_STAGES.jobs],
      outcomes: [...DEFAULT_PIPELINE_STAGES.outcomes],
    },
  };
}

function isDemoBundleEmpty(data: CrmBundleShape): boolean {
  return (
    data.companies.length === 0 &&
    data.contacts.length === 0 &&
    data.properties.length === 0 &&
    data.leads.length === 0 &&
    data.jobs.length === 0 &&
    data.outcomes.length === 0
  );
}

function demoNavCounts(): Record<CrmObjectKey, number> {
  const data = buildDemoCrmBundle();
  return {
    companies: data.companies.length,
    contacts: data.contacts.length,
    properties: data.properties.length,
    leads: data.leads.length,
    jobs: data.jobs.length,
    outcomes: data.outcomes.length,
  };
}

type CompanyRow = {
  id: string;
  name: string | null;
  persona: string | null;
  status: string | null;
  website_url: string | null;
  phone: string | null;
  email: string | null;
  partner_tier: string | null;
  metadata: unknown;
  created_at: string | null;
  updated_at: string | null;
  origin?: string | null;
  /** Soft delete (20260806120000). Non-null = archived; the row is out of every list and count. */
  archived_at?: string | null;
};

type ContactRow = {
  id: string;
  company_id: string | null;
  persona: string | null;
  status: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  metadata: unknown;
  created_at: string | null;
  updated_at: string | null;
  origin?: string | null;
  /** Soft delete (20260806120000). Non-null = archived; the row is out of every list and count. */
  archived_at?: string | null;
};

type PropertyRow = {
  id: string;
  company_id: string | null;
  contact_id: string | null;
  persona: string | null;
  street_line_1: string | null;
  street_line_2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  property_type: string | null;
  metadata: unknown;
  created_at: string | null;
  updated_at: string | null;
  origin?: string | null;
  /** Soft delete (20260806120000). Non-null = archived; the row is out of every list and count. */
  archived_at?: string | null;
};

type LeadRow = {
  id: string;
  company_id: string | null;
  contact_id: string | null;
  property_id: string | null;
  persona: string | null;
  status: string | null;
  routing_recommendation: string | null;
  source: string | null;
  loss_summary: string | null;
  loss_signals: string[] | null;
  lead_score: number | null;
  received_at: string | null;
  metadata: unknown;
  created_at: string | null;
  updated_at: string | null;
  origin?: string | null;
  /** Soft delete (20260806120000). Non-null = archived; the row is out of every list and count. */
  archived_at?: string | null;
};

type JobRow = {
  id: string;
  lead_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  property_id: string | null;
  persona: string | null;
  status: string | null;
  job_number: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  estimated_revenue_cents: number | null;
  metadata: unknown;
  created_at: string | null;
  updated_at: string | null;
  /** Soft delete (20260806120000). Non-null = archived; the row is out of every list and count. */
  archived_at?: string | null;
};

type OutcomeRow = {
  id: string;
  job_id: string | null;
  lead_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  property_id: string | null;
  persona: string | null;
  status: string | null;
  gross_revenue_cents: number | null;
  gross_margin_cents: number | null;
  closed_at: string | null;
  metadata: unknown;
  created_at: string | null;
  updated_at: string | null;
  /** Soft delete (20260806120000). Non-null = archived; the row is out of every list and count. */
  archived_at?: string | null;
};

function buildOverviewFromBundle(data: CrmBundleShape): Extract<CrmOverviewData, { status: "live" }> {
  return {
    status: "live",
    stats: [
        {
          objectKey: "leads",
          qualifier: "found",
          label: "Leads found",
          value: data.leads.length,
          delta: `${data.leads.filter((lead) => {
            // "Not triaged yet" — everything before the qualified line that
            // hasn't already left the pipeline. Was a literal list of the three
            // default stage keys, which counts zero once a tenant renames one.
            const stage = stageFor(data, "leads", lead.status);
            return stage ? !stage.isQualified && !stage.isTerminal : false;
          }).length} need review`,
          forecast: "New lead records appear here before routing or approval.",
        },
        {
          objectKey: "companies",
          label: "Companies",
          value: data.companies.length,
          delta: `${data.companies.filter((company) => company.partner_tier).length} partner-tiered`,
          forecast: "Partners, referral sources, customers, and targets stay organized by object.",
        },
        {
          objectKey: "jobs",
          qualifier: "tracked",
          label: "Projects tracked",
          value: data.jobs.length,
          delta: `${data.jobs.filter((job) => isWonStatus(data.stages.jobs, job.status)).length} ${wonWord(data.stages.jobs, "completed")}`,
          forecast: "Projects connect qualified demand to downstream outcomes.",
        },
        {
          label: "Revenue linked",
          value: formatMoney(data.outcomes.reduce((sum, outcome) => sum + (outcome.gross_revenue_cents ?? 0), 0)),
          delta: `${data.outcomes.filter((outcome) => isWonStatus(data.stages.outcomes, outcome.status)).length} ${wonWord(data.stages.outcomes, "won")} outcomes`,
          forecast: "Attribution connects campaigns, relationships, and work back to revenue.",
        },
    ],
    rows: buildPipelineRows(data),
  };
}

export async function getCrmOverviewData(client?: SupabaseClient): Promise<CrmOverviewData> {
  if (!client && !isSupabaseAdminConfigured()) {
    return isDemoDataEnabled()
      ? buildOverviewFromBundle(buildDemoCrmBundle())
      : { status: "unavailable", message: "CRM data is unavailable." };
  }

  try {
    const { client: supabase, orgId } = client ? { client, orgId: null } : await resolveTenantReadHandle();
    const data = await getCrmTableBundle(supabase, orgId);
    if (isDemoBundleEmpty(data)) {
      if (isDemoDataEnabled()) return buildOverviewFromBundle(buildDemoCrmBundle());
    }
    return buildOverviewFromBundle(data);
  } catch (error) {
    // Degrade, but not silently — this read IS the screen, so an empty
    // state here is indistinguishable from an outage (BSR-544).
    reportDegraded(error, { scope: "crm.getCrmOverviewData", surface: "primary" });
    // NO demo fallback on the error path (BSR-575).
    //
    // Each of these functions already returns demo data ABOVE, before the try,
    // when Supabase is not configured — the offline preview is served there.
    // Reaching this catch means Supabase IS configured and a real query failed,
    // and answering that with fixture data is not a degrade, it is a fabrication.
    //
    // This reverses the flag-ON half of #182/#220, deliberately. Those PRs were
    // fixing the flag-OFF leak into real workspaces and preserved flag-ON as it
    // stood; nobody had argued for it. It is also what made this whole class of
    // bug unfindable — every launch.json config sets ARC_DEMO_DATA=1, so forced
    // failure testing locally could never make these reads fail.
    //
    // Demo-on-EMPTY, above, stays. "There is nothing to show" is a true
    // statement; "here is someone else's data" over an outage is not.
    console.error("[crm] overview read failed:", error);
    return { status: "unavailable", message: "CRM data is unavailable." };
  }
}

function buildObjectDataFromBundle(key: CrmObjectKey, data: CrmBundleShape): CrmObjectData {
  const rows = mapObjectRows(key, data);
  const objectMeta = objectMetaByKey[key];

  return {
    status: "live",
    key,
    label: objectMeta.label,
    href: `/crm/${key}`,
    description: objectMeta.description,
    count: rows.length,
    relationships: buildRelationships(key, data),
    lastActivity: rows[0]?.updated ?? "No activity",
    primaryField: objectMeta.primaryField,
    secondaryField: objectMeta.secondaryField,
    sampleRows: rows,
  };
}

export async function getCrmObjectData(key: CrmObjectKey, client?: SupabaseClient): Promise<CrmObjectReadResult> {
  if (!client && !isSupabaseAdminConfigured()) {
    return isDemoDataEnabled()
      ? buildObjectDataFromBundle(key, buildDemoCrmBundle())
      : { status: "unavailable", message: "CRM data is unavailable." };
  }

  try {
    const { client: supabase, orgId } = client ? { client, orgId: null } : await resolveTenantReadHandle();
    const data = await getCrmTableBundle(supabase, orgId);
    if (isDemoBundleEmpty(data)) {
      if (isDemoDataEnabled()) return buildObjectDataFromBundle(key, buildDemoCrmBundle());
    }
    return buildObjectDataFromBundle(key, data);
  } catch (error) {
    // Degrade, but not silently — this read IS the screen, so an empty
    // state here is indistinguishable from an outage (BSR-544).
    reportDegraded(error, { scope: "crm.getCrmObjectData", surface: "primary" });
    // See getCrmOverviewData: no fixture data over a real failure.
    console.error("[crm] object read failed:", error);
    return { status: "unavailable", message: "CRM data is unavailable." };
  }
}

const CRM_OBJECT_KEYS: readonly CrmObjectKey[] = [
  "companies",
  "contacts",
  "properties",
  "leads",
  "jobs",
  "outcomes",
];

/**
 * Sample rows for every CRM object in a single table-bundle fetch, for @-mention
 * autocomplete. Replaces calling getCrmObjectData() once per object (which each
 * re-fetched the whole 6-table bundle) — that turned one render into ~36 table
 * reads. Org scoping is preserved (orgId resolved here when no client is passed).
 */
export async function getCrmMentionSamples(
  client?: SupabaseClient,
): Promise<Partial<Record<CrmObjectKey, CrmObjectRow[]>>> {
  // Offline/demo: mirror the demo bundle so the board is populated (and its rows
  // open real records) instead of showing empty tabs while the nav counts and
  // record pages are full. Same source the counts and record detail read from.
  if (!client && !isSupabaseAdminConfigured()) {
    if (!isDemoDataEnabled()) return {};
    const bundle = buildDemoCrmBundle();
    const demoOut: Partial<Record<CrmObjectKey, CrmObjectRow[]>> = {};
    for (const key of CRM_OBJECT_KEYS) demoOut[key] = mapObjectRows(key, bundle);
    return demoOut;
  }
  const { client: supabase, orgId } = client ? { client, orgId: null } : await resolveTenantReadHandle();
  const data = await getCrmTableBundle(supabase, orgId);
  const out: Partial<Record<CrmObjectKey, CrmObjectRow[]>> = {};
  for (const key of CRM_OBJECT_KEYS) {
    out[key] = mapObjectRows(key, data);
  }
  await applyOpenTaskCounts(supabase, orgId, out).catch(() => {});
  return out;
}

/**
 * Best-effort: tag each row with its count of open follow-up tasks (crm_tasks,
 * status open/in_progress), matched by entity_id → row id. Purely additive and
 * wrapped in a catch by the caller — if the table is missing or the read is
 * blocked, rows keep `openTasks` undefined and the Tasks column stays empty.
 */
async function applyOpenTaskCounts(
  supabase: SupabaseClient,
  orgId: string | null,
  out: Partial<Record<CrmObjectKey, CrmObjectRow[]>>,
): Promise<void> {
  let query = supabase.from("crm_tasks").select("entity_id").in("status", ["open", "in_progress"]);
  if (orgId) query = query.eq("org_id", orgId);
  const { data, error } = await query;
  if (error || !data) return;
  const counts = new Map<string, number>();
  for (const task of data as { entity_id: string | null }[]) {
    if (!task.entity_id) continue;
    counts.set(task.entity_id, (counts.get(task.entity_id) ?? 0) + 1);
  }
  if (counts.size === 0) return;
  for (const rows of Object.values(out)) {
    if (!rows) continue;
    for (const row of rows) {
      const n = counts.get(row.id);
      if (n) row.openTasks = n;
    }
  }
}

export async function getCrmNavCounts(client?: SupabaseClient): Promise<CrmNavCounts> {
  if (!client && !isSupabaseAdminConfigured()) {
    return isDemoDataEnabled()
      ? { status: "live", counts: demoNavCounts() }
      : { status: "unavailable", message: "CRM data is unavailable." };
  }

  try {
    const { client: supabase, orgId } = client ? { client, orgId: null } : await resolveTenantReadHandle();
    const [companies, contacts, properties, leads, jobs, outcomes] = await Promise.all([
      countRows(supabase, "companies", orgId),
      countRows(supabase, "contacts", orgId),
      countRows(supabase, "properties", orgId),
      countRows(supabase, "leads", orgId),
      countRows(supabase, "jobs", orgId),
      countRows(supabase, "outcomes", orgId),
    ]);

    if (companies + contacts + properties + leads + jobs + outcomes === 0) {
      if (isDemoDataEnabled()) return { status: "live", counts: demoNavCounts() };
    }

    return {
      status: "live",
      counts: { companies, contacts, properties, leads, jobs, outcomes },
    };
  } catch (error) {
    // THIS is why getCrmNavCounts "could not be made to fail" (BSR-575).
    //
    // Two things combined. It was the ONLY read in this file with no
    // reportDegraded at all, so a failure left no trace anywhere; and in demo
    // mode it returned `status: "live"` carrying demo counts, so the caller was
    // told the read succeeded. Three forced-failure attempts saw a healthy read
    // because there was nothing to see — not because the error was swallowed
    // somewhere exotic.
    //
    // The sibling reads already reported before their demo fallback. This one
    // now matches them, which is what makes a forced failure observable.
    reportDegraded(error, { scope: "crm.getCrmNavCounts", surface: "primary" });
    // See getCrmOverviewData. This one was the worst of the four: it returned
    // `status: "live"` alongside the fixtures, so the caller was told the read
    // had SUCCEEDED — which is why it "could not be made to fail".
    console.error("[crm] nav counts read failed:", error);
    return { status: "unavailable", message: "CRM data is unavailable." };
  }
}

function buildRecordDataFromBundle(key: CrmObjectKey, recordId: string, data: CrmBundleShape, agentName: string): CrmRecordReadResult {
  const objectMeta = objectMetaByKey[key];
  const record = findRecord(key, recordId, data);

  if (!record) {
    return { status: "not_found" };
  }

  {
    const metadata = asRecord(record.metadata);
    const persona = getString(record.persona) ?? getString(metadata.persona) ?? "Unassigned persona";
    const lifecycleStatus = titleize(recordStatus(key, record));
    const owner = getString(metadata.owner) ?? defaultOwnerForObject(key, agentName);
    const updated = record.updated_at ?? record.created_at ?? "Now";
    const scoreSet = getScores(key, record, metadata);
    const evidence = buildRecordEvidence(metadata);

    return {
      status: "live",
      key,
      label: objectMeta.label,
      href: `/crm/${key}/${recordId}`,
      id: recordId,
      name: recordName(key, record, data),
      detail: recordDetail(key, record, data),
      lifecycleStatus,
      owner,
      updated,
      persona: titleize(persona),
      confidence: confidenceValue(metadata),
      journeyStage: journeyStageForRecord(key, lifecycleStatus, metadata),
      urgency: urgencyForRecord(key, scoreSet.leadScore, metadata),
      leadScore: scoreSet.leadScore,
      partnerScore: scoreSet.partnerScore,
      revenueScore: scoreSet.revenueScore,
      attentionReason: attentionReasonForRecord(key, record, metadata, agentName),
      nextBestAction: nextBestActionForRecord(key, record, metadata, data, agentName),
      cta: ctaForPersona(persona),
      messageAngle: messageAngleForPersona(persona),
      guardrailStatus: "Internal CRM review only. No outreach, publishing, spend, or dispatch is enabled from this record.",
      proofPoints: proofPointsForRecord(key, record, metadata),
      evidence,
      fields: fieldsForRecord(key, record),
      relationships: relationshipsForRecord(key, record, data),
      missingFields: missingFieldsForRecord(key, record, evidence),
      quickStats: quickStatsForRecord(key, record, data, scoreSet),
      scoreBars: scoreBarsForRecord(key, scoreSet),
      engagement: engagementForRecord(key, record, data, metadata),
      dataQuality: dataQualityForRecord(key, record, evidence),
      graph: graphForRecord(key, record, data),
      origin: ((record as { origin?: string | null }).origin as "operator" | "agent" | undefined) ?? "operator",
    };
  }
}

export async function getCrmRecordData(key: CrmObjectKey, recordId: string, client?: SupabaseClient, agentName: string = "Agent"): Promise<CrmRecordReadResult> {
  if (!client && !isSupabaseAdminConfigured()) {
    return isDemoDataEnabled()
      ? buildRecordDataFromBundle(key, recordId, buildDemoCrmBundle(), agentName)
      : { status: "unavailable", message: "CRM data is unavailable." };
  }

  try {
    const { client: supabase, orgId } = client ? { client, orgId: null } : await resolveTenantReadHandle();
    const data = await getCrmTableBundle(supabase, orgId);
    if (isDemoBundleEmpty(data)) {
      if (isDemoDataEnabled()) return buildRecordDataFromBundle(key, recordId, buildDemoCrmBundle(), agentName);
    }
    return buildRecordDataFromBundle(key, recordId, data, agentName);
  } catch (error) {
    // Degrade, but not silently — this read IS the screen, so an empty
    // state here is indistinguishable from an outage (BSR-544).
    reportDegraded(error, { scope: "crm.getCrmRecordData", surface: "primary" });
    // See getCrmOverviewData: no fixture data over a real failure.
    console.error("[crm] record read failed:", error);
    return { status: "unavailable", message: "CRM data is unavailable." };
  }
}

/**
 * Fetch specific rows for ONE object instead of its recency window.
 *
 * The window exists so a board render is bounded. That is fine for rendering
 * and wrong for finding: a record past the 1,000th is simply not in the browser,
 * so the client-side filter cannot match it while the counter — a real COUNT —
 * insists it exists (BSR-633). Focusing lets a search fetch exactly its hits and
 * still decorate them with the same relationship/stage context every other row
 * gets.
 */
type CrmBundleFocus = { key: CrmObjectKey; ids: string[] };

async function getCrmTableBundle(client?: SupabaseClient, orgId?: string | null, focus?: CrmBundleFocus) {
  const supabase = client ?? getSupabaseAdminClient();
  /**
   * Focused object: fetch by id. Everything else keeps its window.
   *
   * Archived records are excluded from the WINDOW but never from a focused
   * fetch: the caller asking for specific ids has already decided which rows it
   * wants, and the one caller that asks for archived ids is the restore list.
   * Filtering there too would make archived records unreachable — deleted for
   * real, from a soft delete that promises otherwise.
   */
  const scope = <T extends {
    in: (col: string, v: string[]) => T;
    is: (col: string, v: null) => T;
    limit: (n: number) => T;
  }>(key: CrmObjectKey, q: T): T =>
    focus && focus.key === key ? q.in("id", focus.ids) : q.is("archived_at", null).limit(CRM_TABLE_BUNDLE_LIMIT);

  let companiesQ = supabase
    .from("companies")
    .select("id,name,persona,status,website_url,phone,email,partner_tier,metadata,created_at,updated_at,origin,archived_at")
    .order("updated_at", { ascending: false });
  if (orgId) companiesQ = companiesQ.eq("org_id", orgId);
  companiesQ = scope("companies", companiesQ as never) as typeof companiesQ;

  let contactsQ = supabase
    .from("contacts")
    .select("id,company_id,persona,status,first_name,last_name,full_name,email,phone,title,metadata,created_at,updated_at,origin,archived_at")
    .order("updated_at", { ascending: false });
  if (orgId) contactsQ = contactsQ.eq("org_id", orgId);
  contactsQ = scope("contacts", contactsQ as never) as typeof contactsQ;

  let propertiesQ = supabase
    .from("properties")
    .select("id,company_id,contact_id,persona,street_line_1,street_line_2,city,state,postal_code,property_type,metadata,created_at,updated_at,origin,archived_at")
    .order("updated_at", { ascending: false });
  if (orgId) propertiesQ = propertiesQ.eq("org_id", orgId);
  propertiesQ = scope("properties", propertiesQ as never) as typeof propertiesQ;

  let leadsQ = supabase
    .from("leads")
    .select("id,company_id,contact_id,property_id,persona,status,routing_recommendation,source,loss_summary,loss_signals,lead_score,received_at,metadata,created_at,updated_at,origin,archived_at")
    .order("updated_at", { ascending: false });
  if (orgId) leadsQ = leadsQ.eq("org_id", orgId);
  leadsQ = scope("leads", leadsQ as never) as typeof leadsQ;

  let jobsQ = supabase
    .from("jobs")
    .select("id,lead_id,company_id,contact_id,property_id,persona,status,job_number,scheduled_at,completed_at,estimated_revenue_cents,metadata,created_at,updated_at,archived_at")
    .order("updated_at", { ascending: false });
  if (orgId) jobsQ = jobsQ.eq("org_id", orgId);
  jobsQ = scope("jobs", jobsQ as never) as typeof jobsQ;

  let outcomesQ = supabase
    .from("outcomes")
    .select("id,job_id,lead_id,company_id,contact_id,property_id,persona,status,gross_revenue_cents,gross_margin_cents,closed_at,metadata,created_at,updated_at,archived_at")
    .order("updated_at", { ascending: false });
  if (orgId) outcomesQ = outcomesQ.eq("org_id", orgId);
  outcomesQ = scope("outcomes", outcomesQ as never) as typeof outcomesQ;

  const [companies, contacts, properties, leads, jobs, outcomes] = await Promise.all([
    companiesQ,
    contactsQ,
    propertiesQ,
    leadsQ,
    jobsQ,
    outcomesQ,
  ]);

  assertResult("companies", companies.error);
  assertResult("contacts", contacts.error);
  assertResult("properties", properties.error);
  assertResult("leads", leads.error);
  assertResult("jobs", jobs.error);
  assertResult("outcomes", outcomes.error);

  // getPipelineStages already falls back to the defaults rather than returning
  // empty, precisely so a stage-table problem cannot make every record read as
  // meaningless. Nothing to guard here beyond that.
  const [leadStages, jobStages, outcomeStages] = await Promise.all([
    getPipelineStages(orgId ?? "", "leads", { client: supabase }),
    getPipelineStages(orgId ?? "", "jobs", { client: supabase }),
    getPipelineStages(orgId ?? "", "outcomes", { client: supabase }),
  ]);

  return {
    companies: (companies.data ?? []) as CompanyRow[],
    contacts: (contacts.data ?? []) as ContactRow[],
    properties: (properties.data ?? []) as PropertyRow[],
    leads: (leads.data ?? []) as LeadRow[],
    jobs: (jobs.data ?? []) as JobRow[],
    outcomes: (outcomes.data ?? []) as OutcomeRow[],
    stages: { leads: leadStages, jobs: jobStages, outcomes: outcomeStages },
  };
}

/**
 * Server-side search for one CRM object (BSR-633).
 *
 * The board fetches a 1,000-row recency window and filters it in the browser.
 * That is honest for rendering and wrong for finding: on a workspace with 2,719
 * contacts, 1,719 of them — 63% — were not in the browser at all, so the filter
 * returned nothing while the counter, a real COUNT, insisted the record existed.
 * The UI stated the record was there and then failed to find it.
 *
 * This pushes the term into the query instead. Matching is over the record's OWN
 * text columns; derived values the board also filters on (owner, relationship
 * names, custom fields) are not searchable server-side, so a client-side pass
 * still refines whatever comes back.
 */
export const CRM_SEARCH_LIMIT = 200;

/** Columns worth matching per object — the ones a human would type. */
const CRM_SEARCH_COLUMNS: Record<CrmObjectKey, string[]> = {
  companies: ["name", "website_url", "email", "phone"],
  contacts: ["full_name", "first_name", "last_name", "email", "phone", "title"],
  properties: ["street_line_1", "street_line_2", "city", "state", "postal_code"],
  leads: ["loss_summary", "source", "status", "routing_recommendation"],
  jobs: ["job_number", "status"],
  outcomes: ["status"],
};

/**
 * Neutralize a term for PostgREST's `.or()` grammar, which embeds it in a
 * comma/paren-delimited filter string and treats `*` as the wildcard. A raw
 * comma, paren or star would break the filter — or inject an extra OR
 * condition. Mirrors `sanitizeBrainSearch`, which exists for the same hazard.
 */
export function sanitizeCrmSearch(raw: string): string {
  return raw.replace(/[,()*%"\\]/g, " ").replace(/\s+/g, " ").trim();
}

export type CrmSearchResult =
  | { status: "live"; rows: CrmObjectRow[]; capped: boolean }
  | { status: "unavailable"; message: string };

export async function searchCrmObjectRows(
  key: CrmObjectKey,
  rawQuery: string,
  orgId: string,
  client?: SupabaseClient,
): Promise<CrmSearchResult> {
  const term = sanitizeCrmSearch(rawQuery);
  // One character matches most of the table; the caller filters the page anyway.
  if (term.length < 2) return { status: "live", rows: [], capped: false };
  if (!client && !isSupabaseAdminConfigured()) {
    return { status: "unavailable", message: "CRM search is unavailable." };
  }
  const supabase = client ?? getSupabaseAdminClient();

  try {
    // Ids first, so the expensive decoration only runs for real hits.
    const filter = CRM_SEARCH_COLUMNS[key].map((column) => `${column}.ilike.*${term}*`).join(",");
    const { data, error } = await supabase
      .from(key)
      .select("id")
      .eq("org_id", orgId)
      .or(filter)
      .order("updated_at", { ascending: false })
      .limit(CRM_SEARCH_LIMIT + 1);
    if (error) {
      return unavailableRead("crm.searchCrmObjectRows", orgId, error, {
        surface: "primary",
        fallbackMessage: "CRM search is unavailable.",
      });
    }

    const ids = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
    const capped = ids.length > CRM_SEARCH_LIMIT;
    const page = capped ? ids.slice(0, CRM_SEARCH_LIMIT) : ids;
    if (!page.length) return { status: "live", rows: [], capped: false };

    // Focused bundle: the hits themselves, plus the usual windows for the
    // relationship and stage context every other row is decorated with.
    const bundle = await getCrmTableBundle(supabase, orgId, { key, ids: page });
    return { status: "live", rows: mapObjectRows(key, bundle), capped };
  } catch (error) {
    return unavailableRead("crm.searchCrmObjectRows", orgId, error, {
      surface: "primary",
      fallbackMessage: "CRM search is unavailable.",
    });
  }
}

/**
 * The archived records for one object, most recently archived first.
 *
 * A soft delete that cannot be listed is a hard delete with extra steps. Every
 * other read here excludes `archived_at is not null`, so without this the rows
 * exist in the table and are reachable by nothing — the state the CRM was
 * already in when "archived" was a status the list filtered out client-side.
 *
 * Same ids-then-focused-bundle shape as searchCrmObjectRows, so a restored row
 * is decorated identically to one that was never archived.
 */
export async function listArchivedCrmObjectRows(
  key: CrmObjectKey,
  orgId: string,
  client?: SupabaseClient,
): Promise<CrmSearchResult> {
  if (!client && !isSupabaseAdminConfigured()) {
    return { status: "unavailable", message: "Archived records are unavailable." };
  }
  const supabase = client ?? getSupabaseAdminClient();

  try {
    const { data, error } = await supabase
      .from(key)
      .select("id")
      .eq("org_id", orgId)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .limit(CRM_SEARCH_LIMIT + 1);
    if (error) {
      return unavailableRead("crm.listArchivedCrmObjectRows", orgId, error, {
        surface: "primary",
        fallbackMessage: "Archived records are unavailable.",
      });
    }

    const ids = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
    const capped = ids.length > CRM_SEARCH_LIMIT;
    const page = capped ? ids.slice(0, CRM_SEARCH_LIMIT) : ids;
    if (!page.length) return { status: "live", rows: [], capped: false };

    const bundle = await getCrmTableBundle(supabase, orgId, { key, ids: page });
    return { status: "live", rows: mapObjectRows(key, bundle), capped };
  } catch (error) {
    return unavailableRead("crm.listArchivedCrmObjectRows", orgId, error, {
      surface: "primary",
      fallbackMessage: "Archived records are unavailable.",
    });
  }
}

function assertResult(table: string, error: { message?: string } | null) {
  if (error) {
    throw new Error(`${table} lookup failed: ${error.message ?? "Unknown Supabase error"}`);
  }
}

async function countRows(client: SupabaseClient, table: CrmObjectKey, orgId?: string | null) {
  // Archived rows are out of the count for the same reason they are out of the
  // list: the tab badge and the list have to agree, or the operator is told
  // there are 12 companies and shown 11 with no way to tell which is lying.
  let query = client.from(table).select("id", { count: "exact", head: true }).is("archived_at", null);
  if (orgId) query = query.eq("org_id", orgId);
  const result = await query;
  // `count ?? 0` here is what made getCrmNavCounts impossible to fail: a HEAD
  // count against a missing relation returns { count: null, error: null }, so
  // assertResult saw nothing and a broken read became a confident zero.
  return requireCount(table, result);
}

function buildPipelineRows(data: Awaited<ReturnType<typeof getCrmTableBundle>>): CrmPipelineRow[] {
  const companyById = new Map(data.companies.map((company) => [company.id, company]));
  const contactById = new Map(data.contacts.map((contact) => [contact.id, contact]));

  const leadRows = data.leads.slice(0, 8).map((lead) => {
    const company = lead.company_id ? companyById.get(lead.company_id) : undefined;
    const contact = lead.contact_id ? contactById.get(lead.contact_id) : undefined;
    const metadata = asRecord(lead.metadata);
    const score = lead.lead_score ?? 0;
    const evidence = buildRecordEvidence(metadata);

    return {
      id: lead.id,
      record: lead.loss_summary || titleize(lead.source ?? "Lead"),
      account: company?.name ?? contactName(contact) ?? "Unassigned account",
      type: titleize(lead.persona ?? "Lead"),
      objectType: "lead",
      stage: stageLabel(data.stages.leads, lead.status, "new"),
      owner: getString(metadata.owner) ?? "Arc",
      value: scoreValue(lead.lead_score),
      nextStep: nextStepForLead(stageFor(data, "leads", lead.status)),
      updated: lead.updated_at ?? lead.received_at ?? "Now",
      score,
      personaTag: normalizeTag(lead.persona ?? getString(metadata.persona) ?? "unassigned_persona"),
      serviceTags: serviceTagsForLead(lead, metadata),
      urgencyTag: urgencyTagForScore(score, metadata),
      sourceTag: normalizeTag(lead.source ?? getString(metadata.source) ?? "unknown_source"),
      lifecycleTag: normalizeTag(lead.status ?? "new"),
      missingTags: missingTagsForPipelineRow({
        persona: lead.persona,
        evidenceCount: evidence.length,
        score: lead.lead_score,
        serviceTags: lead.loss_signals,
        source: lead.source,
      }),
      href: `/crm/leads/${lead.id}`,
      tone: statusAccent(lead.status ?? "new", stageFor(data, "leads", lead.status)),
    } satisfies CrmPipelineRow;
  });

  const jobRows = data.jobs.slice(0, 4).map((job) => {
    const company = job.company_id ? companyById.get(job.company_id) : undefined;
    const contact = job.contact_id ? contactById.get(job.contact_id) : undefined;
    const metadata = asRecord(job.metadata);
    const score = isWonStatus(data.stages.jobs, job.status) ? 80 : 62;
    const revenueCents = job.estimated_revenue_cents ?? 0;

    return {
      id: job.id,
      record: job.job_number ?? `Project ${shortId(job.id)}`,
      account: company?.name ?? contactName(contact) ?? "Linked project",
      type: titleize(job.persona ?? "Project"),
      objectType: "job",
      stage: stageLabel(data.stages.jobs, job.status, "pending"),
      owner: getString(metadata.owner) ?? "Ops",
      value: formatMoney(revenueCents),
      nextStep: isWonStatus(data.stages.jobs, job.status) ? "Review outcome" : "Coordinate project step",
      updated: job.updated_at ?? job.created_at ?? "Now",
      score,
      personaTag: normalizeTag(job.persona ?? getString(metadata.persona) ?? "unassigned_persona"),
      serviceTags: getStringArray(metadata.service_tags).map(normalizeTag),
      urgencyTag: getString(metadata.urgency_tag) ?? (revenueCents >= 1000000 ? "high_value" : "standard"),
      sourceTag: normalizeTag(getString(metadata.source) ?? "project_record"),
      lifecycleTag: normalizeTag(job.status ?? "pending"),
      missingTags: missingTagsForPipelineRow({
        persona: job.persona,
        evidenceCount: buildRecordEvidence(metadata).length,
        score,
        serviceTags: getStringArray(metadata.service_tags),
        source: getString(metadata.source),
      }),
      href: `/crm/jobs/${job.id}`,
      tone: statusAccent(job.status ?? "pending", stageFor(data, "jobs", job.status)),
    } satisfies CrmPipelineRow;
  });

  const partnerRows = data.companies
    .filter((company) => company.partner_tier)
    .slice(0, 4)
    .map((company) => {
      const metadata = asRecord(company.metadata);
      const score = getNumber(metadata.partner_score) ?? partnerScore(company.partner_tier);
      return {
        id: company.id,
        record: company.name ?? `Company ${shortId(company.id)}`,
        account: company.partner_tier ? `Tier ${company.partner_tier} relationship` : "Company",
        type: titleize(company.persona ?? "Company"),
        objectType: "partner",
        stage: titleize(company.status ?? "active"),
        owner: getString(metadata.owner) ?? "Team",
        value: "Relationship",
        nextStep: "Review relationship follow-up",
        updated: company.updated_at ?? company.created_at ?? "Now",
        score,
        personaTag: normalizeTag(company.persona ?? getString(metadata.persona) ?? "unassigned_persona"),
        serviceTags: getStringArray(metadata.service_tags).map(normalizeTag),
        urgencyTag: getString(metadata.urgency_tag) ?? (score >= 80 ? "partner_priority" : "partner_review"),
        sourceTag: normalizeTag(getString(metadata.source) ?? "company_record"),
        lifecycleTag: normalizeTag(company.status ?? "active"),
        missingTags: missingTagsForPipelineRow({
          persona: company.persona,
          evidenceCount: buildRecordEvidence(metadata).length,
          score,
          serviceTags: getStringArray(metadata.service_tags),
          source: getString(metadata.source),
        }),
        href: `/crm/companies/${company.id}`,
        tone: statusAccent(company.status ?? "active"),
      } satisfies CrmPipelineRow;
    });

  return [...leadRows, ...jobRows, ...partnerRows].sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
}

function mapObjectRows(key: CrmObjectKey, data: Awaited<ReturnType<typeof getCrmTableBundle>>): CrmObjectRow[] {
  if (key === "companies") {
    return data.companies.map((company) => decorateObjectRow(key, company, data, "Robby", company.updated_at ?? company.created_at ?? "Now"));
  }

  if (key === "contacts") {
    return data.contacts.map((contact) => decorateObjectRow(key, contact, data, "Robby", contact.updated_at ?? contact.created_at ?? "Now"));
  }

  if (key === "properties") {
    return data.properties.map((property) => decorateObjectRow(key, property, data, "Ops", property.updated_at ?? property.created_at ?? "Now"));
  }

  if (key === "leads") {
    return data.leads.map((lead) => decorateObjectRow(key, lead, data, "Arc", lead.updated_at ?? lead.received_at ?? "Now"));
  }

  if (key === "jobs") {
    return data.jobs.map((job) => decorateObjectRow(key, job, data, "Ops", job.updated_at ?? job.created_at ?? "Now"));
  }

  return data.outcomes.map((outcome) => decorateObjectRow(key, outcome, data, "Finance", outcome.updated_at ?? outcome.closed_at ?? "Now"));
}

type CrmBundle = Awaited<ReturnType<typeof getCrmTableBundle>>;
type AnyCrmRecord = CompanyRow | ContactRow | PropertyRow | LeadRow | JobRow | OutcomeRow;

function decorateObjectRow(
  key: CrmObjectKey,
  record: AnyCrmRecord,
  data: CrmBundle,
  fallbackOwner: string,
  updated: string,
): CrmObjectRow {
  const metadata = asRecord(record.metadata);
  const evidence = buildRecordEvidence(metadata);
  const scores = getScores(key, record, metadata);
  const score = scores.leadScore ?? scores.partnerScore;

  return {
    id: record.id,
    name: recordName(key, record, data),
    detail: recordDetail(key, record, data),
    status: isPipelineObjectKey(key)
      ? stageLabel(data.stages[key], recordStatus(key, record), "")
      : titleize(recordStatus(key, record)),
    statusTone: statusTone(
      isPipelineObjectKey(key)
        ? stageLabel(data.stages[key], recordStatus(key, record), "")
        : titleize(recordStatus(key, record)),
      isPipelineObjectKey(key) ? stageFor(data, key, recordStatus(key, record)) : null,
    ),
    owner: getString(metadata.owner) ?? fallbackOwner,
    updated,
    objectKey: key,
    href: `/crm/${key}/${record.id}`,
    personaTag: normalizeTag(record.persona ?? getString(metadata.persona) ?? "unassigned_persona"),
    sourceLabel: sourceLabelForObjectRow(key, record, metadata),
    score,
    valueLabel: valueLabelForObjectRow(key, record, scores),
    nextStep: nextBestActionForRecord(key, record, metadata, data),
    relationships: relationshipsForRecord(key, record, data).slice(0, 5),
    missingFields: missingFieldsForRecord(key, record, evidence),
    archivedAt: getString(record.archived_at) ?? null,
  };
}

function sourceLabelForObjectRow(key: CrmObjectKey, record: AnyCrmRecord, metadata: Record<string, unknown>) {
  const source = getString(metadata.source) ?? getString(metadata.source_label);
  if (source) return titleize(source);
  if (key === "leads") return titleize((record as LeadRow).source ?? "Lead intake");
  if (key === "companies") return "Company account";
  if (key === "contacts") return "Relationship graph";
  if (key === "properties") return "Asset record";
  if (key === "jobs") return "Project record";
  return "Outcome loop";
}

function valueLabelForObjectRow(
  key: CrmObjectKey,
  record: AnyCrmRecord,
  scores: ReturnType<typeof getScores>,
) {
  if (key === "companies") return typeof scores.partnerScore === "number" ? `Relationship fit ${scores.partnerScore}` : "Relationship fit missing";
  if (key === "leads") return typeof scores.leadScore === "number" ? `Lead score ${scores.leadScore}` : "Lead score missing";
  if (key === "jobs") return formatMoney((record as JobRow).estimated_revenue_cents ?? 0);
  if (key === "outcomes") return formatMoney((record as OutcomeRow).gross_revenue_cents ?? 0);
  if (key === "contacts") return "Contact context";
  return "Asset context";
}

function findRecord(key: CrmObjectKey, recordId: string, data: CrmBundle): AnyCrmRecord | null {
  if (key === "companies") return data.companies.find((row) => row.id === recordId) ?? null;
  if (key === "contacts") return data.contacts.find((row) => row.id === recordId) ?? null;
  if (key === "properties") return data.properties.find((row) => row.id === recordId) ?? null;
  if (key === "leads") return data.leads.find((row) => row.id === recordId) ?? null;
  if (key === "jobs") return data.jobs.find((row) => row.id === recordId) ?? null;
  return data.outcomes.find((row) => row.id === recordId) ?? null;
}

function recordName(key: CrmObjectKey, record: AnyCrmRecord, data: CrmBundle) {
  if (key === "companies") return (record as CompanyRow).name ?? `Company ${shortId(record.id)}`;
  if (key === "contacts") return contactName(record as ContactRow) ?? `Contact ${shortId(record.id)}`;
  if (key === "properties") return propertyAddress(record as PropertyRow);
  if (key === "leads") return (record as LeadRow).loss_summary ?? titleize((record as LeadRow).source ?? "Lead");
  if (key === "jobs") return (record as JobRow).job_number ?? `Project ${shortId(record.id)}`;
  return outcomeName(record as OutcomeRow, data.stages.outcomes);
}

/**
 * Human-readable outcome title. Avoids leaking the raw record id
 * (the old "Won demo-oc-…" form) by naming the result by its service line
 * and revenue instead.
 */
function outcomeName(outcome: OutcomeRow, stages: readonly PipelineStage[]) {
  const result = stageLabel(stages, outcome.status, "outcome");
  const service = serviceLineForPersona(outcome.persona);
  const revenue = outcome.gross_revenue_cents ? formatMoney(outcome.gross_revenue_cents) : null;
  if (isLostStatus(stages, outcome.status)) {
    return service ? `${service} — lost` : "Closed-lost outcome";
  }
  return [service ? `${service} ${result.toLowerCase()}` : `${result} outcome`, revenue].filter(Boolean).join(" · ");
}

/** Maps a persona to the product motion it most often represents. */
function serviceLineForPersona(persona: string | null): string | null {
  if (!persona) return null;
  const lower = persona.toLowerCase();
  if (lower.includes("insurance") || lower.includes("fire")) return "Enterprise onboarding";
  if (lower.includes("plumb") || lower.includes("emergency") || lower.includes("homeowner")) return "Trial conversion";
  if (lower.includes("property") || lower.includes("hoa") || lower.includes("landlord")) return "Team expansion";
  if (lower.includes("gc") || lower.includes("remodel") || lower.includes("listing")) return "Implementation";
  return "Adoption";
}

function recordDetail(key: CrmObjectKey, record: AnyCrmRecord, data: CrmBundle) {
  if (key === "companies") {
    const company = record as CompanyRow;
    return [titleize(company.persona ?? "company"), company.partner_tier ? `Tier ${company.partner_tier} relationship` : null, company.website_url].filter(Boolean).join(" / ");
  }
  if (key === "contacts") {
    const contact = record as ContactRow;
    const company = contact.company_id ? data.companies.find((item) => item.id === contact.company_id) : null;
    return [contact.title, company?.name, contact.email, contact.phone].filter(Boolean).join(" / ") || titleize(contact.persona ?? "contact");
  }
  if (key === "properties") {
    const property = record as PropertyRow;
    return [titleize(property.property_type ?? "property"), property.city, property.postal_code].filter(Boolean).join(" / ");
  }
  if (key === "leads") {
    const lead = record as LeadRow;
    return [titleize(lead.persona ?? "lead"), lead.source ? `Source: ${titleize(lead.source)}` : null, lead.routing_recommendation ? `Routing: ${titleize(lead.routing_recommendation)}` : null].filter(Boolean).join(" · ");
  }
  if (key === "jobs") {
    const job = record as JobRow;
    return [titleize(job.persona ?? "project"), formatMoney(job.estimated_revenue_cents ?? 0), job.scheduled_at ? `Scheduled ${formatDateOnly(job.scheduled_at)}` : null].filter(Boolean).join(" · ");
  }
  const outcome = record as OutcomeRow;
  const attribution = getString(asRecord(outcome.metadata).attribution);
  return [titleize(outcome.persona ?? "outcome"), formatMoney(outcome.gross_revenue_cents ?? 0), attribution ? `Attribution: ${titleize(attribution)}` : null].filter(Boolean).join(" · ");
}

function recordStatus(key: CrmObjectKey, record: AnyCrmRecord) {
  if (key === "properties") return (record as PropertyRow).property_type ?? "property";
  return getString((record as Exclude<AnyCrmRecord, PropertyRow>).status) ?? "active";
}

function getScores(key: CrmObjectKey, record: AnyCrmRecord, metadata: Record<string, unknown>) {
  const leadScore = key === "leads" ? (record as LeadRow).lead_score : getNumber(metadata.lead_score);
  const partnerFitScore =
    key === "companies"
      ? getNumber(metadata.partner_score) ?? partnerScore((record as CompanyRow).partner_tier)
      : getNumber(metadata.partner_score);
  const revenueScore =
    key === "jobs"
      ? formatMoney((record as JobRow).estimated_revenue_cents ?? 0)
      : key === "outcomes"
        ? formatMoney((record as OutcomeRow).gross_revenue_cents ?? 0)
        : getString(metadata.revenue_score) ?? null;

  return { leadScore, partnerScore: partnerFitScore, revenueScore };
}

function buildRecordEvidence(metadata: Record<string, unknown>) {
  const evidenceUrls = getStringArray(metadata.evidence_urls);
  const sourceUrls = getStringArray(metadata.source_urls);
  const urls = uniqueStrings([...evidenceUrls, ...sourceUrls]);
  const notes = getStringArray(metadata.evidence_notes);

  return [
    ...urls.map((url) => ({ label: getHostLabel(url), href: url, detail: "Evidence URL from record metadata." })),
    ...notes.map((note) => ({ label: "Evidence note", detail: note })),
  ];
}

function confidenceValue(metadata: Record<string, unknown>) {
  return getString(metadata.confidence) ?? getString(metadata.confidence_score) ?? getString(metadata.enrichment_confidence) ?? "Missing";
}

function journeyStageForRecord(key: CrmObjectKey, lifecycleStatus: string, metadata: Record<string, unknown>) {
  const explicit = getString(metadata.journey_stage) ?? getString(metadata.relationship_stage);
  if (explicit) return titleize(explicit);
  return lifecycleStatus;
}

function urgencyForRecord(key: CrmObjectKey, leadScore: number | null, metadata: Record<string, unknown>) {
  const explicit = getString(metadata.urgency) ?? getString(metadata.urgency_tag);
  if (explicit) return titleize(explicit);
  if (typeof leadScore === "number" && leadScore >= 80) return "High-value urgent";
  if (key === "leads") return "Needs review";
  if (key === "companies") return "Partner development";
  return "Normal";
}

function attentionReasonForRecord(key: CrmObjectKey, record: AnyCrmRecord, metadata: Record<string, unknown>, agentName: string = "Agent") {
  const explicit = getString(metadata.attention_reason) ?? getString(metadata.why_arc_created_it);
  if (explicit) return explicit;
  if (key === "leads") return (record as LeadRow).loss_summary ?? "Lead needs validation, scoring, enrichment, and approval before outreach.";
  if (key === "companies") return "Company may support referral, partner, or campaign development workflows.";
  if (key === "contacts") return "Contact record can connect persona, company, lead, and approval history.";
  if (key === "outcomes") return "Outcome record can close the loop between marketing activity and revenue.";
  return `Record is available for ${agentName} review and enrichment.`;
}

function nextBestActionForRecord(key: CrmObjectKey, record: AnyCrmRecord, metadata: Record<string, unknown>, data: CrmBundle, agentName: string = "Agent") {
  void agentName;
  const explicit = getString(metadata.next_best_action) ?? getString(metadata.recommended_action);
  if (explicit) return explicit;
  if (key === "leads") return nextStepForLead(findStage(data.stages.leads, (record as LeadRow).status));
  if (key === "companies") return `Review fit, missing context, and next touch before drafting outreach.`;
  if (key === "contacts") return "Confirm role, persona, consent, and company relationship before campaign use.";
  if (key === "jobs") return "Connect project status and revenue context back to the originating lead or campaign.";
  if (key === "outcomes") return "Review attribution and feed performance learning back into scoring.";
  return "Enrich missing record context before campaign or approval work.";
}

function ctaForPersona(persona: string) {
  const lower = persona.toLowerCase();
  if (lower.includes("property manager")) return "Request Partner Packet";
  if (lower.includes("insurance")) return "Refer a Client";
  if (lower.includes("plumb") || lower.includes("sewer") || lower.includes("trade") || lower.includes("contractor")) return "Become a Partner";
  return "Review Next Step";
}

function messageAngleForPersona(persona: string) {
  const lower = persona.toLowerCase();
  if (lower.includes("property manager")) return "Clear coordination, simple documentation, and partner-ready next steps.";
  if (lower.includes("insurance")) return "Reliable client handoff, clear status, and easy referral tracking.";
  if (lower.includes("plumb") || lower.includes("sewer") || lower.includes("trade")) return "Partner handoff, shared context, and fast follow-up.";
  return "Clear value, relevant proof, simple next step, and approval-safe follow-up.";
}

function proofPointsForRecord(key: CrmObjectKey, record: AnyCrmRecord, metadata: Record<string, unknown>) {
  const proof = getStringArray(metadata.proof_points);
  if (proof.length > 0) return proof;

  if (key === "companies") {
    const company = record as CompanyRow;
    return [company.website_url ? `Website: ${company.website_url}` : null, company.phone ? `Phone: ${company.phone}` : null, company.partner_tier ? `Partner tier: ${company.partner_tier}` : null].filter(Boolean) as string[];
  }
  if (key === "contacts") {
    const contact = record as ContactRow;
    return [contact.title ? `Title: ${contact.title}` : null, contact.email ? `Email captured` : null, contact.phone ? `Phone captured` : null].filter(Boolean) as string[];
  }
  if (key === "leads") {
    const lead = record as LeadRow;
    return [lead.source ? `Source: ${lead.source}` : null, lead.routing_recommendation ? `Routing: ${lead.routing_recommendation}` : null, ...(lead.loss_signals ?? []).slice(0, 3)].filter(Boolean) as string[];
  }
  return [];
}

function fieldsForRecord(key: CrmObjectKey, record: AnyCrmRecord): CrmRecordField[] {
  if (key === "companies") {
    const company = record as CompanyRow;
    return compactFields([
      ["Name", company.name],
      ["Persona", titleize(company.persona ?? "unassigned")],
      ["Status", titleize(company.status ?? "active")],
      ["Website", company.website_url],
      ["Phone", company.phone],
      ["Email", company.email],
      ["Partner tier", company.partner_tier],
    ]);
  }
  if (key === "contacts") {
    const contact = record as ContactRow;
    return compactFields([
      ["Name", contactName(contact)],
      ["Title", contact.title],
      ["Persona", titleize(contact.persona ?? "unassigned")],
      ["Email", contact.email],
      ["Phone", contact.phone],
      // Rehomed from the removed header metric strip: the only value it carried
      // that was not already on this page. Distinct from At a glance's lifecycle
      // "Stage" — two different things, so they keep two different labels.
      ["Relationship stage", relationshipStageOf(contact)],
      // A raw "Company id" row lived here, printing a database identifier
      // ("demo-co-northside-plumbing") to an owner-operator.
      // `relationshipsForRecord` already resolves the same link to the record's
      // NAME with an href, so the row was both unreadable and a duplicate of one
      // already on screen in better form. Same for "Contact id" on properties
      // and "Project id" on outcomes.
    ]);
  }
  if (key === "properties") {
    const property = record as PropertyRow;
    return compactFields([
      ["Address", propertyAddress(property)],
      ["Type", titleize(property.property_type ?? "property")],
      ["City", property.city],
      ["State", property.state],
      ["ZIP", property.postal_code],
      // Raw "Contact id" row removed — see the note on contacts above.
    ]);
  }
  if (key === "leads") {
    const lead = record as LeadRow;
    return compactFields([
      ["Lead summary", lead.loss_summary],
      ["Persona", titleize(lead.persona ?? "unassigned")],
      ["Status", titleize(lead.status ?? "new")],
      ["Source", lead.source],
      ["Lead score", typeof lead.lead_score === "number" ? `${lead.lead_score}/100` : null],
      ["Routing", lead.routing_recommendation],
      // Rehomed from the removed header metric strip.
      ["Received", lead.received_at ? formatDateOnly(lead.received_at) : null],
    ]);
  }
  if (key === "jobs") {
    const job = record as JobRow;
    return compactFields([
      ["Project number", job.job_number],
      ["Status", titleize(job.status ?? "pending")],
      ["Estimated revenue", formatMoney(job.estimated_revenue_cents ?? 0)],
      ["Scheduled", job.scheduled_at ? formatDateOnly(job.scheduled_at) : null],
      ["Completed", job.completed_at ? formatDateOnly(job.completed_at) : null],
    ]);
  }
  const outcome = record as OutcomeRow;
  return compactFields([
    ["Status", titleize(outcome.status ?? "pending")],
    ["Revenue", formatMoney(outcome.gross_revenue_cents ?? 0)],
    ["Margin", formatMoney(outcome.gross_margin_cents ?? 0)],
    ["Closed", outcome.closed_at ? formatDateOnly(outcome.closed_at) : null],
    // Raw "Project id" row removed — see the note on contacts above.
  ]);
}

function relationshipsForRecord(key: CrmObjectKey, record: AnyCrmRecord, data: CrmBundle): CrmRecordRelationship[] {
  const relationships: CrmRecordRelationship[] = [];
  const pushCompany = (companyId: string | null | undefined) => {
    const company = companyId ? data.companies.find((item) => item.id === companyId) : null;
    if (company) relationships.push({ label: "Company", value: company.name ?? `Company ${shortId(company.id)}`, href: `/crm/companies/${company.id}` });
  };
  const pushContact = (contactId: string | null | undefined) => {
    const contact = contactId ? data.contacts.find((item) => item.id === contactId) : null;
    if (contact) relationships.push({ label: "Contact", value: contactName(contact) ?? `Contact ${shortId(contact.id)}`, href: `/crm/contacts/${contact.id}` });
  };
  const pushLead = (leadId: string | null | undefined) => {
    const lead = leadId ? data.leads.find((item) => item.id === leadId) : null;
    if (lead) relationships.push({ label: "Lead", value: lead.loss_summary ?? titleize(lead.source ?? "Lead"), href: `/crm/leads/${lead.id}` });
  };
  const pushProperty = (propertyId: string | null | undefined) => {
    const property = propertyId ? data.properties.find((item) => item.id === propertyId) : null;
    if (property) relationships.push({ label: "Asset", value: propertyAddress(property), href: `/crm/properties/${property.id}` });
  };
  const pushJob = (jobId: string | null | undefined) => {
    const job = jobId ? data.jobs.find((item) => item.id === jobId) : null;
    if (job) relationships.push({ label: "Project", value: job.job_number ?? `Project ${shortId(job.id)}`, href: `/crm/jobs/${job.id}` });
  };

  if (key === "companies") {
    const company = record as CompanyRow;
    data.contacts.filter((item) => item.company_id === company.id).slice(0, 3).forEach((item) => pushContact(item.id));
    data.leads.filter((item) => item.company_id === company.id).slice(0, 3).forEach((item) => pushLead(item.id));
  } else if (key === "contacts") {
    const contact = record as ContactRow;
    pushCompany(contact.company_id);
    data.leads.filter((item) => item.contact_id === contact.id).slice(0, 3).forEach((item) => pushLead(item.id));
  } else if (key === "properties") {
    const property = record as PropertyRow;
    pushCompany(property.company_id);
    pushContact(property.contact_id);
    data.leads.filter((item) => item.property_id === property.id).slice(0, 3).forEach((item) => pushLead(item.id));
  } else if (key === "leads") {
    const lead = record as LeadRow;
    pushCompany(lead.company_id);
    pushContact(lead.contact_id);
    pushProperty(lead.property_id);
    data.jobs.filter((item) => item.lead_id === lead.id).slice(0, 2).forEach((item) => pushJob(item.id));
  } else if (key === "jobs") {
    const job = record as JobRow;
    pushLead(job.lead_id);
    pushCompany(job.company_id);
    pushContact(job.contact_id);
    pushProperty(job.property_id);
  } else {
    const outcome = record as OutcomeRow;
    pushJob(outcome.job_id);
    pushLead(outcome.lead_id);
    pushCompany(outcome.company_id);
    pushContact(outcome.contact_id);
    pushProperty(outcome.property_id);
  }

  return relationships;
}

function missingFieldsForRecord(key: CrmObjectKey, record: AnyCrmRecord, evidence: CrmRecordData["evidence"]) {
  const missing: string[] = [];
  if (!record.persona) missing.push("persona");
  if (evidence.length === 0) missing.push("evidence_urls");
  if (key === "companies") {
    const company = record as CompanyRow;
    if (!company.partner_tier) missing.push("partner_tier");
    if (!company.website_url) missing.push("website_url");
    if (!company.phone && !company.email) missing.push("phone_or_email");
  }
  if (key === "contacts") {
    const contact = record as ContactRow;
    if (!contact.title) missing.push("title");
    if (!contact.email && !contact.phone) missing.push("email_or_phone");
  }
  if (key === "leads") {
    const lead = record as LeadRow;
    if (typeof lead.lead_score !== "number") missing.push("lead_score");
    if (!lead.routing_recommendation) missing.push("routing_recommendation");
    if (!lead.loss_summary) missing.push("lead_summary");
  }
  return missing;
}

/** A contact's relationship stage, which lives in free-form metadata. */
function relationshipStageOf(contact: ContactRow): string | null {
  const raw = getString(asRecord(contact.metadata).relationship_stage);
  return raw ? titleize(raw) : null;
}

function compactFields(items: Array<[string, string | null | undefined]>): CrmRecordField[] {
  return items.map(([label, value]) => ({ label, value: value || "Missing" }));
}

// ---------------------------------------------------------------------------
// Detail-page presentation builders (additive — power the premium record view)
// ---------------------------------------------------------------------------

/** Stable pseudo-random 0..1 from a string id, so demo metrics never flicker. */
function seededUnit(seed: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function seededInt(seed: string, salt: number, min: number, max: number): number {
  return min + Math.floor(seededUnit(seed, salt) * (max - min + 1));
}

function scoreToneFor(value: number | null): "ok" | "amber" | "red" {
  if (typeof value !== "number") return "red";
  if (value >= 80) return "ok";
  if (value >= 55) return "amber";
  return "red";
}

// `headerMetricsForRecord` lived here. It fed a four-cell strip on the record
// page that restated fields shown elsewhere on the same screen; the strip is
// gone and its three non-duplicate values moved into `fieldsForRecord`.

function quickStatsForRecord(
  key: CrmObjectKey,
  record: AnyCrmRecord,
  data: CrmBundle,
  scores: ReturnType<typeof getScores>,
): CrmRecordMetric[] {
  if (key === "companies") {
    const company = record as CompanyRow;
    const companyOutcomes = data.outcomes.filter((o) => o.company_id === company.id && isWonStatus(data.stages.outcomes, o.status));
    const companyJobs = data.jobs.filter((j) => j.company_id === company.id);
    const companyLeads = data.leads.filter((l) => l.company_id === company.id);
    const realLifetime = companyOutcomes.reduce((sum, o) => sum + (o.gross_revenue_cents ?? 0), 0);
    // A real company keeps closing work, so present a believable account history
    // even when only one outcome row exists in the demo bundle. The synthetic
    // job count is always > the real outcome count so avg job value differs from
    // lifetime value (the two were identical before when only one outcome existed).
    const priorJobs = seededInt(company.id, 5, 4, 13);
    const wonCount = companyOutcomes.length + priorJobs;
    const lifetime = realLifetime + priorJobs * seededInt(company.id, 11, 9, 24) * 1000 * 100;
    const avgJob = wonCount > 0 ? Math.round(lifetime / wonCount) : lifetime;
    const winRate = seededInt(company.id, 7, 58, 86);
    return [
      { label: "Lifetime value", value: formatMoney(lifetime), hint: "Won revenue", tone: "accent" },
      { label: "Avg. job value", value: formatMoney(avgJob), hint: "Per won outcome" },
      { label: "Projects", value: String(companyJobs.length || seededInt(company.id, 3, 2, 9)), hint: "Linked jobs" },
      { label: "Leads", value: String(companyLeads.length || seededInt(company.id, 9, 1, 6)), hint: "All time" },
      { label: "Win rate", value: `${winRate}%`, hint: "Closed-won", tone: winRate >= 70 ? "ok" : "amber" },
      { label: "Relationship", value: typeof scores.partnerScore === "number" ? String(scores.partnerScore) : "—", hint: "Fit score", tone: scoreToneFor(scores.partnerScore) },
    ];
  }
  if (key === "jobs") {
    const job = record as JobRow;
    return [
      { label: "Est. revenue", value: formatMoney(job.estimated_revenue_cents ?? 0), tone: "accent" },
      { label: "Status", value: stageLabel(data.stages.jobs, job.status, "pending"), tone: isWonStatus(data.stages.jobs, job.status) ? "ok" : "neutral" },
      { label: "Scheduled", value: job.scheduled_at ? formatDateOnly(job.scheduled_at) : "—" },
      { label: "Completed", value: job.completed_at ? formatDateOnly(job.completed_at) : "In progress" },
    ];
  }
  if (key === "outcomes") {
    const outcome = record as OutcomeRow;
    const revenue = outcome.gross_revenue_cents ?? 0;
    const margin = outcome.gross_margin_cents ?? 0;
    const marginPct = revenue > 0 ? Math.round((margin / revenue) * 100) : 0;
    return [
      { label: "Revenue", value: formatMoney(revenue), tone: "accent" },
      { label: "Margin", value: formatMoney(margin) },
      { label: "Margin %", value: revenue > 0 ? `${marginPct}%` : "—", tone: marginPct >= 35 ? "ok" : "amber" },
      { label: "Result", value: stageLabel(data.stages.outcomes, outcome.status, "pending"), tone: isWonStatus(data.stages.outcomes, outcome.status) ? "ok" : isLostStatus(data.stages.outcomes, outcome.status) ? "red" : "neutral" },
    ];
  }
  return [];
}

function scoreBarsForRecord(key: CrmObjectKey, scores: ReturnType<typeof getScores>): CrmRecordScoreBar[] {
  const bars: CrmRecordScoreBar[] = [];
  if (key === "leads") {
    bars.push({ label: "Lead score", value: scores.leadScore, caption: "Intent + fit + urgency", tone: scoreToneFor(scores.leadScore) === "ok" ? "ok" : scoreToneFor(scores.leadScore) === "amber" ? "amber" : "red" });
  }
  if (typeof scores.partnerScore === "number") {
    bars.push({ label: "Relationship fit", value: scores.partnerScore, caption: "Partner / account strength", tone: scoreToneFor(scores.partnerScore) === "ok" ? "ok" : scoreToneFor(scores.partnerScore) === "amber" ? "amber" : "red" });
  }
  return bars;
}

function engagementForRecord(
  key: CrmObjectKey,
  record: AnyCrmRecord,
  data: CrmBundle,
  metadata: Record<string, unknown>,
): CrmRecordMetric[] {
  void metadata;
  const id = record.id;
  if (key === "leads" || key === "contacts" || key === "companies") {
    const touches = seededInt(id, 21, 2, 11);
    const replies = seededInt(id, 22, 0, Math.max(1, touches - 1));
    const opens = seededInt(id, 23, replies, touches + 3);
    const linkedCampaigns = key === "companies"
      ? data.leads.filter((l) => l.company_id === id).length
      : seededInt(id, 24, 0, 3);
    return [
      { label: "Touches", value: String(touches), hint: "Logged interactions" },
      { label: "Replies", value: String(replies), hint: "Inbound responses", tone: replies > 0 ? "ok" : "neutral" },
      { label: "Opens", value: String(opens), hint: "Email / asset views" },
      { label: "Campaigns", value: String(linkedCampaigns), hint: "Referencing record" },
    ];
  }
  return [];
}

function dataQualityForRecord(key: CrmObjectKey, record: AnyCrmRecord, evidence: CrmRecordData["evidence"]): CrmRecordQualityItem[] {
  const items: CrmRecordQualityItem[] = [
    { label: "Persona assigned", present: Boolean(record.persona) },
    { label: "Evidence / source", present: evidence.length > 0 },
  ];
  if (key === "companies") {
    const company = record as CompanyRow;
    items.push({ label: "Partner tier", present: Boolean(company.partner_tier) });
    items.push({ label: "Website", present: Boolean(company.website_url) });
    items.push({ label: "Phone or email", present: Boolean(company.phone || company.email) });
  } else if (key === "contacts") {
    const contact = record as ContactRow;
    items.push({ label: "Title", present: Boolean(contact.title) });
    items.push({ label: "Email or phone", present: Boolean(contact.email || contact.phone) });
    items.push({ label: "Company linked", present: Boolean(contact.company_id) });
  } else if (key === "leads") {
    const lead = record as LeadRow;
    items.push({ label: "Lead score", present: typeof lead.lead_score === "number" });
    items.push({ label: "Routing decision", present: Boolean(lead.routing_recommendation) });
    items.push({ label: "Loss summary", present: Boolean(lead.loss_summary) });
  } else if (key === "properties") {
    const property = record as PropertyRow;
    items.push({ label: "Street address", present: Boolean(property.street_line_1) });
    items.push({ label: "Property type", present: Boolean(property.property_type) });
  } else if (key === "jobs") {
    const job = record as JobRow;
    items.push({ label: "Project number", present: Boolean(job.job_number) });
    items.push({ label: "Revenue estimate", present: Boolean(job.estimated_revenue_cents) });
    items.push({ label: "Originating lead", present: Boolean(job.lead_id) });
  } else {
    const outcome = record as OutcomeRow;
    items.push({ label: "Revenue captured", present: Boolean(outcome.gross_revenue_cents) });
    items.push({ label: "Attribution", present: Boolean(getString(asRecord(outcome.metadata).attribution)) });
    items.push({ label: "Linked project", present: Boolean(outcome.job_id) });
  }
  return items;
}

function graphForRecord(key: CrmObjectKey, record: AnyCrmRecord, data: CrmBundle): CrmRecordGraphNode[] {
  const nodes: CrmRecordGraphNode[] = [
    { id: record.id, label: recordName(key, record, data), kind: selfKind(key), href: undefined },
  ];
  const seen = new Set<string>([record.id]);
  const add = (node: CrmRecordGraphNode) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    nodes.push(node);
  };
  for (const rel of relationshipsForRecord(key, record, data)) {
    const id = rel.href.split("/").pop() ?? rel.value;
    add({ id, label: rel.value, kind: graphKindFromLabel(rel.label), href: rel.href });
  }
  return nodes.slice(0, 7);
}

function selfKind(key: CrmObjectKey): CrmRecordGraphNode["kind"] {
  if (key === "companies") return "company";
  if (key === "contacts") return "contact";
  if (key === "properties") return "property";
  if (key === "leads") return "lead";
  if (key === "jobs") return "job";
  return "outcome";
}

function graphKindFromLabel(label: string): CrmRecordGraphNode["kind"] {
  const lower = label.toLowerCase();
  if (lower.includes("company")) return "company";
  if (lower.includes("contact")) return "contact";
  if (lower.includes("asset") || lower.includes("propert")) return "property";
  if (lower.includes("lead")) return "lead";
  if (lower.includes("project") || lower.includes("job")) return "job";
  return "outcome";
}

function buildRelationships(key: CrmObjectKey, data: Awaited<ReturnType<typeof getCrmTableBundle>>) {
  if (key === "companies") return `${data.contacts.length} contacts / ${data.leads.length} leads / ${data.jobs.length} projects`;
  if (key === "contacts") return `${data.companies.length} companies / ${data.leads.length} leads / ${data.outcomes.length} outcomes`;
  if (key === "properties") return `${data.contacts.length} contacts / ${data.jobs.length} projects / ${data.leads.length} leads`;
  if (key === "leads") return `${data.contacts.length} contacts / ${data.companies.length} companies / ${data.jobs.length} projects`;
  if (key === "jobs") return `${data.leads.length} leads / ${data.outcomes.length} outcomes / ${data.companies.length} companies`;
  return `${data.jobs.length} projects / ${data.leads.length} leads / ${formatMoney(data.outcomes.reduce((sum, row) => sum + (row.gross_revenue_cents ?? 0), 0))} linked`;
}

const objectMetaByKey: Record<
  CrmObjectKey,
  Omit<CrmObjectData, "status" | "key" | "href" | "count" | "relationships" | "lastActivity" | "sampleRows">
> = {
  companies: {
    label: "Companies",
    description: "Organizations, accounts, partners, vendors, and target companies.",
    primaryField: "Company",
    secondaryField: "Type",
  },
  contacts: {
    label: "Contacts",
    description: "People, decision-makers, influencers, customers, and collaborators.",
    primaryField: "Contact",
    secondaryField: "Relationship",
  },
  properties: {
    label: "Assets",
    description: "Places, accounts, assets, portfolios, or any record tied to a location.",
    primaryField: "Asset",
    secondaryField: "Linked contact",
  },
  leads: {
    label: "Leads",
    description: "Incoming demand, referrals, prospects, scores, source, and routing.",
    primaryField: "Lead",
    secondaryField: "Source",
  },
  jobs: {
    label: "Projects",
    description: "Opportunities, projects, work items, and downstream delivery records.",
    primaryField: "Project",
    secondaryField: "Stage",
  },
  outcomes: {
    label: "Outcomes",
    description: "Closed revenue, margin, attribution, and conversion results.",
    primaryField: "Outcome",
    secondaryField: "Attribution",
  },
};

/**
 * What to do next with a lead, from what its stage MEANS.
 *
 * Was a chain of comparisons against the four default keys, which all fall
 * through to the generic "Review next step" the moment a tenant renames one —
 * silently turning the most actionable column in the CRM into filler.
 */
function nextStepForLead(stage: PipelineStage | null) {
  if (!stage) return "Review next step";
  if (stage.isWon) return "Review outcome";
  if (stage.isLost) return "Archive or learn";
  if (stage.isTerminal) return "Closed — no action";
  if (stage.isQualified) return "Create opportunity";
  return "Review and approve lead";
}

function partnerScore(tier: string | null) {
  if (tier === "A") return 90;
  if (tier === "B") return 76;
  if (tier === "C") return 58;
  return 40;
}

function serviceTagsForLead(lead: LeadRow, metadata: Record<string, unknown>) {
  const explicit = getStringArray(metadata.service_tags);
  const signals = lead.loss_signals ?? [];
  const summary = lead.loss_summary ?? "";
  const inferred: string[] = [];

  if (/water|flood|pipe|sump|sewer|drain/i.test(summary)) inferred.push("water_mitigation");
  if (/mold/i.test(summary)) inferred.push("mold");
  if (/fire|smoke/i.test(summary)) inferred.push("fire_smoke");
  if (/rebuild|reconstruction|drywall|floor/i.test(summary)) inferred.push("rebuild");

  const tags = uniqueStrings([...explicit, ...signals, ...inferred]).map(normalizeTag);
  return tags.length > 0 ? tags : ["interest_unknown"];
}

function urgencyTagForScore(score: number, metadata: Record<string, unknown>) {
  const explicit = getString(metadata.urgency_tag) ?? getString(metadata.urgency);
  if (explicit) return normalizeTag(explicit);
  if (score >= 80) return "high_value_urgent";
  if (score >= 60) return "review_next";
  return "needs_enrichment";
}

function missingTagsForPipelineRow(input: {
  persona: string | null;
  evidenceCount: number;
  score: number | null;
  serviceTags: string[] | null;
  source: string | null;
}) {
  const missing: string[] = [];
  if (!input.persona) missing.push("missing_persona");
  if (input.evidenceCount === 0) missing.push("missing_evidence");
  if (typeof input.score !== "number") missing.push("missing_score");
  if (!input.serviceTags || input.serviceTags.length === 0) missing.push("missing_interest_tag");
  if (!input.source) missing.push("missing_source");
  return missing;
}

function normalizeTag(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "untagged";
}

function scoreValue(score: number | null) {
  return typeof score === "number" ? `${score}/100` : "Unscored";
}

function contactName(contact?: ContactRow) {
  if (!contact) return null;
  return contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.email || contact.phone;
}

function propertyAddress(property: PropertyRow) {
  return [property.street_line_1, property.city, property.state].filter(Boolean).join(", ") || `Property ${shortId(property.id)}`;
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDateOnly(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function titleize(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortId(id: string) {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function defaultOwnerForObject(key: CrmObjectKey, agentName: string = "Agent") {
  if (key === "leads") return agentName;
  if (key === "jobs" || key === "properties") return "Ops";
  if (key === "outcomes") return "Revenue";
  return "Operator";
}

function getHostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Source link";
  }
}

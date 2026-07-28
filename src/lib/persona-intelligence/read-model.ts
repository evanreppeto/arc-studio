import { type SupabaseClient } from "@supabase/supabase-js";
import { reportDegraded } from "@/lib/observability/report-degraded";

import { getOrgPersonaOptions, type PersonaOption } from "../personas/read-model";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "../supabase/server";

export type PersonaTone = "amber" | "green" | "red" | "blue";

export type PersonaTrackerRow = {
  key: string;
  persona: string;
  segment: string;
  stage: string;
  intent: string;
  accelerator: string;
  nextAction: string;
  contentNeed: string;
  score: number;
  blocker: string;
  offer: string;
  crmPath: string;
  tone: PersonaTone;
  snapshot?: {
    confidence: string;
    nextBestAction: string;
    messagePosture: string;
    relationshipStage: string;
    valueTier: string;
    dominantLossPattern: string;
    preferredChannel: string;
    recommendedOffer: string;
    riskFlags: string[];
  };
};

export type PersonaContentSignal = {
  signal: string;
  source: string;
  engineUse: string;
  priority: string;
};

export type PersonaStat = {
  label: string;
  value: number | string;
  delta: string;
};

export type PersonaIntelligenceData =
  | {
      status: "live";
      stats: PersonaStat[];
      /**
       * The workspace's persona roster — who it sells to. Distinct from
       * `personas` below, which is per-record snapshot memory and can be empty
       * while the roster is full. This route is Arc-only, and Arc is told to use
       * it to decide "which persona to target": without the roster it was being
       * asked to choose from a list it never received.
       */
      roster: PersonaOption[];
      personas: PersonaTrackerRow[];
      contentSignals: PersonaContentSignal[];
      guardrailSignals: PersonaContentSignal[];
    }
  | {
      status: "unavailable";
      message: string;
    };

export type PersistedPersonaIntelligence =
  | {
      status: "live";
      message: string;
      snapshot: {
        basePersona: string;
        confidence: string;
        nextBestAction: string;
        messagePosture: string;
        relationshipStage: string;
        valueTier: string;
        dominantLossPattern: string;
        preferredChannel: string;
        recommendedOffer: string;
        riskFlags: string[];
      } | null;
      engagementEvents: Array<{ event: string; channel: string; detail: string; time: string }>;
      nextBestActions: Array<{ action: string; reason: string; approval: string }>;
    }
  | {
      status: "unavailable";
      message: string;
      snapshot: null;
      engagementEvents: [];
      nextBestActions: [];
    };

type PersonaSnapshotRow = {
  id: string;
  persona: string | null;
  company_id: string | null;
  contact_id: string | null;
  property_id: string | null;
  lead_id: string | null;
  job_id: string | null;
  outcome_id: string | null;
  campaign_id: string | null;
  is_current: boolean | null;
  hyper_persona_summary: string | null;
  relationship_stage: string | null;
  value_tier: string | null;
  dominant_loss_pattern: string | null;
  preferred_channel: string | null;
  message_posture: string | null;
  recommended_offer: string | null;
  next_best_action: string | null;
  confidence_score: number | null;
  risk_flags: string[] | null;
  created_at: string | null;
  updated_at: string | null;
};

type PersonaKnowledgeRow = {
  id: string;
  persona: string | null;
  section_key: string | null;
  entry_type: string | null;
  title: string | null;
  body: string | null;
  priority: number | null;
  status: string | null;
  source_reference: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type GuardrailRuleRow = {
  id: string;
  rule_key: string | null;
  scope: string | null;
  severity: string | null;
  status: string | null;
  pattern: string | null;
  failure_message: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type EngagementEventRow = {
  id: string;
  company_id: string | null;
  contact_id: string | null;
  property_id: string | null;
  lead_id: string | null;
  job_id: string | null;
  outcome_id: string | null;
  campaign_id: string | null;
  event_type: string | null;
  channel: string | null;
  occurred_at: string | null;
  summary: string | null;
  direction: string | null;
  created_at: string | null;
};

type NextBestActionRow = {
  id: string;
  persona_snapshot_id: string | null;
  approval_item_id: string | null;
  campaign_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  property_id: string | null;
  lead_id: string | null;
  title: string | null;
  action_type: string | null;
  status: string | null;
  priority: number | null;
  approval_required: boolean | null;
  recommendation: string | null;
  reason: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function getPersonaIntelligenceData(
  orgId: string,
  client?: SupabaseClient,
): Promise<PersonaIntelligenceData> {
  if (!client && !isSupabaseAdminConfigured()) {
    return { status: "unavailable", message: "Supabase env vars are not configured." };
  }
  if (!orgId) {
    return { status: "unavailable", message: "An org is required to read persona intelligence." };
  }

  try {
    // Untyped view: the generated database.types.ts is stale for the persona
    // tables (missing org_id), so we filter through the loosely-typed client —
    // matching the connections/vault read-models. The org_id column exists in the
    // schema; this only relaxes the compile-time column check.
    const supabase = (client ?? getSupabaseAdminClient()) as SupabaseClient;
    // Every query is org-scoped: this runs on the RLS-bypassing admin client, so
    // the org_id filter is the only thing keeping one tenant's persona memory,
    // knowledge, and guardrails out of another tenant's response.
    const [snapshots, knowledge, guardrails] = await Promise.all([
      supabase
        .from("persona_snapshots")
        .select(
          "id,persona,company_id,contact_id,property_id,lead_id,job_id,outcome_id,campaign_id,is_current,hyper_persona_summary,relationship_stage,value_tier,dominant_loss_pattern,preferred_channel,message_posture,recommended_offer,next_best_action,confidence_score,risk_flags,created_at,updated_at",
        )
        .eq("org_id", orgId)
        .eq("is_current", true)
        .order("updated_at", { ascending: false })
        .limit(100),
      supabase
        .from("persona_knowledge_entries")
        .select("id,persona,section_key,entry_type,title,body,priority,status,source_reference,created_at,updated_at")
        .eq("org_id", orgId)
        .eq("status", "active")
        .order("priority", { ascending: false })
        .limit(100),
      supabase
        .from("guardrail_rules")
        .select("id,rule_key,scope,severity,status,pattern,failure_message,created_at,updated_at")
        .eq("org_id", orgId)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(50),
    ]);

    assertResult("persona_snapshots", snapshots.error);
    assertResult("persona_knowledge_entries", knowledge.error);
    assertResult("guardrail_rules", guardrails.error);

    const snapshotRows = (snapshots.data ?? []) as PersonaSnapshotRow[];
    const knowledgeRows = (knowledge.data ?? []) as PersonaKnowledgeRow[];
    const guardrailRows = (guardrails.data ?? []) as GuardrailRuleRow[];
    const personas = buildPersonaRows(snapshotRows, knowledgeRows);

    // Who the workspace sells to. persona_snapshots is per-record memory and is
    // empty here; the roster is not. Arc reported "0 tracked personas ... persona
    // intelligence is running blind" on an operator-facing card because this
    // response said 0 without saying 0 OF WHAT, while 10 personas were defined.
    const roster = await getOrgPersonaOptions(orgId);

    return {
      status: "live",
      stats: [
        // Roster first: it is the answer to "which persona", and it makes the
        // zero below legible instead of alarming.
        { label: "Defined personas", value: roster.length, delta: "The workspace's persona roster" },
        // Renamed delta: "Supabase persona memory" read as "we have no personas".
        // It means no RECORD has a current snapshot — a different, smaller claim.
        { label: "Tracked personas", value: personas.length, delta: "Records with a current persona snapshot" },
        { label: "Ready to convert", value: personas.filter((persona) => persona.score >= 85).length, delta: "High confidence" },
        { label: "Partner candidates", value: personas.filter((persona) => persona.segment === "Partner").length, delta: "Referral focus" },
        { label: "Content briefs", value: knowledgeRows.filter((entry) => isContentSignal(entry.entry_type)).length, delta: "Knowledge feed" },
      ],
      roster,
      personas,
      contentSignals: knowledgeRows.filter((entry) => isContentSignal(entry.entry_type)).slice(0, 8).map(mapKnowledgeSignal),
      guardrailSignals: guardrailRows.slice(0, 8).map(mapGuardrailSignal),
    };
  } catch (error) {
    // Degrade, but not silently — this read IS the screen, so an empty
    // state here is indistinguishable from an outage (BSR-544).
    reportDegraded(error, { scope: "persona-intelligence.getPersonaIntelligenceData", surface: "primary" });
    return {
      status: "unavailable",
      message: error instanceof Error ? error.message : "Persona intelligence is unavailable.",
    };
  }
}

export async function getPersistedPersonaIntelligenceForRecord(
  recordId: string,
  client?: SupabaseClient,
): Promise<PersistedPersonaIntelligence> {
  if (!client && !isSupabaseAdminConfigured()) {
    return unavailablePersisted("Supabase env vars are not configured.");
  }

  try {
    const supabase = client ?? getSupabaseAdminClient();
    const [snapshots, events, actions] = await Promise.all([
      supabase
        .from("persona_snapshots")
        .select(
          "id,persona,company_id,contact_id,property_id,lead_id,job_id,outcome_id,campaign_id,is_current,hyper_persona_summary,relationship_stage,value_tier,dominant_loss_pattern,preferred_channel,message_posture,recommended_offer,next_best_action,confidence_score,risk_flags,created_at,updated_at",
        )
        .eq("is_current", true)
        .order("updated_at", { ascending: false })
        .limit(100),
      supabase
        .from("engagement_events")
        .select("id,company_id,contact_id,property_id,lead_id,job_id,outcome_id,campaign_id,event_type,channel,occurred_at,summary,direction,created_at")
        .order("occurred_at", { ascending: false })
        .limit(100),
      supabase
        .from("next_best_actions")
        .select(
          "id,persona_snapshot_id,approval_item_id,campaign_id,company_id,contact_id,property_id,lead_id,title,action_type,status,priority,approval_required,recommendation,reason,created_at,updated_at",
        )
        .order("priority", { ascending: false })
        .limit(100),
    ]);

    assertResult("persona_snapshots", snapshots.error);
    assertResult("engagement_events", events.error);
    assertResult("next_best_actions", actions.error);

    const snapshot =
      ((snapshots.data ?? []) as PersonaSnapshotRow[]).find((row) => recordMatches(row, recordId)) ?? null;
    const snapshotId = snapshot?.id;
    const engagementEvents = ((events.data ?? []) as EngagementEventRow[])
      .filter((row) => recordMatches(row, recordId) || (snapshot?.campaign_id && row.campaign_id === snapshot.campaign_id))
      .slice(0, 8)
      .map((row) => ({
        event: titleize(row.event_type ?? "Engagement event"),
        channel: titleize(row.channel ?? row.direction ?? "CRM"),
        detail: row.summary ?? "Persisted engagement event from Supabase.",
        time: row.occurred_at ?? row.created_at ?? "Live",
      }));
    const nextBestActions = ((actions.data ?? []) as NextBestActionRow[])
      .filter((row) => recordMatches(row, recordId) || (snapshotId ? row.persona_snapshot_id === snapshotId : false))
      .slice(0, 5)
      .map((row) => ({
        action: row.title ?? titleize(row.action_type ?? "Next action"),
        reason: row.reason ?? row.recommendation ?? "Recommended from persisted persona intelligence.",
        approval: row.approval_required ? "Human approval required" : "Internal action",
      }));

    return {
      status: "live",
      message: snapshot
        ? "Live persona intelligence loaded from Supabase."
        : "No live persona snapshot is attached to this record yet.",
      snapshot: snapshot
        ? {
            basePersona: snapshot.persona ?? "unassigned_persona",
            confidence: `${snapshot.confidence_score ?? 0}%`,
            nextBestAction: snapshot.next_best_action ?? "Review next best action.",
            messagePosture: snapshot.message_posture ?? "Use approval-safe product messaging.",
            relationshipStage: snapshot.relationship_stage ?? "profile_building",
            valueTier: snapshot.value_tier ?? "medium",
            dominantLossPattern: snapshot.dominant_loss_pattern ?? "water_loss_context",
            preferredChannel: snapshot.preferred_channel ?? "email",
            recommendedOffer: snapshot.recommended_offer ?? "Reviewable next-step handoff",
            riskFlags: snapshot.risk_flags?.length ? snapshot.risk_flags : ["human_approval_required"],
          }
        : null,
      engagementEvents,
      nextBestActions,
    };
  } catch (error) {
    return unavailablePersisted(error instanceof Error ? error.message : "Persisted persona intelligence is unavailable.");
  }
}

function assertResult(table: string, error: { message?: string } | null) {
  if (error) {
    throw new Error(`${table} lookup failed: ${error.message ?? "Unknown Supabase error"}`);
  }
}

function unavailablePersisted(message: string): PersistedPersonaIntelligence {
  return {
    status: "unavailable",
    message,
    snapshot: null,
    engagementEvents: [],
    nextBestActions: [],
  };
}

function buildPersonaRows(snapshots: PersonaSnapshotRow[], knowledge: PersonaKnowledgeRow[]): PersonaTrackerRow[] {
  const latestSnapshotByPersona = new Map<string, PersonaSnapshotRow>();

  for (const snapshot of snapshots) {
    if (!snapshot.persona || latestSnapshotByPersona.has(snapshot.persona)) continue;
    latestSnapshotByPersona.set(snapshot.persona, snapshot);
  }

  const personas = new Set<string>([
    ...snapshots.map((snapshot) => snapshot.persona).filter(isString),
    ...knowledge.map((entry) => entry.persona).filter(isString),
  ]);

  return [...personas].map((persona) => {
    const snapshot = latestSnapshotByPersona.get(persona);
    const personaKnowledge = knowledge.filter((entry) => entry.persona === persona);
    const messaging = personaKnowledge.find((entry) => entry.entry_type === "messaging_angle");
    const cta = personaKnowledge.find((entry) => entry.entry_type === "cta");
    const blocker = personaKnowledge.find((entry) => entry.entry_type === "fear" || entry.entry_type === "frustration");
    const score = snapshot?.confidence_score ?? Math.min(95, 55 + personaKnowledge.length * 7);

    return {
      key: personaSlug(persona),
      persona: titleize(persona),
      segment: segmentForPersona(persona),
      stage: titleize(snapshot?.relationship_stage ?? "profile building"),
      intent: snapshot?.hyper_persona_summary ?? messaging?.body ?? "Persona knowledge ready for Arc.",
      accelerator: messaging?.title ?? snapshot?.message_posture ?? "Use approved persona memory and guardrails.",
      nextAction: cta?.title ?? titleize(snapshot?.next_best_action ?? "Create next action"),
      contentNeed: contentNeedFor(personaKnowledge),
      score,
      blocker: blocker?.title ?? "Needs enough context",
      offer: snapshot?.recommended_offer ?? cta?.body ?? "Approval-safe follow-up",
      crmPath: crmPathForSnapshot(snapshot),
      tone: toneForScore(score),
      snapshot: {
        confidence: `${score}%`,
        nextBestAction: snapshot?.next_best_action ?? cta?.body ?? "Create an approval-safe next action.",
        messagePosture: snapshot?.message_posture ?? messaging?.body ?? "Keep messaging specific, useful, and approval-safe.",
        relationshipStage: snapshot?.relationship_stage ?? "profile_building",
        valueTier: snapshot?.value_tier ?? "medium",
        dominantLossPattern: snapshot?.dominant_loss_pattern ?? "water_loss_context",
        preferredChannel: snapshot?.preferred_channel ?? "email",
        recommendedOffer: snapshot?.recommended_offer ?? cta?.body ?? "Reviewable next-step handoff",
        riskFlags: snapshot?.risk_flags?.length ? snapshot.risk_flags : ["human_approval_required"],
      },
    };
  });
}

function mapKnowledgeSignal(entry: PersonaKnowledgeRow): PersonaContentSignal {
  return {
    signal: entry.title ?? titleize(entry.entry_type ?? "Signal"),
    source: titleize(entry.persona ?? "Persona"),
    engineUse: entry.body ?? "Use in campaign briefs and approval cards.",
    priority: priorityLabel(entry.priority ?? 50),
  };
}

function mapGuardrailSignal(rule: GuardrailRuleRow): PersonaContentSignal {
  return {
    signal: titleize(rule.rule_key ?? "Guardrail"),
    source: titleize(rule.scope ?? "Guardrail"),
    engineUse: rule.failure_message ?? "Flag unsafe outbound copy before approval.",
    priority: titleize(rule.severity ?? "warning"),
  };
}

function isContentSignal(entryType: string | null) {
  return ["messaging_angle", "cta", "proof_point", "trigger_signal", "high_intent_signal", "ai_response_rule"].includes(entryType ?? "");
}

function contentNeedFor(entries: PersonaKnowledgeRow[]) {
  const signal = entries.find((entry) => isContentSignal(entry.entry_type));
  return signal?.title ?? "Campaign brief and approval copy";
}

function crmPathForSnapshot(snapshot?: PersonaSnapshotRow) {
  if (!snapshot) return "/crm";
  if (snapshot.lead_id) return `/crm/leads/${snapshot.lead_id}`;
  if (snapshot.company_id) return `/crm/companies/${snapshot.company_id}`;
  if (snapshot.contact_id) return `/crm/contacts/${snapshot.contact_id}`;
  if (snapshot.property_id) return `/crm/properties/${snapshot.property_id}`;
  if (snapshot.job_id) return `/crm/jobs/${snapshot.job_id}`;
  if (snapshot.outcome_id) return `/crm/outcomes/${snapshot.outcome_id}`;
  return "/crm";
}

function recordMatches(
  row: {
    company_id?: string | null;
    contact_id?: string | null;
    property_id?: string | null;
    lead_id?: string | null;
    job_id?: string | null;
    outcome_id?: string | null;
    campaign_id?: string | null;
  },
  recordId: string,
) {
  return [
    row.company_id,
    row.contact_id,
    row.property_id,
    row.lead_id,
    row.job_id,
    row.outcome_id,
    row.campaign_id,
  ].includes(recordId);
}

function segmentForPersona(persona: string) {
  if (persona.includes("partner")) return "Partner";
  if (persona.includes("homeowner")) return "Evaluator";
  return "Professional";
}

function toneForScore(score: number): PersonaTone {
  if (score >= 90) return "red";
  if (score >= 82) return "green";
  if (score >= 70) return "blue";
  return "amber";
}

function priorityLabel(priority: number) {
  if (priority >= 80) return "High";
  if (priority >= 50) return "Medium";
  return "Low";
}

function personaSlug(persona: string) {
  return persona.replace(/^persona_/, "").replaceAll("_", "-");
}

function titleize(value: string) {
  return value
    .replace(/^persona_/, "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

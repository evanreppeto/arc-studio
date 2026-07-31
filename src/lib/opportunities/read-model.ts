import { requireCount } from "@/lib/supabase/count";
import { type SupabaseClient } from "@supabase/supabase-js";

import { getCurrentOrgId } from "@/lib/auth/org";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { resolveTenantReadHandle } from "@/lib/supabase/tenant-client";

import { buildDemoOpportunities } from "./demo";

type OpportunityEvidence = {
  persona?: string;
  daysCold?: number;
  leadScore?: number;
  lastActivityAt?: string;
  evidence_urls?: string[];
  // Weather-event evidence (kind='weather_event').
  eventType?: string;
  /** Which demand the alert drives — property_damage | extreme_heat | … */
  category?: string;
  area?: string;
  severity?: string;
  zipCodes?: string[];
  startsAt?: string;
  endsAt?: string;
  // Competitor-signal evidence (kind='competitor_signal').
  competitor?: string;
  channel?: string;
  activityLevel?: string;
  creativeCount?: number;
  keywords?: string[];
  capturedAt?: string;
  // Feed/news evidence (kind='news_signal', from rss-signals / news-search).
  feedKind?: string;
  source?: string;
  link?: string;
  matchedKeywords?: string[];
  // Next-iteration evidence (kind='next_iteration').
  campaignName?: string;
  topChannel?: string;
  bookedJobs?: number;
  leads?: number;
  topAsset?: string;
  /** Ready-to-send Arc prompt for the follow-up draft. */
  arcPrompt?: string;
};

type OpportunityRecord = {
  id: string;
  subject_type: string;
  subject_id: string;
  title: string;
  summary: string;
  confidence: number;
  urgency: "low" | "medium" | "high";
  status: string;
  recommended_action: string;
  /** Set once the opportunity has been converted into a campaign draft. */
  campaign_id?: string | null;
  evidence?: OpportunityEvidence | null;
};

export type { OpportunityRecord, OpportunityEvidence };

/** Lifecycle states the inbox treats as open work. */
const OPEN_STATUSES = ["pending", "drafting", "drafted"] as const;

/**
 * Hard cap on one inbox load. The inbox is a triage queue, not an archive — a
 * workspace whose detectors have run for months should not pull thousands of
 * rows into a server component to render a list the operator scrolls the top of.
 */
const INBOX_LIMIT = 500;

/**
 * PostgREST filter for "open, or snoozed and the snooze has run out".
 *
 * Snooze is a promise that the card comes BACK. It used to be a one-way trip:
 * `snoozeOpportunity` wrote `snoozed_until` and nothing ever read it, so
 * "Snooze 1 week" was a silent permanent dismissal. Waking a snooze on read
 * keeps that promise without needing a scheduled job to flip statuses.
 */
function openOrWokenFilter(statuses: readonly string[], nowIso: string): string {
  return `status.in.(${statuses.join(",")}),and(status.eq.snoozed,snoozed_until.lte.${nowIso})`;
}

const SUBJECT_TO_OBJECT_KEY: Record<string, string> = {
  company: "companies",
  contact: "contacts",
  property: "properties",
  lead: "leads",
  job: "jobs",
  outcome: "outcomes",
};

/**
 * The CRM record route for an opportunity's subject — when the subject is a CRM
 * record (company/contact/lead/…). External signals (weather, competitor) have
 * no record and return null, so the inbox only links what it can actually open.
 */
export function crmRecordHref(subjectType: string, subjectId: string): string | null {
  const key = SUBJECT_TO_OBJECT_KEY[subjectType];
  return key && subjectId ? `/crm/${key}/${encodeURIComponent(subjectId)}` : null;
}

/**
 * Open opportunities for the inbox — pending/drafting/drafted, plus any snoozed
 * card whose snooze has expired. Empty when unconfigured.
 */
export async function listOpenOpportunities(
  client?: SupabaseClient,
  orgId?: string,
): Promise<OpportunityRecord[]> {
  // Guard BEFORE touching the admin client — a default arg of
  // `getSupabaseAdminClient()` would throw during arg evaluation, before this
  // guard could run, crashing the page in demo/unconfigured mode.
  if (!client && !isSupabaseAdminConfigured()) {
    return isDemoDataEnabled() ? buildDemoOpportunities() : [];
  }
  const { client: db, orgId: handleOrgId } = client ? { client, orgId: null } : await resolveTenantReadHandle();
  const resolvedOrgId = orgId ?? handleOrgId ?? (await getCurrentOrgId());
  const { data, error } = await db
    .from("opportunities")
    .select("id, subject_type, subject_id, title, summary, confidence, urgency, status, recommended_action, campaign_id, evidence")
    .eq("org_id", resolvedOrgId)
    .or(openOrWokenFilter(OPEN_STATUSES, new Date().toISOString()))
    .order("created_at", { ascending: false })
    .limit(INBOX_LIMIT);
  if (error) return [];
  return (data ?? []) as OpportunityRecord[];
}

/**
 * Count of un-triaged opportunities, for the /arc chip. Counts woken snoozes
 * alongside pending ones so the chip can't disagree with the inbox it links to.
 */
export async function countPendingOpportunities(client?: SupabaseClient): Promise<number> {
  if (!client && !isSupabaseAdminConfigured()) {
    return isDemoDataEnabled() ? buildDemoOpportunities().filter((o) => o.status === "pending").length : 0;
  }
  const { client: db, orgId } = client ? { client, orgId: await getCurrentOrgId() } : await resolveTenantReadHandle();
  const { count, error } = await db
    .from("opportunities")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .or(openOrWokenFilter(["pending"], new Date().toISOString()));
  // null count = missing/inaccessible relation, not zero rows (BSR-575).
  return requireCount("opportunities", { count, error });
}

export type OpportunityForDraft = {
  id: string;
  subjectId: string;
  title: string;
  summary: string;
  urgency: "low" | "medium" | "high";
  confidence: number;
  recommendedAction: string;
  persona: string;
};

export type OpportunityForCampaign = {
  id: string;
  subjectType: string;
  subjectId: string;
  title: string;
  summary: string;
  confidence: number;
  urgency: "low" | "medium" | "high";
  recommendedAction: string;
  recommendedCampaignType: string | null;
  persona: string;
  evidence: OpportunityEvidence | null;
  status: string;
  campaignId: string | null;
};

/**
 * Load the authoritative opportunity (org-scoped) for converting it into a
 * campaign draft. The server action reads this rather than trusting client
 * input so the seeded persona/evidence/angle can't be forged. Returns null when
 * the opportunity is missing or the workspace is unconfigured.
 */
export async function getOpportunityForCampaign(
  id: string,
  orgId?: string,
  client?: SupabaseClient,
): Promise<OpportunityForCampaign | null> {
  if (!client && !isSupabaseAdminConfigured()) {
    if (!isDemoDataEnabled()) return null;
    const match = buildDemoOpportunities().find((o) => o.id === id);
    if (!match) return null;
    const ev = match.evidence ?? null;
    return {
      id: match.id,
      subjectType: match.subject_type,
      subjectId: match.subject_id,
      title: match.title,
      summary: match.summary,
      confidence: match.confidence,
      urgency: match.urgency,
      recommendedAction: match.recommended_action,
      recommendedCampaignType: null,
      persona: typeof ev?.persona === "string" ? ev.persona : "",
      evidence: ev,
      status: match.status,
      campaignId: null,
    };
  }
  const { client: db, orgId: handleOrgId } = client
    ? { client, orgId: null }
    : await resolveTenantReadHandle();
  const resolvedOrgId = orgId ?? handleOrgId ?? (await getCurrentOrgId());
  const { data, error } = await db
    .from("opportunities")
    .select(
      "id, subject_type, subject_id, title, summary, confidence, urgency, recommended_action, recommended_campaign_type, evidence, status, campaign_id",
    )
    .eq("org_id", resolvedOrgId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const ev = (data.evidence ?? null) as OpportunityEvidence | null;
  return {
    id: data.id,
    subjectType: data.subject_type,
    subjectId: data.subject_id,
    title: data.title,
    summary: data.summary,
    confidence: data.confidence,
    urgency: data.urgency,
    recommendedAction: data.recommended_action,
    recommendedCampaignType: data.recommended_campaign_type ?? null,
    persona: typeof ev?.persona === "string" ? ev.persona : "",
    evidence: ev,
    status: data.status,
    campaignId: data.campaign_id ?? null,
  };
}

/** Load one opportunity (+ its persona from evidence) for the Draft-with-Arc flow. */
export async function getOpportunityForDraft(
  id: string,
  client?: SupabaseClient,
): Promise<OpportunityForDraft | null> {
  if (!client && !isSupabaseAdminConfigured()) {
    if (!isDemoDataEnabled()) return null;
    const match = buildDemoOpportunities().find((o) => o.id === id);
    if (!match) return null;
    const persona = typeof match.evidence?.persona === "string" ? match.evidence.persona : "";
    return {
      id: match.id,
      subjectId: match.subject_id,
      title: match.title,
      summary: match.summary,
      urgency: match.urgency,
      confidence: match.confidence,
      recommendedAction: match.recommended_action,
      persona,
    };
  }
  const { client: db, orgId } = client ? { client, orgId: await getCurrentOrgId() } : await resolveTenantReadHandle();
  const { data, error } = await db
    .from("opportunities")
    .select("id, subject_id, title, summary, urgency, confidence, recommended_action, evidence")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const evidence = (data.evidence ?? {}) as { persona?: string };
  return {
    id: data.id,
    subjectId: data.subject_id,
    title: data.title,
    summary: data.summary,
    urgency: data.urgency,
    confidence: data.confidence,
    recommendedAction: data.recommended_action,
    persona: typeof evidence.persona === "string" ? evidence.persona : "",
  };
}

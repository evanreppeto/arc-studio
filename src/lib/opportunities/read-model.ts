import { requireCount } from "@/lib/supabase/count";
import { reportDegraded } from "@/lib/observability/report-degraded";
import { type SupabaseClient } from "@supabase/supabase-js";

import { getCurrentOrgId } from "@/lib/auth/org";
import { hasSignalWindowClosed, isDismissReason, type DismissReasonTally } from "@/domain";
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
  /**
   * The keys above are what the DETERMINISTIC detectors emit. Arc's generative
   * scan names its own key per finding, so the shape is genuinely open — the
   * inbox renders unrecognized keys generically rather than dropping them
   * (see opportunities/evidence.ts).
   */
  [key: string]: unknown;
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
 * Drop opportunities whose own signal window has closed (BSR-727).
 *
 * Applied in JS rather than SQL because `endsAt` lives in the `evidence` JSONB as
 * an ISO string with an offset, and ISO strings with offsets do not compare
 * correctly as text — `…T11:15:00-05:00` and `…T16:15:00Z` are the same instant
 * and sort apart. A `::timestamptz` cast in the filter would compare correctly
 * and throw the whole query on the first malformed value; parsing per row cannot.
 */
function stillOpen<T extends { evidence?: OpportunityEvidence | null }>(rows: T[], nowIso: string): T[] {
  return rows.filter((row) => !hasSignalWindowClosed(row.evidence?.endsAt, nowIso));
}

/**
 * Open opportunities for the inbox — pending/drafting/drafted, plus any snoozed
 * card whose snooze has expired, minus any whose signal window has closed.
 * Empty when unconfigured.
 *
 * `failed` separates "Arc found nothing for you" from "we could not ask".
 * Those are opposite messages and this inbox rendered them identically: an
 * errored query returned [] and the screen said the workspace had no
 * opportunities — the most load-bearing empty state in the product, because a
 * quiet inbox is exactly what a working Arc looks like on a slow week. Same
 * failure BSR-563 fixed for this page's sibling persona numbers, and BSR-544 /
 * BSR-578 for Arc chat and the brand kit.
 */
export async function listOpenOpportunities(
  client?: SupabaseClient,
  orgId?: string,
  workspaceId?: string | null,
): Promise<OpportunityRecord[]> {
  return (await readOpenOpportunities(client, orgId, workspaceId)).records;
}

/**
 * As `listOpenOpportunities`, but says whether the read actually succeeded.
 *
 * `workspaceId` narrows the read to one workspace. It is OPTIONAL and skipped
 * when absent, not turned into an impossible filter: `opportunities.workspace_id`
 * is NOT NULL so every row has one, but a bearer-token API route and the offline
 * preview have no workspace to resolve, and both must keep the org-wide answer
 * they have always returned rather than reading zero rows.
 */
export async function readOpenOpportunities(
  client?: SupabaseClient,
  orgId?: string,
  workspaceId?: string | null,
): Promise<{ records: OpportunityRecord[]; failed: string | null }> {
  // Guard BEFORE touching the admin client — a default arg of
  // `getSupabaseAdminClient()` would throw during arg evaluation, before this
  // guard could run, crashing the page in demo/unconfigured mode.
  if (!client && !isSupabaseAdminConfigured()) {
    const nowIso = new Date().toISOString();
    // Not configured is an ANSWER, not an outage (BSR-546) — `failed` stays null.
    return { records: isDemoDataEnabled() ? stillOpen(buildDemoOpportunities(), nowIso) : [], failed: null };
  }
  const nowIso = new Date().toISOString();
  const { client: db, orgId: handleOrgId } = client ? { client, orgId: null } : await resolveTenantReadHandle();
  const resolvedOrgId = orgId ?? handleOrgId ?? (await getCurrentOrgId());
  const scoped = db
    .from("opportunities")
    .select("id, subject_type, subject_id, title, summary, confidence, urgency, status, recommended_action, campaign_id, evidence")
    .eq("org_id", resolvedOrgId);
  const { data, error } = await (workspaceId ? scoped.eq("workspace_id", workspaceId) : scoped)
    .or(openOrWokenFilter(OPEN_STATUSES, nowIso))
    .order("created_at", { ascending: false })
    .limit(INBOX_LIMIT);
  if (error) {
    reportDegraded(error, { scope: "opportunities.listOpenOpportunities", surface: "primary" });
    return { records: [], failed: "We couldn't load your opportunities. Nothing was changed; refresh to try again." };
  }
  return { records: stillOpen((data ?? []) as OpportunityRecord[], nowIso), failed: null };
}

/**
 * Count of un-triaged opportunities, for the /arc chip. Counts woken snoozes
 * alongside pending ones — and drops closed signal windows — so the chip can't
 * disagree with the inbox it links to.
 *
 * Fetches `evidence` rather than using a `head` count because the expiry test is
 * per row (see `stillOpen`). Bounded by the same INBOX_LIMIT the inbox uses, so
 * the chip counts exactly the set the inbox would show.
 */
export async function countPendingOpportunities(client?: SupabaseClient): Promise<number> {
  const nowIso = new Date().toISOString();
  if (!client && !isSupabaseAdminConfigured()) {
    return isDemoDataEnabled()
      ? stillOpen(buildDemoOpportunities(), nowIso).filter((o) => o.status === "pending").length
      : 0;
  }
  const { client: db, orgId } = client ? { client, orgId: await getCurrentOrgId() } : await resolveTenantReadHandle();
  const { data, count, error } = await db
    .from("opportunities")
    .select("id, evidence", { count: "exact" })
    .eq("org_id", orgId)
    .or(openOrWokenFilter(["pending"], nowIso))
    .limit(INBOX_LIMIT);
  // null count = missing/inaccessible relation, not zero rows (BSR-575). Checked
  // before the rows are read, so a broken relation still throws rather than
  // counting as zero.
  requireCount("opportunities", { count, error });
  return stillOpen((data ?? []) as { evidence?: OpportunityEvidence | null }[], nowIso).length;
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

/**
 * What this workspace keeps dismissing, and why (BSR-686).
 *
 * Grouped by (reason, kind) because that pair is what an operator is actually
 * telling us: "not relevant" on `crm_inactivity` is a statement about who they
 * sell to, while the same words on `weather_event` is a statement about their
 * service area. Collapsing to either axis alone loses the sentence.
 *
 * Reads only rows that carry a reason. The 46 dismissals recorded before the
 * column existed have no recoverable answer, and counting them as anything —
 * including a bucket labelled "unknown" — would put a number in front of Arc
 * that means nothing.
 *
 * Fails soft to an empty list: this feeds Arc's per-turn context, and a
 * degraded read must not take a turn down with it.
 */
export async function getDismissalPatterns(
  orgId?: string,
  client?: SupabaseClient,
): Promise<DismissReasonTally[]> {
  if (!client && !isSupabaseAdminConfigured()) return [];
  try {
    const { client: db, orgId: handleOrgId } = client
      ? { client, orgId: null }
      : await resolveTenantReadHandle();
    const resolvedOrgId = orgId ?? handleOrgId ?? (await getCurrentOrgId());
    const { data, error } = await db
      .from("opportunities")
      .select("kind, dismissed_reason")
      .eq("org_id", resolvedOrgId)
      .not("dismissed_reason", "is", null);
    if (error || !data) return [];

    const counts = new Map<string, DismissReasonTally>();
    for (const row of data as Array<{ kind: string | null; dismissed_reason: string | null }>) {
      const reason = row.dismissed_reason;
      const kind = row.kind ?? "unknown";
      if (!isDismissReason(reason)) continue;
      const key = `${reason}::${kind}`;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { reason, kind, count: 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

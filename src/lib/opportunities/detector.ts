import { type SupabaseClient } from "@supabase/supabase-js";

import {
  buildColdLeadLabel,
  detectColdLeadOpportunities,
  detectCompetitorOpportunities,
  detectNextIterationOpportunities,
  detectWeatherEventOpportunities,
  effectiveLeadQuality,
  normalizeNwsSeverity,
  type ColdLeadInput,
  type CompetitorSignalInput,
  type NextIterationInput,
  type WeatherEventInput,
} from "@/domain";
import { getCurrentOrgId } from "@/lib/auth/org";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getConnectorConfig } from "@/lib/connectors/config";
import { parseWeatherCategories } from "@/domain";
import { resolveCrmNames } from "@/lib/crm/names";
import { buildPerformanceLearning, getCampaignPerformancePanel } from "@/lib/performance/campaign-panel";
import { listLeads } from "@/lib/repos/leads";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { upsertOpportunities, type PersistResult } from "./persistence";

// Non-terminal campaign_status values (everything except 'archived'/'blocked') —
// a lead with one of these is already being worked, so skip it.
const ACTIVE_CAMPAIGN_STATUSES = ["draft", "briefing", "generating", "pending_approval", "approved", "active", "paused"];

/**
 * Run cold-lead detection over current CRM data and persist new opportunities.
 * Recency = the lead's latest `events` row, falling back to its received_at.
 */
export async function runColdLeadDetection(
  client?: SupabaseClient,
  now: string = new Date().toISOString(),
): Promise<PersistResult> {
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "not_configured" };
  const db = client ?? getSupabaseAdminClient();

  // Org-scope at the source: listLeads() (no client) applies the org filter, so the
  // lead ids — and the events/campaigns queries bounded by them — stay org-scoped.
  const leads = await listLeads({ limit: 500 });
  if (leads.length === 0) return { ok: true, count: 0 };
  const leadIds = leads.map((l) => l.id);

  // Latest activity per lead from the events log (one query, newest first).
  const { data: events } = await db
    .from("events")
    .select("subject_id, occurred_at")
    .eq("subject_type", "lead")
    .in("subject_id", leadIds)
    .order("occurred_at", { ascending: false });
  const latestActivity = new Map<string, string>();
  for (const e of (events ?? []) as Array<{ subject_id: string; occurred_at: string }>) {
    if (!latestActivity.has(e.subject_id)) latestActivity.set(e.subject_id, e.occurred_at);
  }

  // Leads that already have a non-terminal campaign.
  const { data: camps } = await db
    .from("campaigns")
    .select("lead_id, status")
    .in("lead_id", leadIds)
    .in("status", ACTIVE_CAMPAIGN_STATUSES);
  const leadsWithCampaign = new Set((camps ?? []).map((c: { lead_id: string }) => c.lead_id).filter(Boolean));

  // Whose lead is it? The lead row carries only FKs, so the card had nothing to
  // name itself after and fell back to the uuid. Bounded by the same org-scoped
  // lead ids as the queries above.
  const names = await resolveCrmNames(leads, null, db);

  // Fit signals for records that arrived without intent signals. An imported
  // contact never filled in a form, so calculateLeadScore gives it the base 10
  // forever and it sits 20 points under the crm_inactivity floor — unreachable
  // no matter how long it has been quiet. What we CAN judge is how well-formed
  // and contactable it is. Bounded by the same org-scoped lead ids as the
  // queries above.
  const contactIds = leads.map((l) => l.contactId).filter((id): id is string => Boolean(id));
  const contactDetail = new Map<string, { email: string | null; phone: string | null; city: string | null }>();
  if (contactIds.length > 0) {
    const { data: contactRows } = await db
      .from("contacts")
      .select("id,email,phone,city")
      .in("id", contactIds);
    for (const row of (contactRows ?? []) as Array<{ id: string; email: string | null; phone: string | null; city: string | null }>) {
      contactDetail.set(row.id, { email: row.email, phone: row.phone, city: row.city });
    }
  }

  const inputs: ColdLeadInput[] = leads.map((l) => ({
    id: l.id,
    label: buildColdLeadLabel({
      id: l.id,
      contactName: l.contactId ? names.contacts.get(l.contactId) : null,
      companyName: l.companyId ? names.companies.get(l.companyId) : null,
      lossSummary: l.lossSummary,
    }),
    persona: l.persona,
    // Whichever quality figure is meaningful: an inbound lead keeps the score
    // its intent signals earned, and only a record the intent model had nothing
    // to say about can be raised by fit.
    leadScore: effectiveLeadQuality(l.leadScore, {
      // "unassigned" is the internal placeholder, not a persona anyone sells to.
      hasPersona: Boolean(l.persona) && l.persona !== "unassigned_persona",
      hasEmail: Boolean(l.contactId && contactDetail.get(l.contactId)?.email),
      hasPhone: Boolean(l.contactId && contactDetail.get(l.contactId)?.phone),
      hasCompany: Boolean(l.companyId),
      hasLocation: Boolean(l.contactId && contactDetail.get(l.contactId)?.city),
    }),
    status: l.status,
    lastActivityAt: latestActivity.get(l.id) ?? l.receivedAt,
    hasActiveCampaign: leadsWithCampaign.has(l.id),
  }));

  const candidates = detectColdLeadOpportunities(inputs, { now });
  return upsertOpportunities(candidates, db);
}

// ---------------------------------------------------------------------------
// Weather-event detection
// ---------------------------------------------------------------------------

/**
 * Injectable source of active weather alerts. The live NWS feed lands in BSR-364;
 * keeping it behind this interface means the detector and the scan action never
 * change when the feed is wired. The default reads the `weather_events` table
 * (populated by the ingestion pipeline) — no live third-party API is called here.
 */
export type WeatherEventSource = {
  listActiveEvents(now: string): Promise<WeatherEventInput[]>;
};

// weather_event_status values that represent a still-relevant alert.
const ACTIVE_WEATHER_STATUSES = ["received", "qualified"];

type WeatherRow = {
  id: string;
  alert_type: string | null;
  severity: string | null;
  zip_codes: string[] | null;
  starts_at: string | null;
  ends_at: string | null;
  raw_payload: Record<string, unknown> | null;
};

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/** Human coverage-area label: prefer NWS areaDesc, else the ZIP list. */
function weatherArea(payload: Record<string, unknown>, zips: string[]): string {
  const desc = readString(payload, "areaDesc") ?? readString(payload, "area");
  if (desc) {
    const parts = desc.split(";").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts.slice(0, 2).join(" / ") + (parts.length > 2 ? ` +${parts.length - 2} more` : "");
  }
  const clean = zips.filter((z) => typeof z === "string" && z.trim().length > 0);
  if (clean.length) return `ZIP ${clean.slice(0, 3).join(", ")}${clean.length > 3 ? ` +${clean.length - 3} more` : ""}`;
  return "the coverage area";
}

/** Pull any http(s) evidence links out of the raw NWS payload. */
function weatherSourceUrls(payload: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && /^https?:\/\//i.test(v.trim())) out.push(v.trim());
  };
  push(payload["url"]);
  push(payload["@id"]);
  push(payload["id"]);
  const urls = payload["sourceUrls"] ?? payload["urls"];
  if (Array.isArray(urls)) urls.forEach(push);
  return [...new Set(out)];
}

function mapWeatherRow(row: WeatherRow): WeatherEventInput | null {
  if (!row?.id) return null;
  const payload = (row.raw_payload ?? {}) as Record<string, unknown>;
  const zips = (row.zip_codes ?? []).filter((z) => typeof z === "string" && z.trim().length > 0);
  return {
    id: row.id,
    eventType: (row.alert_type ?? readString(payload, "event") ?? "Weather alert").trim(),
    area: weatherArea(payload, zips),
    severity: normalizeNwsSeverity(row.alert_type, row.severity),
    startsAt: row.starts_at ?? undefined,
    endsAt: row.ends_at ?? undefined,
    zipCodes: zips,
    sourceUrls: weatherSourceUrls(payload),
  };
}

/**
 * Default weather source: normalized rows from the global `weather_events` table.
 * Reading a DB table is not a live third-party call — the NWS fetch that fills the
 * table is BSR-364. Expired alerts are pre-filtered (the detector also drops them).
 */
export function supabaseWeatherEventSource(db: SupabaseClient): WeatherEventSource {
  return {
    async listActiveEvents(now: string): Promise<WeatherEventInput[]> {
      const { data } = await db
        .from("weather_events")
        .select("id, alert_type, severity, zip_codes, starts_at, ends_at, status, raw_payload")
        .in("status", ACTIVE_WEATHER_STATUSES)
        .order("created_at", { ascending: false })
        .limit(200);
      const nowMs = Date.parse(now);
      return (data ?? [])
        .map((row) => mapWeatherRow(row as WeatherRow))
        .filter((ev): ev is WeatherEventInput => ev !== null)
        .filter((ev) => !ev.endsAt || Number.isNaN(nowMs) || Date.parse(ev.endsAt) >= nowMs);
    },
  };
}

/**
 * Run weather-event detection over the injected alert source and persist new
 * opportunities for the current org. Read-only — surfaces a geo-targeted
 * storm-response recommendation, never contacts anyone. The source defaults to
 * the `weather_events` table; inject a fixture in tests / the live feed in BSR-364.
 */
export async function runWeatherEventDetection(
  source?: WeatherEventSource,
  client?: SupabaseClient,
  now: string = new Date().toISOString(),
): Promise<PersistResult> {
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "not_configured" };
  const db = client ?? getSupabaseAdminClient();
  const src = source ?? supabaseWeatherEventSource(db);
  const orgId = await getCurrentOrgId();

  const events = await src.listActiveEvents(now);
  if (events.length === 0) return { ok: true, count: 0 };

  // Read the SAME per-workspace weather config the `weather-signals` connector
  // reads (src/lib/connectors/builtin/weather-signal.ts).
  //
  // This path and the connector path both run inside one scan, over different
  // sources: this one reads the stored `weather_events` table, the connector
  // hits live NWS. Because `upsertOpportunities` dedups by skipping a subject
  // that already has an open opportunity of the same kind, whichever finishes
  // first wins — and they race inside a Promise.all. So when this path ignored
  // the workspace's config, a weather opportunity would carry a persona (or
  // respect the operator's event-category opt-in) only depending on who won
  // that race. Reading the config here makes the two paths agree, whoever wins.
  //
  // Without a persona, `selectAutoDraftCandidates` skips the opportunity as
  // `no_persona` — so the config gap silently made storm opportunities
  // undraftable rather than visibly wrong.
  const ctx = await getCurrentWorkspaceContext().catch(() => null);
  const config: Record<string, unknown> = ctx?.workspaceId
    ? await getConnectorConfig(db, ctx.workspaceId, "weather-signals").catch(() => ({}))
    : {};
  const persona = typeof config.persona === "string" && config.persona.trim() ? config.persona.trim() : null;
  const categories = parseWeatherCategories(config.eventCategories);

  const candidates = detectWeatherEventOpportunities(events, { now, persona, categories });
  return upsertOpportunities(candidates, db, { orgId });
}

// ---------------------------------------------------------------------------
// Next-iteration detection
// ---------------------------------------------------------------------------

// Campaigns that have actually run — the only ones that can carry results worth
// repeating. (draft/briefing/generating/pending_approval haven't reached anyone.)
const POST_LAUNCH_CAMPAIGN_STATUSES = ["active", "paused", "approved"];
// Bound the per-campaign performance fan-out so a large workspace can't turn one
// scan into hundreds of round-trips. Newest campaigns first.
const NEXT_ITERATION_SCAN_LIMIT = 40;

type CampaignRow = { id: string; name: string | null; persona: string | null; status: string | null };

/**
 * Run next-iteration detection over the org's already-launched campaigns and
 * persist an opportunity for any whose real attribution warrants a follow-up.
 * For each campaign it reuses the live performance panel + buildPerformanceLearning
 * (the same analysis the campaign detail shows), so the inbox and the campaign tab
 * never disagree. Read-only — the draft it recommends stays approval-gated. The
 * upsert's per-subject dedup keeps one open "draft round two" per campaign.
 */
export async function runNextIterationDetection(client?: SupabaseClient): Promise<PersistResult> {
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "not_configured" };
  const db = client ?? getSupabaseAdminClient();
  const orgId = await getCurrentOrgId();

  const { data, error } = await db
    .from("campaigns")
    .select("id, name, persona, status")
    .eq("org_id", orgId)
    .in("status", POST_LAUNCH_CAMPAIGN_STATUSES)
    .order("created_at", { ascending: false })
    .limit(NEXT_ITERATION_SCAN_LIMIT);
  if (error) return { ok: false, error: error.message };

  const campaigns = (data ?? []) as CampaignRow[];
  const inputs: NextIterationInput[] = [];
  for (const c of campaigns) {
    if (!c.id) continue;
    const name = c.name?.trim() || `Campaign ${c.id.slice(0, 8)}`;
    // Reuse the exact panel + learning the campaign detail renders.
    const panel = await getCampaignPerformancePanel(c.id);
    if (panel.status !== "live" || panel.channels.length === 0) continue;
    const learning = buildPerformanceLearning(panel, name);
    if (!learning) continue;

    // channels are sorted best-first (by booked, then leads) in buildChannelRows.
    const top = panel.channels[0];
    const topAsset = [...panel.assets].filter((a) => a.impressions > 0 && a.ctr > 0).sort((a, b) => b.ctr - a.ctr)[0];
    inputs.push({
      campaignId: c.id,
      campaignName: name,
      persona: c.persona ?? undefined,
      topChannel: top.channel,
      bookedJobs: top.booked,
      leads: top.leads,
      topAsset: topAsset?.title,
      recommendation: learning.recommendation,
      arcPrompt: learning.arcPrompt,
    });
  }
  if (inputs.length === 0) return { ok: true, count: 0 };

  const candidates = detectNextIterationOpportunities(inputs);
  return upsertOpportunities(candidates, db, { orgId });
}

// ---------------------------------------------------------------------------
// Competitor-activity detection
// ---------------------------------------------------------------------------

type CompetitorRow = {
  id: string;
  competitor_name: string | null;
  source: string | null;
  status: string | null;
  top_keywords: string[] | null;
  ad_creatives: unknown[] | null;
  persona: string | null;
  captured_at: string | null;
  competitor_url: string | null;
};

/**
 * Run competitor-activity detection over captured `competitor_campaigns` intel
 * for the current org and persist new opportunities. Read-only — surfaces a
 * defensive-flight recommendation, drafts nothing. Org-scoped at the query.
 */
export async function runCompetitorSignalDetection(
  client?: SupabaseClient,
  now: string = new Date().toISOString(),
): Promise<PersistResult> {
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "not_configured" };
  const db = client ?? getSupabaseAdminClient();
  const orgId = await getCurrentOrgId();

  const { data, error } = await db
    .from("competitor_campaigns")
    .select("id, competitor_name, source, status, top_keywords, ad_creatives, persona, captured_at, competitor_url")
    .eq("org_id", orgId)
    .neq("status", "archived")
    .order("captured_at", { ascending: false })
    .limit(200);
  if (error) return { ok: false, error: error.message };

  const signals: CompetitorSignalInput[] = ((data ?? []) as CompetitorRow[]).map((row) => ({
    id: row.id,
    competitorName: row.competitor_name ?? "",
    channel: row.source ?? "",
    status: row.status ?? "needs_review",
    keywords: row.top_keywords ?? [],
    creativeCount: Array.isArray(row.ad_creatives) ? row.ad_creatives.length : 0,
    persona: row.persona ?? undefined,
    capturedAt: row.captured_at ?? undefined,
    url: row.competitor_url ?? undefined,
  }));
  if (signals.length === 0) return { ok: true, count: 0 };

  const candidates = detectCompetitorOpportunities(signals, { now });
  return upsertOpportunities(candidates, db, { orgId });
}

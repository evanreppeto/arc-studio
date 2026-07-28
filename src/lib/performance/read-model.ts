import { type SupabaseClient } from "@supabase/supabase-js";
import { reportDegraded } from "@/lib/observability/report-degraded";

import { getCurrentOrgId } from "@/lib/auth/org";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "../supabase/server";
import { buildTrendBuckets, computeDelta, sumTwoPeriods, type KpiDelta, type TrendPoint } from "./overview-shape";

export type PerformanceTone = "amber" | "green" | "red" | "blue" | "gray";

export type PerformanceMetric = {
  label: string;
  value: number | string;
  detail: string;
  tone: PerformanceTone;
};

export type PerformanceBreakdown = {
  label: string;
  value: number | string;
  detail: string;
  tone: PerformanceTone;
};

export type PerformanceContract = {
  area: string;
  currentSignal: string;
  missingFields: string;
  nextBackendStep: string;
};

/** Headline KPI for the analytics top row. `spark` is a raw series the UI normalizes for the inline sparkline. */
export type PerformanceKpi = {
  key: string;
  label: string;
  value: string;
  hint?: string;
  delta?: string;
  deltaTone?: "ok" | "amber" | "red" | "neutral";
  tone?: "neutral" | "accent" | "ok" | "amber" | "red";
  spark?: number[];
};

/** One channel's performance row for the channel bar chart (Email / SMS / Meta / Landing / Referral). */
export type ChannelPerformance = {
  channel: string;
  leads: number;
  booked: number;
  revenueCents: number;
  spendCents: number;
  share: number;
};

/** A flagged anomaly for the right rail (good or bad), source-backed where possible. */
export type PerformanceAnomaly = {
  id: string;
  title: string;
  detail: string;
  tone: "ok" | "amber" | "red";
  metric?: string;
};

/** A recommended next move Arc surfaces — always approval-gated, never auto-executed. */
export type PerformanceNextMove = {
  id: string;
  title: string;
  detail: string;
  cta: string;
  href: string;
};

/** Per-campaign performance row for the analytics table. */
export type CampaignPerformanceRow = {
  id: string;
  name: string;
  persona: string;
  impressions: number;
  clicks: number;
  leads: number;
  booked: number;
  revenueCents: number;
  conversion: number;
  trend: "up" | "down" | "flat";
};

export type PerformanceReadModel =
  | {
      status: "live";
      /** True when these numbers are illustrative demo data (Supabase not configured or empty), not real records. */
      isDemo?: boolean;
      metrics: PerformanceMetric[];
      leadVolumeByPersona: PerformanceBreakdown[];
      leadVolumeBySource: PerformanceBreakdown[];
      conversionSignals: PerformanceBreakdown[];
      funnelStages: { label: string; count: number }[];
      trend: TrendPoint[];
      leadsRecent: { count: number; delta: KpiDelta | null };
      revenueRecent: { cents: number; delta: KpiDelta | null };
      campaignSignals: PerformanceBreakdown[];
      partnerSignals: PerformanceBreakdown[];
      revenueByPersona: PerformanceBreakdown[];
      ctaSignals: PerformanceBreakdown[];
      contracts: PerformanceContract[];
      /** Optional rich dashboard layer — present for the demo dataset; live data may add it later. */
      kpis?: PerformanceKpi[];
      channelPerformance?: ChannelPerformance[];
      anomalies?: PerformanceAnomaly[];
      nextMoves?: PerformanceNextMove[];
      campaignRows?: CampaignPerformanceRow[];
    }
  | {
      status: "unavailable";
      message: string;
    };

type LeadRow = {
  id: string;
  persona: string | null;
  source: string | null;
  status: string | null;
  lead_score: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type JobRow = {
  id: string;
  lead_id: string | null;
  persona: string | null;
  status: string | null;
  estimated_revenue_cents: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type OutcomeRow = {
  id: string;
  lead_id: string | null;
  company_id: string | null;
  persona: string | null;
  status: string | null;
  gross_revenue_cents: number | null;
  gross_margin_cents: number | null;
  closed_at: string | null;
  created_at: string | null;
};

type CampaignRow = {
  id: string;
  name: string;
  persona: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type CampaignAssetRow = {
  id: string;
  campaign_id: string | null;
  asset_type: string | null;
  channel: string | null;
  status: string | null;
};

type ApprovalRow = {
  id: string;
  campaign_id: string | null;
  item_type: string | null;
  status: string | null;
  risk_level: string | null;
};

type CompanyRow = {
  id: string;
  persona: string | null;
  status: string | null;
  partner_tier: string | null;
  metadata: unknown;
};

type EngagementEventRow = {
  id: string;
  event_type: string | null;
  channel: string | null;
  campaign_id: string | null;
  lead_id: string | null;
  created_at: string | null;
};

export async function getPerformanceReadModel(
  client?: SupabaseClient,
  rangeDays: number = 30,
  orgId?: string,
): Promise<PerformanceReadModel> {
  if (!client && !isSupabaseAdminConfigured()) {
    // No DB in this environment (local preview, demo): when the flag is on, render an
    // illustrative dashboard flagged via `isDemo`. When off, return unavailable.
    return isDemoDataEnabled()
      ? buildDemoPerformanceReadModel(rangeDays)
      : { status: "unavailable", message: "Performance data is unavailable." };
  }

  try {
    const supabase = client ?? getSupabaseAdminClient();
    // Tenancy: these reads go through the RLS-bypassing service-role client, so every query MUST
    // be org-scoped in app code — RLS is not a backstop here. Resolve the org from the explicit
    // arg, else the request session. When a client is injected (unit tests) we skip session
    // resolution and leave scoping to the caller, since the mock returns per-table fixtures.
    const resolvedOrgId = orgId ?? (client ? undefined : await getCurrentOrgId());
    const byOrg = <B>(builder: B): B =>
      resolvedOrgId
        ? (builder as unknown as { eq(column: string, value: string): B }).eq("org_id", resolvedOrgId)
        : builder;
    const [leads, jobs, outcomes, campaigns, assets, approvals, companies, events] = await Promise.all([
      byOrg(supabase.from("leads").select("id,persona,source,status,lead_score,created_at,updated_at")).limit(1000),
      byOrg(supabase.from("jobs").select("id,lead_id,persona,status,estimated_revenue_cents,created_at,updated_at")).limit(1000),
      byOrg(supabase.from("outcomes").select("id,lead_id,company_id,persona,status,gross_revenue_cents,gross_margin_cents,closed_at,created_at")).limit(1000),
      byOrg(supabase.from("campaigns").select("id,name,persona,status,created_at,updated_at")).limit(1000),
      byOrg(supabase.from("campaign_assets").select("id,campaign_id,asset_type,channel,status")).limit(1000),
      byOrg(supabase.from("approval_items").select("id,campaign_id,item_type,status,risk_level")).limit(1000),
      byOrg(supabase.from("companies").select("id,persona,status,partner_tier,metadata")).limit(1000),
      byOrg(supabase.from("engagement_events").select("id,event_type,channel,campaign_id,lead_id,created_at")).limit(1000),
    ]);

    assertResult("leads", leads.error);
    assertResult("jobs", jobs.error);
    assertResult("outcomes", outcomes.error);
    assertResult("campaigns", campaigns.error);
    assertResult("campaign_assets", assets.error);
    assertResult("approval_items", approvals.error);
    assertResult("companies", companies.error);
    const optionalEventsMissing = Boolean(events.error);

    const leadRows = (leads.data ?? []) as LeadRow[];
    const jobRows = (jobs.data ?? []) as JobRow[];
    const outcomeRows = (outcomes.data ?? []) as OutcomeRow[];
    const campaignRows = (campaigns.data ?? []) as CampaignRow[];
    const assetRows = (assets.data ?? []) as CampaignAssetRow[];
    const approvalRows = (approvals.data ?? []) as ApprovalRow[];
    const companyRows = (companies.data ?? []) as CompanyRow[];
    const eventRows = optionalEventsMissing ? [] : ((events.data ?? []) as EngagementEventRow[]);

    const wonOutcomes = outcomeRows.filter((outcome) => ["won", "closed_won", "paid"].includes(outcome.status ?? ""));
    // Won revenue counts won outcomes. Both sums below used to read outcomeRows —
    // every status — while the tile beside them captioned itself
    // "${wonOutcomes.length} won/paid outcomes": the number and its own label were
    // computed from different sets. It has been invisible because revenue happens
    // to be booked only on won/paid rows today, so the two agree by luck. The
    // moment anyone records what a LOST deal was worth — ordinary CRM practice —
    // the headline revenue silently inflates, and a lost deal is exactly the kind
    // of thing you want the value of.
    const linkedRevenue = wonOutcomes.reduce((sum, outcome) => sum + (outcome.gross_revenue_cents ?? 0), 0);
    const now = Date.now();
    const leadPeriods = sumTwoPeriods(leadRows.map((lead) => ({ at: lead.created_at, weight: 1 })), now, rangeDays);
    const revenuePeriods = sumTwoPeriods(
      wonOutcomes.map((outcome) => ({ at: outcome.closed_at ?? outcome.created_at, weight: outcome.gross_revenue_cents ?? 0 })),
      now,
      rangeDays,
    );
    // Trend window tracks the range: ~1 bucket/week, min 8 weeks, capped at 26.
    const trendWeeks = Math.min(Math.max(Math.ceil(rangeDays / 7), 8), 26);

    // If the DB is reachable but holds nothing yet, the page would read as empty.
    // Fall back to the illustrative demo dataset only when the demo flag is on.
    if (leadRows.length === 0 && jobRows.length === 0 && outcomeRows.length === 0 && campaignRows.length === 0) {
      if (isDemoDataEnabled()) return buildDemoPerformanceReadModel(rangeDays);
    }

    return {
      status: "live",
      // Note: the breakdown lists below (persona/source/revenue/partners/cta) are all-time;
      // only `trend`, `leadsRecent`, and `revenueRecent` honor `rangeDays` for now.
      metrics: [
        { label: "Lead records", value: leadRows.length, detail: "Current CRM lead volume", tone: leadRows.length > 0 ? "blue" : "gray" },
        { label: "Job records", value: jobRows.length, detail: "Booking proxy until booked_at exists", tone: jobRows.length > 0 ? "green" : "gray" },
        { label: "Campaign packages", value: campaignRows.length, detail: "Drafted or active packages", tone: campaignRows.length > 0 ? "blue" : "gray" },
        { label: "Revenue linked", value: formatMoney(linkedRevenue), detail: `${wonOutcomes.length} won/paid outcomes`, tone: linkedRevenue > 0 ? "green" : "gray" },
      ],
      leadVolumeByPersona: breakdownFromCounts(countBy(leadRows, (lead) => lead.persona ?? "unassigned_persona"), "lead"),
      leadVolumeBySource: breakdownFromCounts(countBy(leadRows, (lead) => lead.source ?? "unknown_source"), "lead"),
      conversionSignals: buildConversionSignals(leadRows, jobRows, outcomeRows),
      funnelStages: [
        { label: "Leads", count: leadRows.length },
        { label: "Bookings", count: jobRows.length },
        { label: "Won", count: wonOutcomes.length },
      ],
      trend: buildTrendBuckets(leadRows, jobRows, now, trendWeeks),
      leadsRecent: { count: leadPeriods.current, delta: computeDelta(leadPeriods.current, leadPeriods.prior) },
      revenueRecent: { cents: revenuePeriods.current, delta: computeDelta(revenuePeriods.current, revenuePeriods.prior) },
      campaignSignals: buildCampaignSignals(campaignRows, assetRows, approvalRows),
      partnerSignals: buildPartnerSignals(companyRows, outcomeRows),
      revenueByPersona: buildRevenueByPersona(outcomeRows),
      ctaSignals: buildCtaSignals(eventRows),
      contracts: buildContracts(),
    };
  } catch (error) {
    // Degrade, but not silently — this read IS the screen, so an empty
    // state here is indistinguishable from an outage (BSR-544).
    reportDegraded(error, { scope: "performance.getPerformanceReadModel", surface: "primary" });
    return { status: "unavailable", message: error instanceof Error ? error.message : "Performance data is unavailable." };
  }
}

// ---------------------------------------------------------------------------
// Demo dataset — illustrative BSR marketing performance for environments with
// no Supabase (local preview, screenshots, sales demos). Numbers are believable
// but synthetic; the read model flags them via `isDemo: true`. Nothing here
// implies a real outbound action — analytics is read-only display.
// ---------------------------------------------------------------------------

/** Deterministic pseudo-random so the demo is stable across renders. */
function seeded(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function buildDemoPerformanceReadModel(rangeDays: number): PerformanceReadModel {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const weeks = Math.min(Math.max(Math.ceil(rangeDays / 7), 12), 18);

  // Twelve-plus weeks of leads vs. booked work, gently trending up with a seasonal
  // storm spike midway (Spring Storm Prep). Bookings track leads at ~30-40%.
  const rng = seeded(8675309);
  const trend: TrendPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = now - i * 7 * DAY_MS - 7 * DAY_MS;
    const label = new Date(start + DAY_MS).toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
    const progress = (weeks - 1 - i) / Math.max(weeks - 1, 1);
    const base = 38 + progress * 34; // ramp from ~38 to ~72 leads/wk
    const stormSpike = i >= 4 && i <= 7 ? 22 : 0; // mid-window storm surge
    const leads = Math.round(base + stormSpike + (rng() - 0.5) * 14);
    const bookings = Math.round(leads * (0.32 + progress * 0.1) + (rng() - 0.5) * 4);
    trend.push({ week: label, leads: Math.max(leads, 0), bookings: Math.max(bookings, 0) });
  }

  const totalLeads = trend.reduce((s, p) => s + p.leads, 0);
  const totalBooked = trend.reduce((s, p) => s + p.bookings, 0);

  // Channel mix — Email/SMS/Meta/Landing/Referral. Revenue + spend per channel.
  const channelPerformance: ChannelPerformance[] = [
    { channel: "Email", leads: 214, booked: 26, revenueCents: 5_820_000, spendCents: 0 },
    { channel: "Meta Ads", leads: 168, booked: 19, revenueCents: 4_360_000, spendCents: 980_000 },
    { channel: "Landing", leads: 142, booked: 17, revenueCents: 3_910_000, spendCents: 0 },
    { channel: "SMS", leads: 96, booked: 11, revenueCents: 2_240_000, spendCents: 0 },
    { channel: "Referral", leads: 74, booked: 9, revenueCents: 2_290_000, spendCents: 0 },
  ].map((c) => ({ ...c, share: 0 }));
  const channelLeadTotal = channelPerformance.reduce((s, c) => s + c.leads, 0);
  for (const c of channelPerformance) c.share = Math.round((c.leads / channelLeadTotal) * 100);

  const revenueImpactCents = channelPerformance.reduce((s, c) => s + c.revenueCents, 0); // ~$186K
  const bookedJobs = 82;
  const avgLeadScore = 78;
  const conversionPct = 63;

  // Sparkline helpers from the trend so KPI cards animate believably.
  const bookedSpark = trend.map((p) => p.bookings);
  const revenueSpark = trend.map((p) => p.bookings * (rng() * 1.6 + 2.2));
  const scoreSpark = trend.map((_, i) => 70 + (i / Math.max(weeks - 1, 1)) * 10 + (rng() - 0.5) * 3);
  const convSpark = trend.map((p) => (p.leads > 0 ? (p.bookings / p.leads) * 100 : 0));

  const kpis: PerformanceKpi[] = [
    { key: "campaigns", label: "Active campaigns", value: "6", hint: "2 awaiting approval", tone: "neutral", delta: "+2", deltaTone: "ok", spark: trend.map(() => 5 + rng()) },
    { key: "booked", label: "Booked work", value: String(bookedJobs), hint: "demos this range", tone: "ok", delta: "+18%", deltaTone: "ok", spark: bookedSpark },
    { key: "revenue", label: "Revenue impact", value: formatMoney(revenueImpactCents), hint: "attributed to marketing", tone: "accent", delta: "+24%", deltaTone: "ok", spark: revenueSpark },
    { key: "conversion", label: "Lead → booked", value: `${conversionPct}%`, hint: "qualified leads booked", tone: "ok", delta: "+6 pts", deltaTone: "ok", spark: convSpark },
    { key: "score", label: "Avg lead score", value: String(avgLeadScore), hint: "across new leads", tone: "neutral", delta: "+4", deltaTone: "ok", spark: scoreSpark },
  ];

  // Funnel: impressions → clicks → leads → booked.
  const funnelStages = [
    { label: "Impressions", count: 214_800 },
    { label: "Clicks", count: 9_640 },
    { label: "Leads", count: channelLeadTotal },
    { label: "Booked", count: bookedJobs },
  ];

  // Per-campaign rows for the demo library (names mirror the campaigns demo fallback).
  const campaignRows: CampaignPerformanceRow[] = [
    { id: "demo-emergency-water-response-2026", name: "Pricing-Intent Fast Track 2026", persona: "High-Intent Evaluator", impressions: 68_400, clicks: 3_120, leads: 188, booked: 31, revenueCents: 7_240_000, conversion: 16, trend: "up" },
    { id: "demo-spring-storm-prep", name: "Quarterly Nurture Refresh", persona: "Proactive Evaluator", impressions: 52_100, clicks: 2_410, leads: 142, booked: 18, revenueCents: 3_960_000, conversion: 13, trend: "up" },
    { id: "demo-commercial-water-mitigation", name: "Enterprise Expansion Play", persona: "Team admin", impressions: 31_900, clicks: 1_180, leads: 74, booked: 14, revenueCents: 5_120_000, conversion: 19, trend: "flat" },
    { id: "demo-mold-remediation-awareness", name: "Feature Adoption Awareness", persona: "Feature-Focused Evaluator", impressions: 28_600, clicks: 1_040, leads: 61, booked: 8, revenueCents: 1_840_000, conversion: 13, trend: "down" },
    { id: "demo-burst-pipe-rapid-response", name: "Stalled-Trial Rescue", persona: "High-Intent Evaluator", impressions: 19_300, clicks: 980, leads: 58, booked: 7, revenueCents: 1_690_000, conversion: 12, trend: "up" },
    { id: "demo-insurance-partner-referral", name: "Partner Referral Growth", persona: "Procurement", impressions: 14_500, clicks: 540, leads: 41, booked: 4, revenueCents: 1_020_000, conversion: 10, trend: "flat" },
  ];

  const anomalies: PerformanceAnomaly[] = [
    {
      id: "anom-storm-spike",
      title: "Quarterly Nurture Refresh leads up 34% week-over-week",
      detail: "Pricing-intent demand spiked after the latest product update. Capacity to book demos is the current constraint, not demand.",
      tone: "ok",
      metric: "+34% leads",
    },
    {
      id: "anom-mold-decay",
      title: "Feature Adoption Awareness conversion slipping",
      detail: "Click-to-lead held steady but lead-to-booked fell to 13%. The landing CTA may be under-qualifying inquiries.",
      tone: "amber",
      metric: "13% booked",
    },
    {
      id: "anom-referral-revenue",
      title: "Referral channel punches above its volume",
      detail: "Only 9% of leads but $22.9K booked — partner referrals convert at nearly 2x the portfolio average.",
      tone: "ok",
      metric: "$22.9K",
    },
  ];

  const nextMoves: PerformanceNextMove[] = [
    {
      id: "move-storm-capacity",
      title: "Resize Quarterly Nurture Refresh creative for capacity",
      detail: "Demand outpaces demo booking capacity. Arc drafted a 'priority scheduling' variant — review before it goes live.",
      cta: "Review draft",
      href: "/campaigns",
    },
    {
      id: "move-mold-cta",
      title: "Tighten the Feature Adoption landing CTA",
      detail: "Arc proposes a qualifying question on the form to lift lead-to-booked. Approval-gated; nothing publishes until you sign off.",
      cta: "Open campaign",
      href: "/campaigns/demo-mold-remediation-awareness",
    },
    {
      id: "move-referral-expand",
      title: "Expand the Partner Referral package",
      detail: "Referral ROI is strong but volume is thin. Arc prepared an outreach packet for three new channel partners.",
      cta: "See package",
      href: "/campaigns",
    },
  ];

  return {
    status: "live",
    isDemo: true,
    metrics: [
      { label: "Lead records", value: totalLeads, detail: "Across all live demo campaigns", tone: "blue" },
      { label: "Booked work", value: totalBooked, detail: "Demos attributed to marketing", tone: "green" },
      { label: "Campaign packages", value: 6, detail: "Drafted, in approval, or live", tone: "blue" },
      { label: "Revenue impact", value: formatMoney(revenueImpactCents), detail: "Marketing-attributed outcomes", tone: "green" },
    ],
    leadVolumeByPersona: [
      { label: "High-Intent Evaluator", value: 246, detail: "246 leads in current data.", tone: "blue" },
      { label: "Team admin", value: 138, detail: "138 leads in current data.", tone: "blue" },
      { label: "Proactive Evaluator", value: 142, detail: "142 leads in current data.", tone: "blue" },
      { label: "Procurement", value: 74, detail: "74 leads in current data.", tone: "blue" },
      { label: "Feature-Focused Evaluator", value: 61, detail: "61 leads in current data.", tone: "blue" },
    ],
    leadVolumeBySource: channelPerformance.map((c) => ({ label: c.channel, value: c.leads, detail: `${c.leads} leads in current data.`, tone: "blue" as PerformanceTone })),
    conversionSignals: [
      { label: "Lead → booked rate", value: `${conversionPct}%`, detail: "Qualified leads that became booked work.", tone: "green" },
      { label: "Estimate pipeline", value: formatMoney(24_600_000), detail: "Open estimates not yet won.", tone: "green" },
      { label: "Avg revenue / demo", value: formatMoney(Math.round(revenueImpactCents / bookedJobs)), detail: "Marketing-attributed revenue per booked demo.", tone: "green" },
    ],
    funnelStages,
    trend,
    leadsRecent: { count: channelLeadTotal, delta: { pct: 21, dir: "up" } },
    revenueRecent: { cents: revenueImpactCents, delta: { pct: 24, dir: "up" } },
    campaignSignals: [
      { label: "Campaign packages", value: 6, detail: "Campaign records in the demo workspace.", tone: "blue" },
      { label: "Approved/running", value: 4, detail: "Execution status only; no publishing is enabled here.", tone: "green" },
      { label: "Creative assets", value: 23, detail: "14 visual/media-like assets detected.", tone: "blue" },
      { label: "Approvals waiting", value: 2, detail: "Human approval gate volume.", tone: "amber" },
    ],
    partnerSignals: [
      { label: "Partner companies", value: 12, detail: "Partner persona or partner tier records.", tone: "blue" },
      { label: "Tiered partners", value: 5, detail: "Companies with partner_tier populated.", tone: "green" },
      { label: "Referral revenue", value: 22900, detail: "Booked revenue attributed to referrals.", tone: "green" },
    ],
    revenueByPersona: [
      { label: "High-Intent Evaluator", value: 89300, detail: "gross_revenue grouped by outcome persona.", tone: "green" },
      { label: "Team admin", value: 51200, detail: "gross_revenue grouped by outcome persona.", tone: "green" },
      { label: "Proactive Evaluator", value: 39600, detail: "gross_revenue grouped by outcome persona.", tone: "green" },
      { label: "Procurement", value: 10200, detail: "gross_revenue grouped by outcome persona.", tone: "green" },
    ],
    ctaSignals: [
      { label: "Form submissions", value: 318, detail: "318 events in current data.", tone: "blue" },
      { label: "File uploads", value: 142, detail: "142 events in current data.", tone: "blue" },
      { label: "Landing CTA clicks", value: 1240, detail: "1240 events in current data.", tone: "blue" },
    ],
    contracts: buildContracts(),
    kpis,
    channelPerformance,
    anomalies,
    nextMoves,
    campaignRows,
  };
}

function buildConversionSignals(leads: LeadRow[], jobs: JobRow[], outcomes: OutcomeRow[]): PerformanceBreakdown[] {
  const leadCount = leads.length;
  const jobCount = jobs.length;
  const estimateRevenue = jobs.reduce((sum, job) => sum + (job.estimated_revenue_cents ?? 0), 0);
  const wonOutcomes = outcomes.filter((outcome) => ["won", "closed_won", "paid"].includes(outcome.status ?? ""));

  return [
    {
      label: "Booking rate proxy",
      value: leadCount > 0 ? percent(jobCount / leadCount) : "Missing",
      detail: "Uses job records divided by lead records until booked_at exists.",
      tone: leadCount > 0 && jobCount > 0 ? "green" : "amber",
    },
    {
      label: "Estimate pipeline",
      value: formatMoney(estimateRevenue),
      detail: "Uses estimated_revenue_cents on jobs.",
      tone: estimateRevenue > 0 ? "green" : "gray",
    },
    {
      label: "Estimate close rate proxy",
      value: jobCount > 0 ? percent(wonOutcomes.length / jobCount) : "Missing",
      detail: "Uses won/paid outcomes divided by job records until estimate status timestamps exist.",
      tone: wonOutcomes.length > 0 ? "green" : "amber",
    },
  ];
}

function buildCampaignSignals(campaigns: CampaignRow[], assets: CampaignAssetRow[], approvals: ApprovalRow[]): PerformanceBreakdown[] {
  const activeCampaigns = campaigns.filter((campaign) => ["approved", "scheduled", "running", "active"].includes(campaign.status ?? ""));
  const waitingApprovals = approvals.filter((approval) => isWaitingApproval(approval.status));
  const mediaAssets = assets.filter((asset) => /image|video|creative|media|ad/i.test(`${asset.asset_type ?? ""} ${asset.channel ?? ""}`));

  return [
    { label: "Campaign packages", value: campaigns.length, detail: "Campaign records in Supabase.", tone: campaigns.length > 0 ? "blue" : "gray" },
    { label: "Approved/running", value: activeCampaigns.length, detail: "Execution status only; no publishing is enabled here.", tone: activeCampaigns.length > 0 ? "green" : "gray" },
    { label: "Creative assets", value: assets.length, detail: `${mediaAssets.length} visual/media-like assets detected.`, tone: assets.length > 0 ? "blue" : "gray" },
    { label: "Approvals waiting", value: waitingApprovals.length, detail: "Human approval gate volume.", tone: waitingApprovals.length > 0 ? "amber" : "green" },
    {
      label: "Cost per booked job",
      value: "Missing",
      detail: "Needs spend_cents and booked_job_count by campaign before this KPI is real.",
      tone: "amber",
    },
  ];
}

function buildPartnerSignals(companies: CompanyRow[], outcomes: OutcomeRow[]): PerformanceBreakdown[] {
  const partnerCompanies = companies.filter((company) => Boolean(company.partner_tier) || isPartnerPersona(company.persona));
  const tiered = partnerCompanies.filter((company) => Boolean(company.partner_tier));
  const referralRevenue = outcomes.reduce((sum, outcome) => sum + (outcome.gross_revenue_cents ?? 0), 0);

  return [
    { label: "Partner companies", value: partnerCompanies.length, detail: "Partner persona or partner tier records.", tone: partnerCompanies.length > 0 ? "blue" : "gray" },
    { label: "Tiered partners", value: tiered.length, detail: "Companies with partner_tier populated.", tone: tiered.length > 0 ? "green" : "amber" },
    {
      label: "Partner referrals",
      value: "Missing",
      detail: "Needs partner_referrals rows or referred lead/job ids before referral volume is trustworthy.",
      tone: "amber",
    },
    {
      label: "Referral conversion",
      value: "Missing",
      detail: "Needs referred_lead_ids joined to booked jobs and outcomes.",
      tone: "amber",
    },
    {
      label: "Referral revenue",
      value: referralRevenue > 0 ? formatMoney(referralRevenue) : "Missing",
      detail: "Needs explicit referral attribution before this becomes true partner ROI.",
      tone: referralRevenue > 0 ? "green" : "amber",
    },
  ];
}

function buildRevenueByPersona(outcomes: OutcomeRow[]): PerformanceBreakdown[] {
  const revenue = new Map<string, number>();
  for (const outcome of outcomes) {
    const persona = outcome.persona ?? "unassigned_persona";
    revenue.set(persona, (revenue.get(persona) ?? 0) + (outcome.gross_revenue_cents ?? 0));
  }
  return [...revenue.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([persona, cents]) => ({
      label: titleize(persona),
      // Whole dollars (number) so the chart can plot it; the UI re-applies $ formatting.
      // Sub-dollar precision is intentionally dropped — bars don't need cents.
      value: Math.round(cents / 100),
      detail: "gross_revenue_cents grouped by outcome persona.",
      tone: cents > 0 ? "green" : "gray",
    }));
}

function buildCtaSignals(events: EngagementEventRow[]): PerformanceBreakdown[] {
  const ctaLike = events.filter((event) => /cta|form|photo|upload|landing|submit/i.test(`${event.event_type ?? ""} ${event.channel ?? ""}`));
  const byType = breakdownFromCounts(countBy(ctaLike, (event) => event.event_type ?? "unknown_event"), "event");
  return byType.length > 0
    ? byType
    : [
        {
          label: "CTA/form/photo-upload conversion",
          value: "Missing",
          detail: "Needs engagement_events with CTA, form, landing, and photo upload event types.",
          tone: "amber",
        },
      ];
}

function buildContracts(): PerformanceContract[] {
  return [
    {
      area: "Lead conversion",
      currentSignal: "leads, jobs, outcomes",
      missingFields: "booked_at, estimate_sent_at, estimate_approved_at, lost_reason",
      nextBackendStep: "Add lead-to-job conversion timestamps and close reasons.",
    },
    {
      area: "Campaign performance",
      currentSignal: "campaigns, campaign_assets, approval_items",
      missingFields: "impressions, clicks, spend_cents, form_submissions, booked_jobs, cost_per_booked_job_cents",
      nextBackendStep: "Create campaign_results rows keyed by campaign_id and asset_id.",
    },
    {
      area: "Partner attribution",
      currentSignal: "companies.partner_tier",
      missingFields: "partner_type, referral_count, referred_lead_ids, referred_job_ids, referral_revenue_cents",
      nextBackendStep: "Add partner attribution fields or a partner_referrals table.",
    },
    {
      area: "CTA and landing events",
      currentSignal: "engagement_events if present",
      missingFields: "cta_label, route, persona, source_campaign_id, photo_upload_count",
      nextBackendStep: "Track internal CTA/form/photo-upload events. Do not publish pages from this app.",
    },
    {
      area: "Revenue intelligence",
      currentSignal: "outcomes.gross_revenue_cents and gross_margin_cents",
      missingFields: "campaign_id, partner_company_id, attribution_confidence, attribution_method",
      nextBackendStep: "Join outcomes to leads, campaigns, partners, and source records.",
    },
  ];
}

function breakdownFromCounts(counts: Map<string, number>, noun: string): PerformanceBreakdown[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({
      label: titleize(label),
      value,
      detail: `${value} ${noun}${value === 1 ? "" : "s"} in current data.`,
      tone: value > 0 ? "blue" : "gray",
    }));
}

function countBy<T>(rows: T[], pick: (row: T) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = pick(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function isWaitingApproval(status: string | null) {
  return ["needs_compliance", "pending_approval", "pending_owner_approval", "revision_requested"].includes(status ?? "");
}

function isPartnerPersona(persona: string | null) {
  return /partner|property_manager|insurance|agent|landlord|hoa|gc|remodeler/i.test(persona ?? "");
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function titleize(value: string) {
  return value
    .replace(/^persona_/, "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function assertResult(table: string, error: { message?: string } | null) {
  if (error) {
    throw new Error(`${table} lookup failed: ${error.message ?? "Unknown Supabase error"}`);
  }
}

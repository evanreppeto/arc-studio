// ---------------------------------------------------------------------------
// Campaign Performance panel — normalizes the (previously UI-less) economics
// engine into one shape the campaign detail view renders. Two live sources:
//   • "attributed" — real CRM attribution via getCampaignEconomics (won/paid
//     outcomes, open pipeline, spend) once Supabase has data for the campaign.
//   • "demo"       — the rich illustrative per-campaign detail used in local
//     preview / sales demos (Supabase unconfigured).
// Falls back to a "measuring" state (what we'll track, what's locked) so the
// tab is honest before any delivery/outcome data is attached. Read-only —
// nothing here implies an outbound send.
// ---------------------------------------------------------------------------

import { isDemoDataEnabled } from "@/lib/demo/demo-mode";

import { getCampaignAnalyticsDemoDetail, type CampaignAnalyticsDemoDetail } from "./campaign-demo-detail";
import { getCampaignAttributionRows, getCampaignEconomics, getCampaignTrendRows, type CampaignEconomicsReadModel } from "./attribution-read-model";
import { isSupabaseAdminConfigured } from "../supabase/server";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type PerformanceKpi = {
  key: string;
  label: string;
  value: string;
  hint: string;
  delta?: string;
  deltaTone?: "ok" | "amber" | "red" | "neutral";
};

export type PerformanceChannelRow = {
  channel: string;
  leads: number;
  booked: number;
  revenue: string;
  spend: string;
  share: number;
};

export type PerformanceFunnelStage = { label: string; count: number };

export type PerformanceTrendPoint = { week: string; revenue: number; leads: number; booked: number };

export type PerformanceAssetRow = {
  id: string;
  title: string;
  channel: string;
  format: string;
  /** Provenance: real BSR media, AI-generated, composite, or stock. */
  source: string;
  status: string;
  impressions: number;
  clicks: number;
  leads: number;
  ctr: number;
};

export type CampaignPerformancePanel =
  | {
      status: "live";
      source: "demo" | "attributed";
      windowLabel: string;
      note: string;
      kpis: PerformanceKpi[];
      channels: PerformanceChannelRow[];
      funnel: PerformanceFunnelStage[];
      trend: PerformanceTrendPoint[];
      assets: PerformanceAssetRow[];
    }
  | { status: "measuring"; message: string };

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("en-US");
const usd = (cents: number) => USD.format(cents / 100);

const MEASURING_MESSAGE =
  "No delivery or outcome data is attached to this campaign yet. Once approved sending, publishing, or ad results and booked-job outcomes are linked, live attribution appears here.";

/** Map the illustrative demo detail into the shared panel shape. */
export function buildDemoPanel(detail: CampaignAnalyticsDemoDetail): CampaignPerformancePanel {
  return {
    status: "live",
    source: "demo",
    windowLabel: detail.windowLabel,
    note: "Illustrative demo data — connect delivery results and CRM outcomes for live attribution.",
    kpis: detail.kpis.map((k) => ({
      key: k.key,
      label: k.label,
      value: k.value,
      hint: k.hint,
      delta: k.delta,
      deltaTone: k.deltaTone,
    })),
    channels: detail.channels.map((c) => ({
      channel: c.channel,
      leads: c.leads,
      booked: c.booked,
      revenue: usd(c.revenueCents),
      spend: c.spendCents > 0 ? usd(c.spendCents) : "—",
      share: c.share,
    })),
    funnel: detail.funnel.map((f) => ({ label: f.label, count: f.count })),
    trend: detail.trend.map((t) => ({ week: t.week, revenue: t.revenue, leads: t.leads, booked: t.booked })),
    assets: detail.assets.map((a) => ({
      id: a.id,
      title: a.title,
      channel: a.channel,
      format: a.format,
      source: a.source,
      status: a.status,
      impressions: a.impressions,
      clicks: a.clicks,
      leads: a.leads,
      ctr: a.ctr,
    })),
  };
}

/** Pure: bucket attributed-lead dates and won-revenue events into `weeks` weekly
 *  points ending at `nowMs` (oldest first). Revenue is whole dollars, matching the
 *  demo trend the chart already renders. Unparseable/out-of-window dates are skipped. */
export function buildWeeklyTrend(
  leadDates: Array<string | null>,
  wonEvents: Array<{ at: string | null; cents: number }>,
  nowMs: number,
  weeks: number,
): PerformanceTrendPoint[] {
  const points: PerformanceTrendPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = nowMs - i * WEEK_MS - WEEK_MS;
    const label = new Date(start + WEEK_MS).toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
    points.push({ week: label, revenue: 0, leads: 0, booked: 0 });
  }
  const indexOf = (at: string | null): number => {
    if (!at) return -1;
    const t = Date.parse(at);
    if (Number.isNaN(t)) return -1;
    const weeksAgo = Math.floor((nowMs - t) / WEEK_MS);
    if (weeksAgo < 0 || weeksAgo >= weeks) return -1;
    return weeks - 1 - weeksAgo;
  };
  for (const d of leadDates) {
    const i = indexOf(d);
    if (i >= 0) points[i].leads += 1;
  }
  for (const e of wonEvents) {
    const i = indexOf(e.at);
    if (i >= 0) {
      points[i].revenue += Math.round(e.cents / 100);
      points[i].booked += 1;
    }
  }
  return points;
}

const WON_STATUSES = ["won", "paid"];

// A handful of channel keys read better capitalized a specific way; everything
// else is title-cased (underscores → spaces). Keeps real attribution_channel /
// campaign_results.channel values presentable without a hardcoded whitelist.
const CHANNEL_LABEL_OVERRIDES: Record<string, string> = {
  sms: "SMS",
  seo: "SEO",
  ppc: "PPC",
  email: "Email",
  paid_social: "Paid social",
  paid_search: "Paid search",
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  organic_social: "Organic social",
  referral: "Referral",
};

export function formatChannelLabel(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (CHANNEL_LABEL_OVERRIDES[key]) return CHANNEL_LABEL_OVERRIDES[key];
  const spaced = raw.trim().replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const ASSET_TYPE_FORMAT: Record<string, string> = {
  landing_page: "Landing",
  search_ad: "Search ad",
  social_ad: "Social ad",
  display_ad: "Display ad",
  google_business_post: "GBP post",
  email: "Email",
  sms: "SMS",
  video_prompt: "Video",
  image_prompt: "Image",
  one_pager: "One-pager",
  referral_packet: "Referral packet",
  review_response: "Review reply",
  script: "Script",
};

function formatAssetType(assetType: string | null): string {
  if (!assetType) return "Asset";
  return ASSET_TYPE_FORMAT[assetType] ?? formatChannelLabel(assetType);
}

// Provenance label matching the demo vocabulary + provTone() in the detail view.
// An asset generated by a tool (tool_source set, or an AI source_system) is
// AI-generated; approved BSR media is Real media.
function assetSourceLabel(sourceSystem: string | null, toolSource: string | null): string {
  const s = `${sourceSystem ?? ""} ${toolSource ?? ""}`.toLowerCase();
  if (s.includes("composite")) return "Composite";
  if (toolSource?.trim() || s.includes("ai") || s.includes("gemini") || s.includes("veo") || s.includes("higgsfield") || s.includes("generated")) {
    return "AI-generated";
  }
  if (s.includes("stock")) return "Stock";
  return "Real media";
}

function titleCaseStatus(status: string | null): string {
  if (!status) return "—";
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}

type AttributionRows = {
  leadChannels: { id: string; channel: string | null }[];
  outcomes: { lead_id: string | null; status: string | null; gross_revenue_cents: number | null }[];
  results: {
    channel: string | null;
    campaign_asset_id: string | null;
    impressions: number | null;
    clicks: number | null;
    leads: number | null;
    jobs: number | null;
    won_revenue_cents: number | null;
    spend_cents: number | null;
  }[];
  assets: {
    id: string;
    title: string | null;
    channel: string | null;
    asset_type: string | null;
    source_system: string | null;
    tool_source: string | null;
    status: string | null;
  }[];
};

/**
 * Pure: per-channel attribution rows. Leads and booked/revenue come from CRM
 * (lead attribution_channel + won/paid outcomes); spend/impressions/clicks come
 * from self-reported campaign_results. Never double-counts — a metric prefers the
 * CRM figure and only falls back to the delivery side's own number when CRM has
 * nothing for that channel. Empty (all-zero) channels are dropped.
 */
export function buildChannelRows(rows: AttributionRows): PerformanceChannelRow[] {
  const channelByLead = new Map<string, string>();
  for (const lead of rows.leadChannels) {
    const key = lead.channel?.trim().toLowerCase();
    if (key) channelByLead.set(lead.id, key);
  }

  type Acc = { crmLeads: number; crmBooked: number; crmRevenue: number; spend: number; impressions: number; clicks: number; resLeads: number; resJobs: number; resWon: number };
  const acc = new Map<string, Acc>();
  const ensure = (key: string): Acc => {
    let a = acc.get(key);
    if (!a) {
      a = { crmLeads: 0, crmBooked: 0, crmRevenue: 0, spend: 0, impressions: 0, clicks: 0, resLeads: 0, resJobs: 0, resWon: 0 };
      acc.set(key, a);
    }
    return a;
  };

  for (const key of channelByLead.values()) ensure(key).crmLeads += 1;

  for (const o of rows.outcomes) {
    if (!WON_STATUSES.includes(o.status ?? "")) continue;
    const key = o.lead_id ? channelByLead.get(o.lead_id) : undefined;
    if (!key) continue;
    const a = ensure(key);
    a.crmBooked += 1;
    a.crmRevenue += o.gross_revenue_cents ?? 0;
  }

  for (const r of rows.results) {
    const key = r.channel?.trim().toLowerCase();
    if (!key) continue;
    const a = ensure(key);
    a.spend += r.spend_cents ?? 0;
    a.impressions += r.impressions ?? 0;
    a.clicks += r.clicks ?? 0;
    a.resLeads += r.leads ?? 0;
    a.resJobs += r.jobs ?? 0;
    a.resWon += r.won_revenue_cents ?? 0;
  }

  const merged = [...acc.entries()].map(([key, a]) => {
    const leads = a.crmLeads || a.resLeads;
    const booked = a.crmBooked || a.resJobs;
    const revenueCents = a.crmRevenue || a.resWon;
    return { key, leads, booked, revenueCents, spendCents: a.spend };
  });

  const totalLeads = merged.reduce((sum, m) => sum + m.leads, 0);

  return merged
    .filter((m) => m.leads > 0 || m.booked > 0 || m.spendCents > 0)
    .sort((a, b) => b.booked - a.booked || b.revenueCents - a.revenueCents || b.leads - a.leads)
    .map((m) => ({
      channel: formatChannelLabel(m.key),
      leads: m.leads,
      booked: m.booked,
      revenue: m.revenueCents > 0 ? usd(m.revenueCents) : "—",
      spend: m.spendCents > 0 ? usd(m.spendCents) : "—",
      share: totalLeads > 0 ? Math.round((m.leads / totalLeads) * 100) : 0,
    }));
}

/**
 * Pure: per-asset delivery rows. Only assets with attached delivery results
 * (impressions/clicks/leads from campaign_results) are surfaced — an approved
 * asset that hasn't run yet has nothing to report. Sorted by CTR.
 */
export function buildAssetRows(rows: AttributionRows): PerformanceAssetRow[] {
  type Acc = { impressions: number; clicks: number; leads: number };
  const byAsset = new Map<string, Acc>();
  for (const r of rows.results) {
    if (!r.campaign_asset_id) continue;
    let a = byAsset.get(r.campaign_asset_id);
    if (!a) {
      a = { impressions: 0, clicks: 0, leads: 0 };
      byAsset.set(r.campaign_asset_id, a);
    }
    a.impressions += r.impressions ?? 0;
    a.clicks += r.clicks ?? 0;
    a.leads += r.leads ?? 0;
  }

  const out: PerformanceAssetRow[] = [];
  for (const asset of rows.assets) {
    const metrics = byAsset.get(asset.id);
    if (!metrics || metrics.impressions === 0) continue;
    out.push({
      id: asset.id,
      title: asset.title?.trim() || "Untitled asset",
      channel: asset.channel?.trim() ? formatChannelLabel(asset.channel) : formatAssetType(asset.asset_type),
      format: formatAssetType(asset.asset_type),
      source: assetSourceLabel(asset.source_system, asset.tool_source),
      status: titleCaseStatus(asset.status),
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      leads: metrics.leads,
      ctr: metrics.impressions > 0 ? Math.round((metrics.clicks / metrics.impressions) * 1000) / 10 : 0,
    });
  }

  return out.sort((a, b) => b.ctr - a.ctr || b.impressions - a.impressions);
}

/** Map real CRM attribution economics into the shared panel shape. */
export function buildAttributedPanel(
  econ: Extract<CampaignEconomicsReadModel, { status: "live" }>,
  trend: PerformanceTrendPoint[] = [],
  channels: PerformanceChannelRow[] = [],
  assets: PerformanceAssetRow[] = [],
): CampaignPerformancePanel {
  const kpis: PerformanceKpi[] = [
    { key: "realized", label: "Realized revenue", value: usd(econ.realizedRevenueCents), hint: "won & paid outcomes" },
    { key: "pipeline", label: "Open pipeline", value: usd(econ.pipelineRevenueCents), hint: "estimated on open jobs" },
    { key: "leads", label: "Attributed leads", value: NUM.format(econ.attributedLeads), hint: "linked to this campaign" },
    { key: "booked", label: "Booked jobs", value: NUM.format(econ.wonCount), hint: "won or paid" },
    {
      key: "roas",
      label: "ROAS",
      value: econ.roas != null ? `${econ.roas.toFixed(2)}×` : "—",
      hint: econ.roas != null ? "realized revenue / spend" : "no spend recorded",
    },
    {
      key: "spend",
      label: "Spend",
      value: usd(econ.spendCents),
      hint: econ.cac != null ? `${usd(econ.cac)} per booked job` : econ.cpl != null ? `${usd(econ.cpl)} per lead` : "no spend recorded",
    },
  ];

  return {
    status: "live",
    source: "attributed",
    windowLabel: "All time",
    note: "Attributed from booked jobs and outcomes linked to this campaign in CRM. ROAS reflects realized revenue only — pipeline is shown separately.",
    kpis,
    // Per-channel rows are attributed from lead channels + won outcomes (CRM),
    // with spend/delivery merged from campaign_results. Empty until leads carry
    // an attribution_channel or delivery results are attached.
    channels,
    funnel: [
      { label: "Attributed leads", count: econ.attributedLeads },
      { label: "Booked jobs", count: econ.wonCount },
    ],
    // Weekly trend is derived from attributed leads + won outcomes (see
    // getCampaignTrendRows). Per-asset delivery metrics require attached
    // ad-platform / sending results (campaign_results linked to an asset).
    trend,
    assets,
  };
}

/** True when the live economics carry any real signal worth surfacing. */
function hasAttributionSignal(econ: Extract<CampaignEconomicsReadModel, { status: "live" }>): boolean {
  return econ.attributedLeads > 0 || econ.spendCents > 0 || econ.realizedRevenueCents > 0 || econ.pipelineRevenueCents > 0;
}

/**
 * What Arc learned from a campaign's results, and the next move — the closing
 * step of the performance loop. Purely derived from the panel's real numbers
 * (no fabrication): the best channel by booked jobs, the best asset by CTR, and a
 * grounded recommendation for the next iteration. Null while measuring or when
 * there isn't enough signal to say anything honest yet.
 */
export type PerformanceLearning = {
  /** What worked, each a full sentence citing the real figure. */
  wins: string[];
  /** The recommended next iteration, grounded in the same numbers. */
  recommendation: string;
  /** A ready-to-send prompt for Arc to draft that next iteration. */
  arcPrompt: string;
};

export function buildPerformanceLearning(
  panel: CampaignPerformancePanel,
  campaignName?: string,
): PerformanceLearning | null {
  if (panel.status !== "live" || panel.channels.length === 0) return null;

  const byBooked = [...panel.channels].sort((a, b) => b.booked - a.booked || b.leads - a.leads);
  const top = byBooked[0];
  if (top.booked === 0 && top.leads === 0) return null; // no delivered signal yet

  const wins: string[] = [];
  wins.push(
    top.booked > 0
      ? `${top.channel} led on outcomes — ${top.booked} booked ${top.booked === 1 ? "job" : "jobs"} from ${top.leads} ${top.leads === 1 ? "lead" : "leads"}.`
      : `${top.channel} drove the most interest — ${top.leads} ${top.leads === 1 ? "lead" : "leads"}.`,
  );

  const topAsset = [...panel.assets].filter((asset) => asset.impressions > 0 && asset.ctr > 0).sort((a, b) => b.ctr - a.ctr)[0];
  if (topAsset) wins.push(`“${topAsset.title}” pulled hardest — ${topAsset.ctr.toFixed(1)}% CTR on ${topAsset.channel}.`);

  const weak = byBooked.slice(1).find((channel) => channel.leads > 0 && channel.booked === 0);

  const moves: string[] = [`lead with ${top.channel}`];
  if (topAsset) moves.push(`reuse “${topAsset.title}”`);
  if (weak) moves.push(`and rework ${weak.channel}, which drew ${weak.leads} ${weak.leads === 1 ? "lead" : "leads"} but no bookings`);
  const recommendation = `For the next iteration, ${moves.join(", ")}.`;

  const label = campaignName?.trim() ? `the ${campaignName.trim()} campaign` : "this campaign";
  const arcPrompt = `Draft the next iteration of ${label} based on what worked: ${recommendation} Keep it approval-gated.`;

  return { wins, recommendation, arcPrompt };
}

export async function getCampaignPerformancePanel(
  campaignId: string,
  /**
   * The workspace this campaign belongs to. Optional only because not every
   * caller has one — with it, attributed revenue reads the org's own stages
   * instead of assuming ours (BSR-563).
   */
  orgId?: string,
): Promise<CampaignPerformancePanel> {
  // Live attribution first when Supabase is configured and the campaign has signal.
  if (isSupabaseAdminConfigured()) {
    const econ = await getCampaignEconomics(campaignId, undefined, orgId);
    if (econ.status === "live" && hasAttributionSignal(econ)) {
      const [rows, breakdown] = await Promise.all([
        getCampaignTrendRows(campaignId, undefined, orgId),
        getCampaignAttributionRows(campaignId),
      ]);
      let trend: PerformanceTrendPoint[] = [];
      if (rows.status === "live") {
        const built = buildWeeklyTrend(rows.leadDates, rows.wonEvents, Date.now(), 12);
        // Only surface the chart when there's real signal in-window — a flat zero
        // line would misrepresent a campaign whose activity predates the window.
        if (built.some((p) => p.revenue > 0 || p.leads > 0)) trend = built;
      }
      const channels = breakdown.status === "live" ? buildChannelRows(breakdown) : [];
      const assets = breakdown.status === "live" ? buildAssetRows(breakdown) : [];
      return buildAttributedPanel(econ, trend, channels, assets);
    }
  }

  // Local preview / unconfigured: fall back to the illustrative demo detail.
  if (isDemoDataEnabled()) {
    const demo = getCampaignAnalyticsDemoDetail(campaignId);
    if (demo) return buildDemoPanel(demo);
  }

  return { status: "measuring", message: MEASURING_MESSAGE };
}

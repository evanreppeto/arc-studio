// Analytics Overview read-model — computes the Performance-overview numbers the
// mockup shows (KPI deltas, a 30-day trend with a previous-period overlay, the
// lead→job→won funnel, and revenue-by-persona / leads-by-source breakdowns)
// straight from real leads / jobs / outcomes rows. Everything is derived, so it
// degrades gracefully when the tables are sparse or unconfigured.
import { humanizePersonaLabel } from "@/domain";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

const DAY = 86400000;
const DEFAULT_WINDOW = 30; // days per period

/** Supported analytics windows (days). The UI range selector and the read-model
 *  share this list so a URL can't request an unsupported period. */
export const ANALYTICS_WINDOWS = [7, 30, 90] as const;
export type AnalyticsWindow = (typeof ANALYTICS_WINDOWS)[number];

/** Clamp an untrusted `?range` value to a supported window; defaults to 30. */
export function normalizeWindow(raw: unknown): AnalyticsWindow {
  const n = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  return (ANALYTICS_WINDOWS as readonly number[]).includes(n) ? (n as AnalyticsWindow) : DEFAULT_WINDOW;
}

export type TrendKey = "revenue" | "leads" | "bookings";
export type KpiTag = "wired" | "partial" | "sync";

export type OverviewKpi = {
  label: string;
  value: string;
  deltaLabel: string; // e.g. "+12.5%" or "— est."
  dir: "up" | "dn" | "flat";
  prevLabel: string;
  tag: KpiTag;
  tagLabel: string;
};
export type TrendSeries = { cur: number[]; prev: number[] };
export type BreakdownRow = { label: string; count: number; width: number; dot: string; valueLabel?: string };
export type FunnelStage = { label: string; count: number; width: number; note: string };

export type AnalyticsOverview = {
  kpis: OverviewKpi[];
  trend: Record<TrendKey, TrendSeries>;
  trendLabels: string[];
  funnel: FunnelStage[];
  revenueByPersona: BreakdownRow[];
  leadsBySource: BreakdownRow[];
  arcRead: { text: string; cites: string[]; rec: string };
  hasHistory: boolean;
  /**
   * Set when a CRM query FAILED rather than returned nothing. postgrest reports
   * errors in `{ error }` instead of throwing, so an RLS denial, a dropped column
   * or a timeout used to arrive here as `data: null` → `[]` → a page of zeros
   * rendered under "org-scoped, straight from CRM". A workspace whose data we
   * couldn't read must never be presented as a workspace with no data.
   */
  dataError?: string | null;
};

const PERSONA_DOTS = ["#c8a24a", "#7fb89a", "#88b6d8", "#9678c8", "#cc6a6a", "#d8935a", "#6ea8a0", "#b08fd0"];

function humanizePersona(p: string): string {
  const label = humanizePersonaLabel(p);
  return !label || /^unassigned/i.test(label) ? "Unassigned" : label;
}

function pct(cur: number, prev: number): { deltaLabel: string; dir: "up" | "dn" | "flat" } {
  if (prev <= 0) return { deltaLabel: cur > 0 ? "new" : "—", dir: cur > 0 ? "up" : "flat" };
  const d = ((cur - prev) / prev) * 100;
  if (Math.abs(d) < 0.5) return { deltaLabel: "flat", dir: "flat" };
  return { deltaLabel: `${d > 0 ? "+" : ""}${d.toFixed(1)}%`, dir: d > 0 ? "up" : "dn" };
}

function money(cents: number): string {
  const dollars = Math.round(cents / 100);
  if (dollars >= 1000) return `$${Math.round(dollars / 1000)}k`;
  return `$${dollars.toLocaleString()}`;
}

type LeadRow = { created_at: string; persona: string | null; source: string | null };
type JobRow = { created_at: string };
type OutcomeRow = { created_at: string; persona: string | null; gross_revenue_cents: number | null; status: string };

function emptyOverview(windowDays: number): AnalyticsOverview {
  const zero = () => ({ cur: Array(windowDays).fill(0), prev: Array(windowDays).fill(0) });
  return {
    kpis: [],
    trend: { revenue: zero(), leads: zero(), bookings: zero() },
    trendLabels: [],
    funnel: [],
    revenueByPersona: [],
    leadsBySource: [],
    arcRead: { text: "", cites: [], rec: "" },
    hasHistory: false,
  };
}

/** Deterministic pseudo-random so the demo is stable across renders. */
function seeded(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Illustrative overview for local preview / demos (no Supabase). Numbers are
// synthetic but internally consistent and mirror the demo campaign portfolio
// (see lib/performance/read-model demo dataset). Read-only display only.
function demoAnalyticsOverview(windowDays: number): AnalyticsOverview {
  const rng = seeded(20260708);
  const series = (): TrendSeries => ({ cur: Array(windowDays).fill(0), prev: Array(windowDays).fill(0) });
  const trend: Record<TrendKey, TrendSeries> = { revenue: series(), leads: series(), bookings: series() };

  const spikeCenter = Math.floor(windowDays * 0.55); // demand surge sits just past mid-window
  for (let i = 0; i < windowDays; i++) {
    const progress = windowDays > 1 ? i / (windowDays - 1) : 0;
    const demandSpike = Math.abs(i - spikeCenter) <= 2 ? 7 : 0; // demand surge, window-relative
    const baseLeads = 18 + progress * 10 + demandSpike; // ramps ~18 → ~28
    const lc = Math.max(0, Math.round(baseLeads + (rng() - 0.5) * 6));
    const lp = Math.max(0, Math.round(baseLeads * 0.82 + (rng() - 0.5) * 6));
    trend.leads.cur[i] = lc;
    trend.leads.prev[i] = lp;

    const rate = 0.1 + progress * 0.05; // lead→booked ramps 10% → 15%
    const bc = Math.max(0, Math.round(lc * rate));
    const bp = Math.max(0, Math.round(lp * (rate - 0.02)));
    trend.bookings.cur[i] = bc;
    trend.bookings.prev[i] = bp;

    // ~$2,300 avg revenue per booked job, with variance, in cents.
    trend.revenue.cur[i] = bc * Math.round(210_000 + rng() * 70_000);
    trend.revenue.prev[i] = bp * Math.round(205_000 + rng() * 60_000);
  }

  const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);
  const curLeads = sum(trend.leads.cur);
  const prevLeads = sum(trend.leads.prev);
  const curJobs = sum(trend.bookings.cur);
  const prevJobs = sum(trend.bookings.prev);
  const curRev = sum(trend.revenue.cur);
  const prevRev = sum(trend.revenue.prev);
  const curWon = Math.round(curJobs * 0.84);

  const kpis: OverviewKpi[] = [
    { label: "Leads", value: curLeads.toLocaleString(), ...pct(curLeads, prevLeads), prevLabel: `${prevLeads} prev`, tag: "wired", tagLabel: "wired" },
    { label: "Booked jobs", value: curJobs.toLocaleString(), ...pct(curJobs, prevJobs), prevLabel: `${prevJobs} prev`, tag: "wired", tagLabel: "wired" },
    { label: "Won revenue", value: money(curRev), ...pct(curRev, prevRev), prevLabel: `${money(prevRev)} prev`, tag: "wired", tagLabel: "wired" },
    { label: "Reply rate", value: "—", deltaLabel: "needs sends", dir: "flat", prevLabel: "no send denominator", tag: "partial", tagLabel: "partial" },
    { label: "Cost / job", value: "—", deltaLabel: "— est.", dir: "flat", prevLabel: "needs spend feed", tag: "sync", tagLabel: "needs sync" },
  ];

  const funnelMax = Math.max(1, curLeads);
  const funnel: FunnelStage[] = [
    // Width 100 is the top of the funnel only when there IS a top: a workspace
    // with no leads yet was drawing a full-width bar over the number 0.
    { label: "Leads", count: curLeads, width: curLeads > 0 ? 100 : 0, note: "" },
    { label: "Booked jobs", count: curJobs, width: Math.round((curJobs / funnelMax) * 100), note: `${((curJobs / curLeads) * 100).toFixed(1)}%` },
    { label: "Won", count: curWon, width: Math.round((curWon / funnelMax) * 100), note: `${((curWon / curLeads) * 100).toFixed(1)}%` },
  ];

  const personaRev: Array<[string, number]> = [
    ["High-Intent Evaluator", 8_930_000],
    ["Team Admin", 5_120_000],
    ["Proactive Evaluator", 3_960_000],
    ["Feature-Focused Evaluator", 1_840_000],
    ["Procurement", 1_020_000],
  ];
  const revMax = Math.max(1, ...personaRev.map(([, v]) => v));
  const revenueByPersona: BreakdownRow[] = personaRev.map(([label, v], i) => ({
    label,
    count: v,
    width: Math.round((v / revMax) * 100),
    dot: PERSONA_DOTS[i % PERSONA_DOTS.length],
    valueLabel: money(v),
  }));

  const sources: Array<[string, number]> = [
    ["Email", 214],
    ["Meta Ads", 168],
    ["Landing", 142],
    ["SMS", 96],
    ["Referral", 74],
  ];
  const srcMax = Math.max(1, ...sources.map(([, v]) => v));
  const leadsBySource: BreakdownRow[] = sources.map(([label, v], i) => ({
    label,
    count: v,
    width: Math.round((v / srcMax) * 100),
    dot: PERSONA_DOTS[i % PERSONA_DOTS.length],
  }));

  const trendLabels = Array.from({ length: windowDays }, (_, i) => {
    const d = new Date(Math.floor(Date.now() / DAY) * DAY - (windowDays - 1 - i) * DAY);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });

  return {
    kpis,
    trend,
    trendLabels,
    funnel,
    revenueByPersona,
    leadsBySource,
    arcRead: {
      text: `Won revenue is up ${pct(curRev, prevRev).deltaLabel} on ${curWon} booked demos from ${curLeads.toLocaleString()} leads — you're converting better, not just sourcing more. Revenue is concentrated in the High-Intent Evaluator persona, and Email is your top lead source. Reply and cost-per-demo metrics fill in once campaigns send and an ad platform syncs.`,
      cites: [`leads ${curLeads.toLocaleString()}`, `won ${curWon}`, `rev ${money(curRev)}`],
      rec: "Double down on High-Intent Evaluator — your highest-revenue persona this period. Arc can draft a lookalike campaign against it, approval-gated.",
    },
    hasHistory: true,
  };
}

export async function getAnalyticsOverview(
  orgId: string,
  windowDays: number = DEFAULT_WINDOW,
): Promise<AnalyticsOverview> {
  if (!isSupabaseAdminConfigured()) return isDemoDataEnabled() ? demoAnalyticsOverview(windowDays) : emptyOverview(windowDays);
  const admin = getSupabaseAdminClient();
  const since = new Date(Date.now() - 2 * windowDays * DAY).toISOString();

  const [leadsRes, jobsRes, outcomesRes] = await Promise.all([
    admin.from("leads").select("created_at, persona, source").eq("org_id", orgId).gte("created_at", since),
    admin.from("jobs").select("created_at").eq("org_id", orgId).gte("created_at", since),
    admin.from("outcomes").select("created_at, persona, gross_revenue_cents, status").eq("org_id", orgId).gte("created_at", since),
  ]);
  // postgrest returns `{ error }` rather than throwing, so an ignored error field
  // is indistinguishable from an empty table: the page renders $0 / 0 leads / flat
  // under a banner claiming it came straight from CRM. Fail loudly instead — the
  // caller shows an honest "couldn't read" state rather than a confident zero.
  const failed = [
    ["leads", leadsRes.error],
    ["jobs", jobsRes.error],
    ["outcomes", outcomesRes.error],
  ].filter(([, error]) => Boolean(error)) as [string, { message: string }][];
  if (failed.length > 0) {
    const detail = failed.map(([table, error]) => `${table}: ${error.message}`).join("; ");
    console.warn(`[analytics] overview query failed for org ${orgId} — ${detail}`);
    return {
      ...emptyOverview(windowDays),
      dataError: `Couldn't read ${failed.map(([table]) => table).join(", ")} from your CRM.`,
    };
  }

  const leads = (leadsRes.data ?? []) as LeadRow[];
  const jobs = (jobsRes.data ?? []) as JobRow[];
  const outcomes = (outcomesRes.data ?? []) as OutcomeRow[];

  // Bucket anchors: `windowDays` daily buckets ending today; the previous window
  // is the equal-length span immediately before.
  const startOfToday = Math.floor(Date.now() / DAY) * DAY;
  const curStart = startOfToday - (windowDays - 1) * DAY;
  const prevStart = curStart - windowDays * DAY;
  const bucket = (iso: string): { period: "cur" | "prev" | null; idx: number } => {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return { period: null, idx: -1 };
    if (t >= curStart) {
      const idx = Math.floor((t - curStart) / DAY);
      return idx >= 0 && idx < windowDays ? { period: "cur", idx } : { period: null, idx: -1 };
    }
    if (t >= prevStart) {
      const idx = Math.floor((t - prevStart) / DAY);
      return idx >= 0 && idx < windowDays ? { period: "prev", idx } : { period: null, idx: -1 };
    }
    return { period: null, idx: -1 };
  };

  const series = (): TrendSeries => ({ cur: Array(windowDays).fill(0), prev: Array(windowDays).fill(0) });
  const trend: Record<TrendKey, TrendSeries> = { revenue: series(), leads: series(), bookings: series() };

  for (const l of leads) {
    const b = bucket(l.created_at);
    if (b.period) trend.leads[b.period][b.idx] += 1;
  }
  for (const j of jobs) {
    const b = bucket(j.created_at);
    if (b.period) trend.bookings[b.period][b.idx] += 1;
  }
  const isWin = (o: OutcomeRow) => o.status === "won" || o.status === "paid";
  for (const o of outcomes) {
    if (!isWin(o)) continue;
    const b = bucket(o.created_at);
    if (b.period) trend.revenue[b.period][b.idx] += o.gross_revenue_cents ?? 0;
  }

  const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);
  const curLeads = sum(trend.leads.cur);
  const prevLeads = sum(trend.leads.prev);
  const curJobs = sum(trend.bookings.cur);
  const prevJobs = sum(trend.bookings.prev);
  const curRev = sum(trend.revenue.cur);
  const prevRev = sum(trend.revenue.prev);
  const curWon = outcomes.filter((o) => isWin(o) && bucket(o.created_at).period === "cur").length;

  const hasHistory = curLeads + prevLeads + curJobs + curRev > 0;

  const leadsDelta = pct(curLeads, prevLeads);
  const jobsDelta = pct(curJobs, prevJobs);
  const revDelta = pct(curRev, prevRev);

  const kpis: OverviewKpi[] = [
    { label: "Leads", value: curLeads.toLocaleString(), ...leadsDelta, prevLabel: `${prevLeads} prev`, tag: "wired", tagLabel: "wired" },
    { label: "Booked jobs", value: curJobs.toLocaleString(), ...jobsDelta, prevLabel: `${prevJobs} prev`, tag: "wired", tagLabel: "wired" },
    { label: "Won revenue", value: money(curRev), ...revDelta, prevLabel: `${money(prevRev)} prev`, tag: "wired", tagLabel: "wired" },
    { label: "Reply rate", value: "—", deltaLabel: "needs sends", dir: "flat", prevLabel: "no send denominator", tag: "partial", tagLabel: "partial" },
    { label: "Cost / job", value: "—", deltaLabel: "— est.", dir: "flat", prevLabel: "needs spend feed", tag: "sync", tagLabel: "needs sync" },
  ];

  // Funnel (current window): leads -> booked -> won.
  const funnelMax = Math.max(1, curLeads);
  const funnel: FunnelStage[] = [
    // Width 100 is the top of the funnel only when there IS a top: a workspace
    // with no leads yet was drawing a full-width bar over the number 0.
    { label: "Leads", count: curLeads, width: curLeads > 0 ? 100 : 0, note: "" },
    { label: "Booked jobs", count: curJobs, width: Math.round((curJobs / funnelMax) * 100), note: curLeads ? `${((curJobs / curLeads) * 100).toFixed(1)}%` : "" },
    { label: "Won", count: curWon, width: Math.round((curWon / funnelMax) * 100), note: curLeads ? `${((curWon / curLeads) * 100).toFixed(1)}%` : "" },
  ];

  // Revenue by persona (current window, won/paid).
  const revByPersona = new Map<string, number>();
  for (const o of outcomes) {
    if (!isWin(o) || bucket(o.created_at).period !== "cur") continue;
    const label = humanizePersona(o.persona ?? "");
    revByPersona.set(label, (revByPersona.get(label) ?? 0) + (o.gross_revenue_cents ?? 0));
  }
  const revEntries = [...revByPersona.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const revMax = Math.max(1, ...revEntries.map(([, v]) => v));
  const revenueByPersona: BreakdownRow[] = revEntries.map(([label, v], i) => ({
    label,
    count: v,
    width: Math.round((v / revMax) * 100),
    dot: PERSONA_DOTS[i % PERSONA_DOTS.length],
    valueLabel: money(v),
  }));

  // Leads by source (current window).
  const bySource = new Map<string, number>();
  for (const l of leads) {
    if (bucket(l.created_at).period !== "cur") continue;
    const label = (l.source || "Unknown").trim() || "Unknown";
    bySource.set(label, (bySource.get(label) ?? 0) + 1);
  }
  const srcEntries = [...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const srcMax = Math.max(1, ...srcEntries.map(([, v]) => v));
  const leadsBySource: BreakdownRow[] = srcEntries.map(([label, v], i) => ({
    label,
    count: v,
    width: Math.round((v / srcMax) * 100),
    dot: PERSONA_DOTS[i % PERSONA_DOTS.length],
  }));

  // Arc's read — narrative from the real deltas.
  const topPersona = revenueByPersona[0]?.label ?? "your core personas";
  const topSource = leadsBySource[0]?.label ?? "your channels";
  const arcRead = hasHistory
    ? {
        text:
          revDelta.dir === "up" && leadsDelta.dir !== "up"
            ? `Won revenue is up ${revDelta.deltaLabel} while lead volume held roughly flat — you're converting better, not just sourcing more. Revenue is concentrated in the ${topPersona} persona, and ${topSource} is your top lead source.`
            : `You closed ${money(curRev)} across ${curWon} won jobs from ${curLeads} leads this period. Revenue leans on the ${topPersona} persona; ${topSource} brought the most leads. Reply and cost metrics fill in once campaigns send and an ad platform syncs.`,
        cites: [`leads ${curLeads}`, `won ${curWon}`, `rev ${money(curRev)}`],
        rec: `Double down on ${topPersona} — it's your highest-revenue persona this period. Arc can draft a lookalike campaign against it, approval-gated.`,
      }
    : {
        text: "Not enough history yet to trend. As leads, jobs, and outcomes accrue, the funnel and period-over-period deltas build out here.",
        cites: [],
        rec: "",
      };

  const trendLabels = Array.from({ length: windowDays }, (_, i) => {
    const d = new Date(curStart + i * DAY);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });

  return { kpis, trend, trendLabels, funnel, revenueByPersona, leadsBySource, arcRead, hasHistory };
}

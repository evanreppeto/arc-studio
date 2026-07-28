import { getRecentActivity, type ActivityEntry, type ActivityTone } from "@/lib/activity/read-model";
import { getAnalyticsOverview, normalizeWindow } from "@/lib/analytics/overview";
import { unavailable } from "@/lib/observability/unavailable";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getOpportunityConversion } from "@/lib/performance/opportunity-conversion";
import { getPerformanceReadModel } from "@/lib/performance/read-model";

import { AnalyticsView, type ActivityDayVM } from "./_components/analytics-view";

export const metadata = { title: "Analytics — Arc Studio" };

const TONE_DOT: Record<ActivityTone, string> = {
  green: "var(--ok)",
  red: "var(--red)",
  amber: "var(--warn)",
  blue: "#88b6d8",
  gray: "var(--muted)",
};

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function toActivityRow(e: ActivityEntry) {
  const meta = [e.actor, e.relatedLabel, e.insightLabel].filter(Boolean) as string[];
  return { id: e.id, dot: TONE_DOT[e.tone] ?? "var(--muted)", title: e.title, detail: e.detail, meta, time: timeLabel(e.occurredAt) };
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await getCurrentWorkspaceContext();
  const range = normalizeWindow((await searchParams).range);
  const [overview, activity, performance, conversion] = await Promise.all([
    getAnalyticsOverview(ctx.orgId, range).catch(() => null),
    getRecentActivity({}, undefined, ctx.orgId).catch(unavailable("analytics.activity", ctx.orgId)),
    getPerformanceReadModel(undefined, undefined, ctx.orgId).catch(unavailable("analytics.performance", ctx.orgId)),
    getOpportunityConversion(ctx.orgId).catch(unavailable("analytics.conversion", ctx.orgId)),
  ]);

  const campaignRows = performance.status === "live" ? (performance.campaignRows ?? []) : [];
  const channels = performance.status === "live" ? (performance.channelPerformance ?? []) : [];
  const anomalies = performance.status === "live" ? (performance.anomalies ?? []) : [];
  const nextMoves = performance.status === "live" ? (performance.nextMoves ?? []) : [];

  const activitySummary =
    activity.status === "live"
      ? [
          { label: "Needs review", value: activity.summary.needsReview },
          { label: "Arc actions", value: activity.summary.arcActions },
          { label: "Campaign progress", value: activity.summary.campaignProgress },
          { label: "Blocked / risky", value: activity.summary.blockedOrRisky },
        ]
      : [];
  const activityDays: ActivityDayVM[] =
    activity.status === "live"
      ? activity.groups.map((g) => ({ label: g.label, rows: g.entries.map(toActivityRow) }))
      : [];

  const safeOverview = overview ?? {
    kpis: [],
    trend: { revenue: { cur: [], prev: [] }, leads: { cur: [], prev: [] }, bookings: { cur: [], prev: [] } },
    trendLabels: [],
    funnel: [],
    revenueByPersona: [],
    leadsBySource: [],
    arcRead: { text: "", cites: [], rec: "" },
    hasHistory: false,
  };

  return (
    <AnalyticsView
      overview={safeOverview}
      range={range}
      conversion={conversion}
      activitySummary={activitySummary}
      activityDays={activityDays}
      campaignRows={campaignRows}
      channels={channels}
      anomalies={anomalies}
      nextMoves={nextMoves}
    />
  );
}

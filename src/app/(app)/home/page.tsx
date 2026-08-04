import Link from "next/link";

import {
  humanizePersonaLabel as humanizePersona,
  ASSET_NOUN,
  definitionText,
  countOf,
  DAY_NOUN,
  needsYouPhrase,
  toWorkState,
  WORK_STATE_LABEL,
} from "@/domain";
import { resolveViewerName } from "@/lib/auth/display-name";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getActivationState } from "@/lib/activation/read-model";
import { getAnalyticsOverview, type OverviewKpi, type TrendKey } from "@/lib/analytics/overview";
import { promptForOpportunity } from "@/lib/arc-chat/waiting-opps";
import { type OpportunityEvidence } from "@/lib/opportunities/read-model";

import { QuickActions } from "./_components/quick-actions";
import { SetupChecklist } from "./_components/setup-checklist";
import { Define } from "../_components/define";
import { KpiStrip } from "../_components/kpi-strip";
import { humanizeArcProse } from "../opportunities/prose";
import { getSupabaseAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getWorkspaceSummary } from "@/lib/workspace-summary/read-model";

export const metadata = { title: "Home — Arc Studio" };

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const min = Math.round((Date.now() - then) / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

// Home renders the SAME Arc-written opportunity prose the inbox does — the hero
// card read `"Suburban Home Background Asset" (campaign 0bd41cb3-…)` — so it
// goes through the same sanitizer rather than a second one that would drift
// (#908, BSR-740). Cleaned before truncating, so removing a token can win back
// room for words.
function concise(value: string, maxLength: number): string {
  const normalized = humanizeArcProse(value).replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const clipped = normalized.slice(0, maxLength + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > maxLength * 0.7 ? lastSpace : maxLength).trimEnd()}…`;
}

function pillTone(a: { status: string; statusLabel: string; riskLevel: string }): "warn" | "red" | "ok" {
  const s = `${a.status} ${a.statusLabel}`.toLowerCase();
  if (s.includes("block") || a.riskLevel === "high") return "red";
  if (s.includes("approv") || s.includes("review") || s.includes("pending")) return "warn";
  return "ok";
}

// Task-pill labels, resolved through the one vocabulary (BSR-656) rather than
// spelled out here. "Blocked" used to sit in the red slot; a compliance hold is
// work coming back to you, so it reads as "Needs changes" now.
const PILL_LABEL: Record<"warn" | "red" | "ok", string> = {
  warn: WORK_STATE_LABEL.needs_you,
  red: WORK_STATE_LABEL.needs_changes,
  ok: WORK_STATE_LABEL.approved,
};

// Cite chips for the top opportunity — each references a REAL evidence field on
// the record, so the [1][2] badges are honest source pointers, not decoration.
function evidenceFacts(ev?: OpportunityEvidence | null): string[] {
  if (!ev) return [];
  const facts: string[] = [];
  for (const url of ev.evidence_urls ?? []) facts.push(`Source · ${url.replace(/^https?:\/\//, "")}`);
  if (typeof ev.leadScore === "number") facts.push(`Lead score ${ev.leadScore} — ${definitionText("lead_score")}`);
  if (typeof ev.daysCold === "number") facts.push(`${countOf(ev.daysCold, DAY_NOUN)} since last activity`);
  if (ev.lastActivityAt) facts.push(`Last activity ${relativeTime(ev.lastActivityAt)}`);
  if (!facts.length && ev.persona) facts.push(`Persona · ${humanizePersona(ev.persona)}`);
  return facts.slice(0, 3);
}

export default async function HomePage() {
  // The (app) layout has already resolved + guarded the workspace; this cached
  // read is free.
  const ctx = await getCurrentWorkspaceContext();
  const user = await getSupabaseAuthenticatedUser();
  const firstName = (await resolveViewerName(ctx.orgId, user)).trim().split(/\s+/)[0] ?? "";

  // One consistent snapshot for the whole screen: the hero line, the "waiting on
  // you" queue, the metrics, and the campaign rows all read from the same summary
  // so they can't disagree with each other.
  const [summary, overview, activation] = await Promise.all([
    getWorkspaceSummary(ctx.orgId, "Arc", ctx.workspaceId),
    getAnalyticsOverview(ctx.orgId),
    // First-run guidance. Hidden once the workspace has records and the owner
    // has either finished or dismissed it, so an established workspace never
    // sees this.
    getActivationState(ctx.orgId, ctx.workspaceId ?? null),
  ]);
  const approvalCount = summary.approvals.length;
  const approvals = summary.approvals.slice(0, 3);
  const campaigns = summary.campaigns.slice(0, 4);
  const openOppCount = summary.opportunities.length;
  const opps = summary.opportunities.slice(0, 3);
  const focal = opps[0] ?? null;

  // Right column: source-backed signals (top opportunities) + Arc activity feed.
  const signalLabel: Record<string, string> = { high: "Urgent · watched by Arc", medium: "Watched by Arc", low: "Background signal" };
  const signals = opps.slice(0, 3).map((o) => ({
    id: o.id,
    title: o.title,
    source: signalLabel[o.urgency] ?? "Source-backed signal",
    time: relativeTime(o.evidence?.lastActivityAt ?? ""),
  }));
  // This feed renders `<b>{actor}</b> {text}`, so `text` has to be a PREDICATE —
  // handed the entry's title it read "You Approval Revision Requested" four
  // times down the front page (BSR-734).
  const activityItems = summary.activity.slice(0, 5).map((a) => ({
    at: relativeTime(a.occurredAt),
    actor: a.actorType === "arc" || a.actorType === "sub_agent" ? "Arc" : a.actorType === "human" ? "You" : "System",
    text: a.predicate,
  }));

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
  const liveCampaigns = summary.campaignTotals.live;

  // Lead the home with real business-outcome KPIs — the same wired numbers the
  // Analytics screen shows (won revenue, booked jobs, leads), each with its
  // 30-day trend — instead of raw object counts. Reply rate / cost-per-job are
  // intentionally omitted until send + spend feeds exist (they'd read "—").
  const HOME_KPI_LABELS = ["Won revenue", "Booked jobs", "Leads"] as const;
  const metrics: OverviewKpi[] = HOME_KPI_LABELS.map((label) =>
    overview.kpis.find((k) => k.label === label),
  ).filter((k): k is OverviewKpi => Boolean(k));
  // Each KPI's 30-day trend series drives its inline sparkline.
  const KPI_TREND: Record<string, TrendKey> = { "Won revenue": "revenue", "Booked jobs": "bookings", Leads: "leads" };

  return (
    <div className="scroll">
      <section className="content">
        <div className="date">{dateLabel}</div>
        <h2 className="greet">
          {greeting}
          {firstName ? `, ${firstName}` : ""}
        </h2>
        <div className="subline">
          {needsYouPhrase(approvalCount)}
          <span className="dot">·</span>
          {openOppCount} open {openOppCount === 1 ? "opportunity" : "opportunities"}
          <span className="dot">·</span>
          {liveCampaigns} {liveCampaigns === 1 ? "campaign" : "campaigns"} sending
        </div>

        <SetupChecklist checklist={activation.checklist} />

        {focal && (
          <div className="focal">
            <div className="lab">Top opportunity</div>
            <div className="row1">
              <h2>{focal.title}</h2>
              {evidenceFacts(focal.evidence).length > 0 && (
                <span className="cites">
                  <span className="cites-label">Evidence</span>
                  {evidenceFacts(focal.evidence).map((f, i) => (
                    <span className="cite" key={i} title={f} tabIndex={0} role="note" aria-label={`Evidence: ${f}`}>
                      {i + 1}
                    </span>
                  ))}
                </span>
              )}
              <div className="conf">
                <span className="cl">Confidence<Define term="confidence" /></span>
                <span className="track">
                  <span className="fill" style={{ width: `${focal.confidence}%` }} />
                </span>
                <span className="val">{focal.confidence}%</span>
              </div>
            </div>
            <p className="d">{concise(focal.summary, 320)}</p>
            <div className="fcta">
              <Link className="btn" href={`/opportunities?selected=${encodeURIComponent(focal.id)}`}>Review&nbsp;→</Link>
              <Link
                className="btn ghost"
                href={{ pathname: "/arc", query: { new: "1", prompt: promptForOpportunity(focal) } }}
              >
                Draft with Arc
              </Link>
            </div>
          </div>
        )}

        <div className="sech">
          <h3>{WORK_STATE_LABEL.needs_you}</h3>
          <span className="ct">{approvalCount}</span>
        </div>
        <div className="rule" />
        {approvals.length === 0 ? (
          <p className="empty-note">Nothing needs your approval right now. Arc puts drafts here as it finishes them.</p>
        ) : (
          approvals.map((a) => {
            const tone = pillTone(a);
            return (
              <Link key={a.id} href={a.campaign.id ? `/campaigns/${a.campaign.id}` : "/campaigns"} className="task">
                <span className={`pill ${tone}`}>{PILL_LABEL[tone]}</span>
                <span className="tt">{a.title}</span>
                <span className="meta">
                  {humanizePersona(a.persona) && <span className="chip">{humanizePersona(a.persona)}</span>}
                  <span className="ago">{relativeTime(a.submittedAt)}</span>
                </span>
              </Link>
            );
          })
        )}
        {approvalCount > approvals.length ? (
          <Link className="more queue-more" href="/campaigns">
            View all {approvalCount} →
          </Link>
        ) : null}

        <KpiStrip
          items={metrics.map((m) => ({
            label: m.label,
            value: m.value,
            delta: { label: m.deltaLabel, dir: m.dir },
            // The window was only ever a hover title, so the delta read as a
            // number with no baseline (BSR-659).
            sublabel: `vs previous 30 days`,
            spark: { points: overview.trend[KPI_TREND[m.label]]?.cur ?? [], up: m.dir === "up" },
          }))}
        />

        <div className="sech">
          <h3>Open opportunities</h3>
          <Link className="more" href="/opportunities">All opportunities →</Link>
        </div>
        {opps.length === 0 ? (
          <p className="empty-note">No open opportunities yet. Arc watches for signs of interest and lists the ones it can back up with evidence.</p>
        ) : (
          <div className="opps">
            {opps.map((o) => (
              <Link key={o.id} href={`/opportunities?selected=${encodeURIComponent(o.id)}`} className="opp">
                <div className="ot">{o.title}</div>
                <div className="od">{concise(o.summary, 160)}</div>
                <div className="miniconf">
                  <b style={{ width: `${o.confidence}%` }} />
                </div>
                <div className="orow">
                  <span className="otype">{o.recommended_action || "Opportunity"}</span>
                  <span className="oconf">{o.confidence}% confidence</span>
                </div>
                <div className="oact">
                  <span className="oaud">{humanizePersona(o.evidence?.persona ?? "")}</span>
                  <span className="odraft">Draft with Arc →</span>
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="sech">
          <h3>Active campaigns</h3>
          <Link className="more" href="/campaigns">All campaigns →</Link>
        </div>
        {campaigns.length === 0 ? (
          <p className="empty-note">No campaigns yet. Arc drafts them here as opportunities come in — nothing sends until you approve it.</p>
        ) : (
          <div className="ctable">
            <div className="ch">
              <span>Campaign</span>
              <span>Persona</span>
              <span>Status</span>
            </div>
            {campaigns.map((camp) => (
              <Link key={camp.id} href={`/campaigns/${camp.id}`} className="cr">
                <div>
                  <div className="cn">{camp.name}</div>
                  {camp.pendingCount > 0 && <div className="csub">{countOf(camp.pendingCount, ASSET_NOUN)} to approve</div>}
                </div>
                <span>{humanizePersona(camp.persona)}</span>
                <span className="cn" style={{ fontWeight: 500 }}>{WORK_STATE_LABEL[toWorkState(camp.status)]}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <aside className="col-r">
        <h3 className="rh">Signals</h3>
        <div className="rsub">Source-backed, watched by Arc</div>
        <div>
          {signals.length === 0 ? (
            <p className="empty-note">No signals yet. Arc lists the ones it can back up with evidence here.</p>
          ) : (
            signals.map((s) => (
              <Link className="sig" href={`/opportunities?selected=${encodeURIComponent(s.id)}`} key={s.id}>
                <div className="st">{s.title}</div>
                <div className="sm">
                  <span className="src">{s.source}</span>
                  <span className="sa">{s.time}</span>
                </div>
              </Link>
            ))
          )}
        </div>

        <div className="rsec">
          <h3 className="rh">Arc activity</h3>
          <div className="rsub">What Arc has been doing</div>
          <div>
            {activityItems.length === 0 ? (
              <p className="empty-note">No recent activity yet.</p>
            ) : (
              activityItems.map((a, i) => (
                <div className="act" key={i}>
                  <span className="at">{a.at}</span>
                  <span className="ad">
                    <b>{a.actor}</b> {a.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rsec">
          <h3 className="rh">Quick actions</h3>
          <div className="rsub">Start something with Arc</div>
          <QuickActions />
        </div>
      </aside>
    </div>
  );
}

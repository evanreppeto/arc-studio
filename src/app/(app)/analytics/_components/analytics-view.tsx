"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatRate } from "@/domain";
import { ANALYTICS_WINDOWS } from "@/lib/analytics/overview";
import type { AnalyticsOverview, AnalyticsWindow, TrendKey, TrendSeries } from "@/lib/analytics/overview";
import type { OpportunityConversionReadModel } from "@/lib/performance/opportunity-conversion";
import type { CampaignPerformanceRow, ChannelPerformance, PerformanceAnomaly, PerformanceNextMove } from "@/lib/performance/read-model";
import { KpiStrip } from "../../_components/kpi-strip";

export type ActivityRowVM = { id: string; dot: string; title: string; detail: string; meta: string[]; time: string };
export type ActivityDayVM = { label: string; rows: ActivityRowVM[] };

type View = "overview" | "personas" | "channels" | "activity";

const METRICS: { key: TrendKey; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "leads", label: "Leads" },
  { key: "bookings", label: "Bookings" },
];

function fmtRevenue(cents: number): string {
  const d = Math.round(cents / 100);
  return d >= 1000 ? `$${Math.round(d / 1000)}k` : `$${d}`;
}
function axisValue(metric: TrendKey, v: number): string {
  return metric === "revenue" ? fmtRevenue(v) : String(Math.round(v));
}

// Centered moving average — smooths lumpy daily counts into a readable trend line.
function smoothed(arr: number[], w = 5): number[] {
  const half = Math.floor(w / 2);
  return arr.map((_, i) => {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) { sum += arr[j]; count++; }
    return count ? sum / count : 0;
  });
}
// Catmull-Rom → cubic-bezier so the line curves through the points.
function curve(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function TrendChart({ metric, series, labels }: { metric: TrendKey; series: TrendSeries; labels: string[] }) {
  const W = 720, H = 216, padL = 46, padR = 14, padT = 12, padB = 24;
  const n = series.cur.length;
  if (n < 2) return null;
  const cur = smoothed(series.cur);
  const prev = smoothed(series.prev);
  const max = Math.max(1, ...cur, ...prev);
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const pts = (arr: number[]): [number, number][] => arr.map((v, i) => [x(i), y(v)]);
  const curPath = curve(pts(cur));
  const area = `${curPath} L${x(n - 1).toFixed(1)},${H - padB} L${x(0).toFixed(1)},${H - padB} Z`;
  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  // Label roughly every 6th day so the axis isn't crowded.
  const tickEvery = Math.ceil(n / 5);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${metric} trend, last ${n} days vs previous period`}>
      <defs>
        <linearGradient id="trendfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridLines.map((g) => {
        const gy = padT + g * (H - padT - padB);
        const val = max * (1 - g);
        return (
          <g key={g}>
            <line className="grid" x1={padL} y1={gy} x2={W - padR} y2={gy} />
            <text className="axis" x={padL - 8} y={gy + 3} textAnchor="end">{axisValue(metric, val)}</text>
          </g>
        );
      })}
      {labels.map((lab, i) =>
        i % tickEvery === 0 || i === n - 1 ? (
          <text key={i} className="axis" x={x(i)} y={H - 8} textAnchor="middle">{lab}</text>
        ) : null,
      )}
      <path className="area" d={area} />
      <path className="prev" d={curve(pts(prev))} />
      <path className="cur" d={curPath} />
    </svg>
  );
}

function Breakdown({ rows }: { rows: AnalyticsOverview["revenueByPersona"] }) {
  if (rows.length === 0) return <div className="psub">No data in this window yet.</div>;
  return (
    <div className="bd">
      {rows.map((b) => (
        <div className="bdrow" key={b.label}>
          <span className="bn"><span className="dot" style={{ background: b.dot }} />{b.label}</span>
          <span className="bb"><i style={{ width: `${b.width}%`, background: b.dot }} /></span>
          <span className="bv">{b.valueLabel ?? b.count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

const USD0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function CampaignTable({ rows }: { rows: CampaignPerformanceRow[] }) {
  if (rows.length === 0) return null;
  const trendMark = (t: CampaignPerformanceRow["trend"]) => (t === "up" ? "▲" : t === "down" ? "▼" : "—");
  return (
    <div className="blk camps" style={{ marginTop: 20 }}>
      <h2>
        Campaign performance
        <span className="camphint">Open a campaign for its full performance breakdown</span>
      </h2>
      <div className="ctbl">
        <div className="cthead">
          <span>Campaign</span><span>Leads</span><span>Booked</span><span>Revenue</span><span>Converted</span><span>Trend</span>
        </div>
        {rows.map((c) => (
          <Link className="ctrow" key={c.id} href={`/campaigns/${encodeURIComponent(c.id)}`}>
            <span className="ctname">
              <b>{c.name}</b>
              <i>{c.persona}</i>
            </span>
            <span className="ctnum">{c.leads.toLocaleString()}</span>
            <span className="ctnum">{c.booked.toLocaleString()}</span>
            <span className="ctnum">{USD0.format(c.revenueCents / 100)}</span>
            <span className="ctnum">{c.conversion}%</span>
            <span className={`cttrend ${c.trend}`}>{trendMark(c.trend)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function roasLabel(revenueCents: number, spendCents: number): string {
  if (spendCents <= 0) return "organic";
  return `${(revenueCents / spendCents).toFixed(1)}×`;
}

function ChannelTable({ rows }: { rows: ChannelPerformance[] }) {
  if (rows.length === 0) {
    return <div className="psub">Channel performance fills in once campaigns send and CRM outcomes attribute back to a source.</div>;
  }
  const revMax = Math.max(1, ...rows.map((r) => r.revenueCents));
  return (
    <div className="chtbl">
      <div className="chhead">
        <span>Channel</span><span>Leads</span><span>Booked</span><span>Revenue</span><span>Spend</span><span>ROAS</span>
      </div>
      {rows.map((c) => (
        <div className="chrow" key={c.channel}>
          <span className="chname">
            {c.channel}
            <i className="chbar" style={{ width: `${Math.round((c.revenueCents / revMax) * 100)}%` }} />
          </span>
          <span className="chnum">{c.leads.toLocaleString()}</span>
          <span className="chnum">{c.booked.toLocaleString()}</span>
          <span className="chnum">{USD0.format(c.revenueCents / 100)}</span>
          <span className="chnum chspend">{c.spendCents > 0 ? USD0.format(c.spendCents / 100) : "—"}</span>
          <span className={`chroas ${c.spendCents > 0 ? "" : "organic"}`}>{roasLabel(c.revenueCents, c.spendCents)}</span>
        </div>
      ))}
    </div>
  );
}

function SignalsBlock({ anomalies, nextMoves }: { anomalies: PerformanceAnomaly[]; nextMoves: PerformanceNextMove[] }) {
  if (anomalies.length === 0 && nextMoves.length === 0) return null;
  return (
    <div className="grid2" style={{ marginTop: 20 }}>
      <div className="blk">
        <h2>Arc is watching <span className="tg wired">signals</span></h2>
        <div className="signals">
          {anomalies.map((a) => (
            <div className="sig" key={a.id}>
              <span className={`sdot ${a.tone}`} />
              <div style={{ minWidth: 0 }}>
                <div className="stitle">{a.title}{a.metric && <span className="smetric">{a.metric}</span>}</div>
                <div className="sdetail">{a.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="blk">
        <h2>Recommended next moves <span className="tg sync">Drafted by Arc · needs your approval</span></h2>
        <div className="moves">
          {nextMoves.map((m) => (
            <Link className="move" key={m.id} href={m.href}>
              <div className="mtitle">{m.title}</div>
              <div className="mdetail">{m.detail}</div>
              <span className="mcta">{m.cta} →</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

const mono: React.CSSProperties = { fontFamily: "var(--mono)", color: "var(--muted)" };

// "What converts" — the learning half of the loop: which opportunity kinds turn
// into approved, booked campaigns. Read-only; advisory only. Honest empty states.
function WhatConverts({ model }: { model: OpportunityConversionReadModel }) {
  if (model.status !== "live") {
    return (
      <div className="blk" style={{ marginTop: 18 }}>
        <h2>What converts <span className="tg wired">opportunity → booked</span></h2>
        <div className="psub">
          {model.status === "unavailable"
            ? "Nothing to show yet. This fills in once opportunities start turning into booked work."
            : "Not enough data yet — Arc learns which opportunity types convert as campaigns get approved and book work."}
        </div>
      </div>
    );
  }
  const { overall, byKind } = model.conversion;
  const max = Math.max(1, overall.surfaced);
  const stages: [string, number][] = [
    ["Surfaced", overall.surfaced],
    ["Drafted", overall.drafted],
    ["Approved", overall.approved],
    ["Booked", overall.booked],
  ];
  return (
    <div className="blk" style={{ marginTop: 18 }}>
      <h2>What converts <span className="tg wired">opportunity → booked · {model.windowDays}d</span></h2>
      <div className="funnel">
        {stages.map(([label, count]) => (
          <div className="fstage" key={label}>
            <span className="fl">{label}</span>
            <span className="ftrack"><i style={{ width: `${Math.round((count / max) * 100)}%` }} /></span>
            <span className="fv"><b>{count.toLocaleString()}</b></span>
          </div>
        ))}
      </div>
      {byKind.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="psub" style={{ marginBottom: 8 }}>By opportunity kind · booked rate</div>
          <div style={{ display: "grid", gap: 7 }}>
            {byKind.map((r) => (
              <div
                key={r.key}
                style={{ display: "grid", gridTemplateColumns: "minmax(110px, 1.4fr) repeat(4, 1fr) 58px", alignItems: "center", gap: 8, fontSize: 12 }}
              >
                <span style={{ color: "var(--text)", fontWeight: 600 }}>{r.label}</span>
                <span style={mono}>{r.funnel.surfaced} surf</span>
                <span style={mono}>{r.funnel.drafted} draft</span>
                <span style={mono}>{r.funnel.approved} appr</span>
                <span style={{ ...mono, color: "var(--text-2)" }}>{r.funnel.booked} book</span>
                <span style={{ color: "var(--accent-contrast)", fontWeight: 700, textAlign: "right" }}>
                  {formatRate(r.funnel.rates.bookedOfSurfaced)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ ...mono, fontSize: 9, marginTop: 12, lineHeight: 1.5 }}>
        Surfaced → drafted → approved → booked, from real opportunities and outcomes. Advisory only — not an automated decision.
      </div>
    </div>
  );
}

export function AnalyticsView({
  loadErrors = [],
  overview,
  range,
  conversion,
  activitySummary,
  activityDays,
  campaignRows,
  channels,
  anomalies,
  nextMoves,
}: {
  /**
   * Reads that FAILED, as opposed to returning nothing. Empty means every read
   * succeeded — an empty section below is then genuinely an empty workspace,
   * which is the distinction this prop exists to preserve.
   */
  loadErrors?: string[];
  overview: AnalyticsOverview;
  range: AnalyticsWindow;
  conversion: OpportunityConversionReadModel;
  activitySummary: { label: string; value: number }[];
  activityDays: ActivityDayVM[];
  campaignRows: CampaignPerformanceRow[];
  channels: ChannelPerformance[];
  anomalies: PerformanceAnomaly[];
  nextMoves: PerformanceNextMove[];
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("overview");
  const [metric, setMetric] = useState<TrendKey>("revenue");
  const [rangeOpen, setRangeOpen] = useState(false);
  // The range drives a server recompute via ?range=N; soft navigation keeps the
  // active tab + metric (client state) in place while new overview data streams in.
  const selectRange = (n: AnalyticsWindow) => {
    setRangeOpen(false);
    if (n !== range) router.push(`/analytics?range=${n}`, { scroll: false });
  };

  return (
    <div className="arc-analytics">
      {/* A failed read is NOT an empty workspace. Without this, a broken query
          renders as "No data in this window yet" — indistinguishable from a real
          workspace with nothing in it, which is exactly how a live outage hid on
          /campaigns (BSR-542). Sits above the tabs because the failure may be in
          a section the operator isn't currently looking at. */}
      {loadErrors.length > 0 && (
        <div className="crm-error" role="alert" style={{ marginBottom: 16 }}>
          <span>
            <b>Some analytics couldn&rsquo;t load.</b> Sections below may look empty because a query failed, not
            because you have no data. Reload, and if it persists check your workspace access.
            <div style={{ marginTop: 6, opacity: 0.75, fontFamily: "var(--mono, monospace)", fontSize: "0.85em" }}>
              {loadErrors.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          </span>
        </div>
      )}
      <div className="ctrlbar">
        <div className="vtabs">
          {([["overview", "Overview"], ["personas", "Personas"], ["channels", "Channels"], ["activity", "Activity"]] as [View, string][]).map(([k, label]) => (
            <button type="button" key={k} className={`vtab${view === k ? " on" : ""}`} onClick={() => setView(k)}>{label}</button>
          ))}
        </div>
        <span className="cspacer" />
        {view === "overview" && (
          <div className="rangectl">
            <button type="button" className="ctl" onClick={() => setRangeOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={rangeOpen}>
              <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></svg>
              Last {range} days <span className="cv">▾</span>
            </button>
            {rangeOpen && (
              <>
                <button type="button" className="ctl-backdrop" aria-hidden onClick={() => setRangeOpen(false)} tabIndex={-1} />
                <div className="ctl-menu" role="listbox" aria-label="Date range">
                  {ANALYTICS_WINDOWS.map((n) => (
                    <button
                      type="button"
                      key={n}
                      role="option"
                      aria-selected={n === range}
                      className={`ctl-opt${n === range ? " on" : ""}`}
                      onClick={() => selectRange(n)}
                    >
                      Last {n} days
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="body">
        <div className="inner">
          {view === "overview" && (
            <>
              <div className="vhead">
                <div>
                  <h2 className="pt">Performance overview</h2>
                  <div className="psub">
                    {overview.dataError
                      ? `Last ${range} days`
                      : `Last ${range} days · compared with the previous ${range} days`}
                  </div>
                </div>
              </div>

              {/* A failed CRM read is NOT an empty workspace. Without this the page
                  renders $0 / 0 leads / flat under "straight from CRM", which reads
                  exactly like a real workspace that has no data yet. */}
              {overview.dataError && (
                <div className="crm-error" role="alert" style={{ marginBottom: 16 }}>
                  <span>
                    <b>These numbers aren&rsquo;t your data.</b> {overview.dataError} The figures below are
                    placeholders, not zeros from your CRM — reload, and if it persists check your workspace
                    access.
                  </span>
                </div>
              )}

              <KpiStrip
                items={overview.kpis.map((k) => ({
                  label: k.label,
                  // An empty metric carries no value and no delta; its prevLabel
                  // is the sentence saying what to do about that.
                  value: k.value === "—" ? "" : k.value,
                  delta: { label: k.deltaLabel, dir: k.dir },
                  sublabel: k.value === "—" ? undefined : k.prevLabel,
                  emptyHint: k.value === "—" ? k.prevLabel : undefined,
                }))}
              />

              <div className="panel">
                <div className="ph">
                  <h2>Trend</h2>
                  <div className="seg">
                    {METRICS.map((m) => (
                      <button type="button" key={m.key} className={metric === m.key ? "on" : ""} onClick={() => setMetric(m.key)}>{m.label}</button>
                    ))}
                  </div>
                  <div className="legend">
                    <span><i className="cur" />This period</span>
                    <span><i className="prev" />Previous</span>
                  </div>
                </div>
                <div className="chart" key={metric}>
                  {overview.hasHistory ? (
                    <TrendChart metric={metric} series={overview.trend[metric]} labels={overview.trendLabels} />
                  ) : (
                    <div className="psub" style={{ padding: "40px 0", textAlign: "center" }}>Trend builds as leads, jobs, and outcomes accrue.</div>
                  )}
                </div>
              </div>

              <div className="grid2">
                <div className="col">
                  <div className="blk">
                    <h2>Funnel</h2>
                    <div className="funnel">
                      {overview.funnel.map((s) => (
                        <div className="fstage" key={s.label}>
                          <span className="fl">{s.label}</span>
                          <span className="ftrack"><i style={{ width: `${s.width}%` }} /></span>
                          <span className="fv"><b>{s.count.toLocaleString()}</b> {s.note && <span>{s.note}</span>}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="blk">
                    <h2>Revenue by persona</h2>
                    <Breakdown rows={overview.revenueByPersona} />
                  </div>
                  <div className="blk">
                    <h2>Leads by source</h2>
                    <Breakdown rows={overview.leadsBySource} />
                  </div>
                </div>

                <div className="airead">
                  <div className="al"><span className="am">A</span><span className="at">Arc&apos;s read</span></div>
                  <p>{overview.arcRead.text}</p>
                  {overview.arcRead.cites.length > 0 && (
                    <div className="cited">{overview.arcRead.cites.map((c) => <span className="cit" key={c}>{c}</span>)}</div>
                  )}
                  {overview.arcRead.rec && (
                    <div className="recbox">
                      <div className="rl">What to try next · Arc&rsquo;s estimate</div>
                      <div className="rt">{overview.arcRead.rec}</div>
                    </div>
                  )}
                  <div className="abtns">
                    <button type="button" className="gbtn gold" data-soon="Drafting the next round is coming soon"><svg viewBox="0 0 24 24"><path d="M4 5h16v6H4z" /><path d="M4 15h10v4H4z" /></svg>Draft it</button>
                    <Link className="gbtn" href="/arc"><svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 01-11.5 7.2L4 21l1.8-5.5A8 8 0 1121 12z" /></svg>Ask Arc</Link>
                  </div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--muted)", marginTop: 11, lineHeight: 1.5 }}>
                    Numbers from real leads / jobs / outcomes. The recommendation is Arc&apos;s interpretation — not an automated decision.
                  </div>
                </div>
              </div>

              <WhatConverts model={conversion} />

              <CampaignTable rows={campaignRows} />

              <SignalsBlock anomalies={anomalies} nextMoves={nextMoves} />
            </>
          )}

          {view === "personas" && (
            <>
              <div className="vhead"><div><h2 className="pt">By persona</h2><div className="psub">Revenue per persona this period</div></div></div>
              <div className="blk"><h2>Revenue by persona</h2><Breakdown rows={overview.revenueByPersona} /></div>
            </>
          )}

          {view === "channels" && (
            <>
              <div className="vhead"><div><h2 className="pt">By channel</h2><div className="psub">Leads, booked work, revenue, spend, and ROAS per channel · attributed from CRM outcomes</div></div></div>
              <div className="blk"><h2>Channel performance</h2><ChannelTable rows={channels} /></div>
              <div className="blk" style={{ marginTop: 18 }}><h2>Leads by source</h2><Breakdown rows={overview.leadsBySource} /></div>
            </>
          )}

          {view === "activity" && (
            <>
              <div className="vhead"><div><h2 className="pt">Activity</h2><div className="psub">The full audit trail — every Arc action, approval, and signal, merged from your workspace.</div></div></div>
              <KpiStrip items={activitySummary.map((s) => ({ label: s.label, value: String(s.value) }))} />
              {activityDays.length === 0 ? (
                <div className="blk"><div className="psub">No activity recorded yet. Arc logs its actions here as it works.</div></div>
              ) : (
                activityDays.map((day) => (
                  <div key={day.label}>
                    <div className="aday">{day.label}</div>
                    {day.rows.map((r) => (
                      <div className="arow" key={r.id}>
                        <span className="adot" style={{ background: r.dot }} />
                        <div style={{ minWidth: 0 }}>
                          <div className="atitle">{r.title}</div>
                          {r.detail && <div className="adetail">{r.detail}</div>}
                          {r.meta.length > 0 && <div className="ameta">{r.meta.map((m, i) => <span className="achip" key={i}>{m}</span>)}</div>}
                        </div>
                        <span className="atime">{r.time}</span>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

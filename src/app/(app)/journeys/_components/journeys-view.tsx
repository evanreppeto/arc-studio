"use client";

import { useMemo, useState, useTransition } from "react";

import {
  ATTRIBUTION_MODELS,
  JOURNEY_CONSENT_MODE_META,
  JOURNEY_STAGES,
  classifyTouchStage,
  stageOrder,
  type AttributionModel,
  type JourneyConsentMode,
  type JourneyStageKey,
  type JourneyTouch,
} from "@/domain";
import type { JourneyWithMeta, JourneysReadModel } from "@/lib/journey/read-model";

import { setJourneyConsentMode } from "../actions";

// Compact labels for the lens picker — the 320px side panel can't fit the full
// names. The full label + blurb ride along in each button's title.
const LENS_SHORT: Record<AttributionModel, string> = {
  last_touch: "Last",
  first_touch: "First",
  linear: "Linear",
  time_decay: "Decay",
  position_based: "40/20/40",
};

// Stage → tone token (see the .journeys CSS block). Two anonymous stages read
// blue; the known-side stages escalate gold → amber → green, with retention its
// own violet so repeat/expansion is visually distinct from a first conversion.
const STAGE_TONE: Record<JourneyStageKey, string> = {
  reached: "blue",
  engaged: "blue",
  identified: "gold",
  nurtured: "amber",
  converted: "green",
  retained: "vio",
};

// Nicer labels for the touch kinds the read-model emits; anything else is titleized.
const KIND_LABEL: Record<string, string> = {
  ad_impression: "Saw an ad",
  email_sent: "Email sent",
  sms_sent: "SMS sent",
  ad_click: "Clicked ad",
  email_open: "Opened email",
  email_click: "Clicked email",
  site_visit: "Visited site",
  reply_received: "Replied",
  inbound_call: "Inbound call",
  form_submit: "Submitted form",
  lead_created: "Became a lead",
  signup: "Signed up",
  lead_routed: "Routed",
  lead_contacted: "Contacted",
  quote_sent: "Quote sent",
  booking: "Booked",
  job_opened: "Job opened",
  job_completed: "Job completed",
  purchase: "Purchase",
  payment: "Paid",
  subscribe: "Subscribed",
  download: "Downloaded",
  outcome_won: "Won / paid",
  referral: "Referral",
};

const USD0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function money(cents: number): string {
  const d = Math.round(cents / 100);
  if (Math.abs(d) >= 10000) return `$${Math.round(d / 1000)}k`;
  return USD0.format(d);
}
function dateShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
}
function titleize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? titleize(kind);
}
function dirGlyph(direction: JourneyTouch["direction"]): string {
  return direction === "outbound" ? "↑" : direction === "inbound" ? "↓" : "•";
}
function stageLabel(key: JourneyStageKey): string {
  return JOURNEY_STAGES.find((s) => s.key === key)?.label ?? key;
}

/** Six-dot progress track, filled up to the journey's current stage. */
function StageTrack({ current }: { current: JourneyStageKey }) {
  const top = stageOrder(current);
  return (
    <span className="jr-track" aria-label={`Stage: ${stageLabel(current)}`}>
      {JOURNEY_STAGES.map((s) => {
        const on = stageOrder(s.key) <= top;
        return <i key={s.key} className={`jr-dot${on ? ` on t-${STAGE_TONE[s.key]}` : ""}`} title={s.label} />;
      })}
    </span>
  );
}

function Timeline({ touches }: { touches: JourneyTouch[] }) {
  if (touches.length === 0) return <div className="jr-sub">No touches recorded.</div>;
  return (
    <ol className="jr-tl">
      {touches.map((t) => {
        const stage = classifyTouchStage(t);
        return (
          <li key={t.id} className="jr-tlrow">
            <span className={`jr-tldot t-${STAGE_TONE[stage]}`} />
            <span className="jr-tlmain">
              <span className="jr-tlkind">
                <b>{kindLabel(t.kind)}</b>
                <span className="jr-dir" aria-hidden>
                  {dirGlyph(t.direction)}
                </span>
                {t.channel && <span className="jr-chip">{titleize(t.channel)}</span>}
                {t.isConversion && t.valueCents ? <span className="jr-chip win">{money(t.valueCents)}</span> : null}
              </span>
              {t.summary && <span className="jr-tlsum">{t.summary}</span>}
            </span>
            <span className="jr-tltime">{dateShort(t.occurredAt)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function JourneyRow({ journey }: { journey: JourneyWithMeta }) {
  const [open, setOpen] = useState(false);
  const tone = STAGE_TONE[journey.currentStage];
  const spanLabel =
    journey.firstTouchAt && journey.lastTouchAt
      ? `${dateShort(journey.firstTouchAt)} → ${dateShort(journey.lastTouchAt)}`
      : dateShort(journey.lastTouchAt);
  return (
    <div className={`jr-row${open ? " open" : ""}`}>
      <button type="button" className="jr-rowhead" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="jr-who">
          <b>{journey.identity.label}</b>
          {journey.persona && <span className="jr-persona">{titleize(journey.persona)}</span>}
          {journey.identity.resolution !== "known" && <span className={`jr-res ${journey.identity.resolution}`}>{journey.identity.resolution}</span>}
        </span>
        <StageTrack current={journey.currentStage} />
        <span className={`jr-pill t-${tone}`}>{stageLabel(journey.currentStage)}</span>
        <span className="jr-span">{spanLabel}</span>
        <span className="jr-val">
          {journey.converted ? money(journey.conversionValueCents) : <span className="jr-muted">in flight</span>}
        </span>
        <span className={`jr-caret${open ? " up" : ""}`} aria-hidden>
          ⌄
        </span>
      </button>
      {open && (
        <div className="jr-detail">
          <div className="jr-detailmeta">
            {journey.firstTouch?.channel && (
              <span>
                First touch <b>{titleize(journey.firstTouch.channel)}</b>
              </span>
            )}
            {journey.lastTouch?.channel && (
              <span>
                Last touch <b>{titleize(journey.lastTouch.channel)}</b>
              </span>
            )}
            {journey.daysToConvert !== null && (
              <span>
                Converted in <b>{journey.daysToConvert}d</b>
              </span>
            )}
            <span>
              <b>{journey.touchCount}</b> touches
            </span>
          </div>
          <Timeline touches={journey.timeline} />
        </div>
      )}
    </div>
  );
}

export function JourneysView({
  loadError = null,
  model,
  origin = "",
  consentMode = "implied",
}: {
  /** Why the read FAILED, vs returning nothing. Null when it succeeded. */
  loadError?: string | null;
  model: JourneysReadModel;
  origin?: string;
  consentMode?: JourneyConsentMode;
}) {
  const [stageFilter, setStageFilter] = useState<JourneyStageKey | "all">("all");
  const [lens, setLens] = useState<AttributionModel>("last_touch");

  const filtered = useMemo(() => {
    const list = model.status === "live" ? model.journeys : [];
    return stageFilter === "all" ? list : list.filter((j) => j.currentStage === stageFilter);
  }, [model, stageFilter]);

  if (model.status !== "live") {
    return (
      <div className="journeys">
        <header className="jr-head">
          <div>
            <h2>Customer Journeys</h2>
            <p className="jr-lede">Every contact&rsquo;s path from first touch to conversion — one stitched timeline.</p>
          </div>
        </header>
        <div className="jr-empty">
          <div className="jr-emptymk">◔</div>
          <b>No journey data yet</b>
          <p>
            Journeys assemble automatically from sends, leads, and outcomes as Arc works — no setup needed. This workspace has none
            recorded yet.
          </p>
        </div>
      </div>
    );
  }

  const { funnel, kpis, channelCreditByModel, defaultModel, isDemo } = model;
  const topCount = funnel[0]?.count ?? 0;
  const channelCredit = channelCreditByModel[lens] ?? [];
  const creditTotal = channelCredit.reduce((s, c) => s + c.valueCents, 0);
  const activeLens = ATTRIBUTION_MODELS.find((m) => m.key === lens);
  // Credit under the default lens, to show how much each channel gains/loses
  // when you switch — the point of having lenses at all.
  const baseByChannel = new Map((channelCreditByModel[defaultModel] ?? []).map((c) => [c.channel, c.valueCents]));
  const defaultLabel = ATTRIBUTION_MODELS.find((m) => m.key === defaultModel)?.label ?? "last touch";
  // The list is capped server-side (MAX_JOURNEYS) while the KPI tile shows the true
  // total; restate the cap on the list so 60 rows beside a larger total doesn't read
  // as "all of them" (and so the stage filter isn't mistaken for the whole book).
  const loadedCount = model.journeys.length;
  const capped = kpis.total > loadedCount;

  return (
    <div className="journeys">
      {/* A failed read is NOT an empty result. Rendering them the same is how a
          live outage hid behind a normal-looking page (BSR-542). */}
      {loadError && (
        <div className="crm-error" role="alert" style={{ marginBottom: 16 }}>
          <span>
            <b>Couldn&rsquo;t load journey data.</b> What&rsquo;s missing below is a failed query, not an absence of activity.
            <div style={{ marginTop: 6, opacity: 0.75, fontFamily: "var(--mono, monospace)", fontSize: "0.85em" }}>{loadError}</div>
          </span>
        </div>
      )}
      <header className="jr-head">
        <div>
          <h2>
            Customer Journeys
            {isDemo ? <span className="jr-tag demo">demo data</span> : null}
          </h2>
          <p className="jr-lede">Every contact&rsquo;s path from first touch to conversion — one stitched timeline.</p>
        </div>
        <div className="jr-model" title="Attribution lens applied to channel credit">
          <span className="jr-modellab">Credit</span>
          <span className="jr-modelval">{activeLens?.label ?? defaultLabel}</span>
        </div>
      </header>

      <div className="jr-kpis">
        <Kpi label="Journeys" value={String(kpis.total)} hint="contacts with a path" />
        <Kpi label="In flight" value={String(kpis.inFlight)} hint="identified, not yet converted" tone="amber" />
        <Kpi label="Converted" value={String(kpis.converted)} hint={`${Math.round(kpis.conversionRate * 100)}% of identified`} tone="green" />
        <Kpi label="Realized" value={money(kpis.realizedCents)} hint="from converted journeys" tone="green" />
        <Kpi label="Avg. time to convert" value={kpis.avgDaysToConvert !== null ? `${kpis.avgDaysToConvert}d` : "—"} hint="first touch → paid" />
      </div>

      <section className="jr-panel jr-funnelpanel">
        <h2>
          The journey funnel
          <span className="jr-sub2">how many contacts reach each stage</span>
        </h2>
        <div className="jr-funnel">
          {funnel.map((f, i) => {
            const meta = JOURNEY_STAGES[i];
            const width = topCount > 0 ? Math.max(2, Math.round((f.count / topCount) * 100)) : 0;
            const active = stageFilter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                className={`jr-fstage${active ? " active" : ""}`}
                onClick={() => setStageFilter((cur) => (cur === f.key ? "all" : f.key))}
                title={meta?.meaning}
              >
                <span className="jr-flabel">
                  {f.label}
                  {meta?.anonymous && <span className="jr-anon" title="Anonymous / pre-identification stage — full capture arrives in P1">pre-lead</span>}
                </span>
                <span className="jr-fbar">
                  <i className={`t-${STAGE_TONE[f.key]}`} style={{ width: `${width}%` }} />
                </span>
                <span className="jr-fcount">{f.count}</span>
                <span className="jr-frate">{i === 0 ? "" : `${Math.round(f.rateFromPrev * 100)}%`}</span>
              </button>
            );
          })}
        </div>
        {stageFilter !== "all" && (
          <div className="jr-filternote">
            Showing <b>{stageLabel(stageFilter)}</b> journeys ·{" "}
            <button type="button" className="jr-clear" onClick={() => setStageFilter("all")}>
              clear
            </button>
          </div>
        )}
      </section>

      <div className="jr-grid">
        <section className="jr-panel jr-listpanel">
          <h2>
            Journeys
            <span className="jr-sub2">{filtered.length} shown · newest first · click to open the timeline</span>
          </h2>
          {capped && (
            <div className="jr-sub" style={{ marginBottom: 10 }}>
              Showing the {loadedCount} most recent of {kpis.total.toLocaleString()} journeys{stageFilter !== "all" ? " — the stage filter applies within these" : ""}.
            </div>
          )}
          <div className="jr-list">
            {filtered.length === 0 ? (
              <div className="jr-sub">No journeys in this stage.</div>
            ) : (
              filtered.map((j) => <JourneyRow key={j.identity.id} journey={j} />)
            )}
          </div>
        </section>

        <aside className="jr-side">
          <section className="jr-panel">
            <h2>
              Revenue by channel
              <span className="jr-sub2">credit across converted journeys</span>
            </h2>
            <div className="jr-lens" role="group" aria-label="Attribution model">
              {ATTRIBUTION_MODELS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`jr-lensbtn${lens === m.key ? " on" : ""}`}
                  onClick={() => setLens(m.key)}
                  aria-pressed={lens === m.key}
                  title={`${m.label} — ${m.blurb}`}
                >
                  {LENS_SHORT[m.key]}
                </button>
              ))}
            </div>
            <p className="jr-lensblurb">{activeLens?.blurb}</p>
            {channelCredit.length === 0 ? (
              // "No credit" and "no conversions" are different things, and conflating
              // them reads as broken: a workspace whose campaigns haven't sent yet has
              // real conversions but no attributable touch to credit them to.
              <div className="jr-sub">
                {kpis.converted === 0
                  ? "No converted journeys yet."
                  : `${kpis.converted} conversion${kpis.converted === 1 ? "" : "s"}, but none carry campaign attribution yet — credit appears once a journey includes a tagged campaign touch.`}
              </div>
            ) : (
              <div className="jr-bd">
                {channelCredit.map((c) => {
                  const delta = c.valueCents - (baseByChannel.get(c.channel) ?? 0);
                  const showDelta = lens !== defaultModel && Math.round(delta / 100) !== 0;
                  return (
                    <div className="jr-bdrow" key={c.channel}>
                      <span className="jr-bn">{titleize(c.channel)}</span>
                      <span className="jr-bb">
                        <i style={{ width: `${creditTotal > 0 ? Math.max(3, Math.round((c.valueCents / creditTotal) * 100)) : 0}%` }} />
                      </span>
                      <span className="jr-bv">
                        {money(c.valueCents)}
                        {showDelta && (
                          <em className={`jr-delta ${delta > 0 ? "up" : "down"}`}>
                            {delta > 0 ? "+" : "−"}
                            {money(Math.abs(delta))}
                          </em>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {lens !== defaultModel && <p className="jr-lensfoot">Change shown vs {defaultLabel.toLowerCase()}.</p>}
          </section>

          <section className="jr-panel jr-note">
            <h2>How this works</h2>
            <p>
              Each journey is stitched from touches Arc already records — sends, clicks, the identifying lead, and the won outcome —
              then placed on a six-stage ladder that fits any business.
            </p>
            <p className="jr-notenext">
              <b>Anonymous capture (P1):</b> a first-party collector records pre-lead <em>Reached</em> and <em>Engaged</em> touches
              against an anonymous id, then stitches that history onto the contact at identification — shown as an{" "}
              <em>anonymous</em> or <em>stitched</em> tag.
            </p>
          </section>

          <ConsentPanel mode={consentMode} />
          <CollectorInstall origin={origin} consentMode={consentMode} />
        </aside>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className={`jr-kpi${tone ? ` t-${tone}` : ""}`}>
      <span className="jr-klab">{label}</span>
      <span className="jr-kval">{value}</span>
      <span className="jr-khint">{hint}</span>
    </div>
  );
}

/**
 * Workspace consent mode. This is a real state transition — it changes what the
 * public collector records for every visitor — so it writes through an
 * operator-gated action. Optimistic with rollback on failure.
 */
function ConsentPanel({ mode }: { mode: JourneyConsentMode }) {
  const [current, setCurrent] = useState<JourneyConsentMode>(mode);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const active = JOURNEY_CONSENT_MODE_META.find((m) => m.key === current);

  const pick = (next: JourneyConsentMode) => {
    if (next === current || pending) return;
    const previous = current;
    setCurrent(next);
    setError(null);
    startTransition(async () => {
      const result = await setJourneyConsentMode(next);
      if (!result.ok) {
        setCurrent(previous);
        setError(result.message ?? "Could not save the consent mode.");
      }
    });
  };

  return (
    <section className="jr-panel jr-consent">
      <h2>
        Visitor consent
        <span className="jr-sub2">enforced server-side</span>
      </h2>
      <div className="jr-lens" role="group" aria-label="Consent mode">
        {JOURNEY_CONSENT_MODE_META.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`jr-lensbtn${current === m.key ? " on" : ""}`}
            onClick={() => pick(m.key)}
            aria-pressed={current === m.key}
            disabled={pending}
            title={m.blurb}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="jr-lensblurb">{active?.blurb}</p>
      <p className="jr-installnote">Global Privacy Control and per-visitor opt-outs are honored in every mode.</p>
      {error && <p className="jr-consenterr">{error}</p>}
    </section>
  );
}

/** Operator install panel: the one-line snippet to drop on a first-party landing page. */
function CollectorInstall({ origin, consentMode }: { origin: string; consentMode: JourneyConsentMode }) {
  const [copied, setCopied] = useState(false);
  // In explicit mode the tag must defer until the page's banner grants consent.
  const consentAttr = consentMode === "explicit" ? ' data-consent="required"' : "";
  const snippet = `<script src="${origin || "https://your-arc-domain"}/api/v1/journey/snippet.js"${consentAttr} defer></script>`;
  const copy = () => {
    navigator.clipboard
      ?.writeText(snippet)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  return (
    <section className="jr-panel jr-install">
      <h2>Connect your funnel</h2>
      <p className="jr-installlede">
        Add this to your landing pages. It records anonymous visits from campaign links and hands the visitor id to your lead form —
        so the journey stitches onto the contact automatically.
      </p>
      <div className="jr-code">
        <code>{snippet}</code>
        <button type="button" className="jr-copy" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="jr-installnote">
        {consentMode === "explicit" ? (
          <>
            Nothing is recorded until your banner calls <code>arcJourney.consent(true)</code>. Visitors can erase their history with{" "}
            <code>arcJourney.optOut()</code>.
          </>
        ) : consentMode === "off" ? (
          <>Collection is off for this workspace — the collector accepts beacons and discards them.</>
        ) : (
          <>
            Campaign links are already tagged at dispatch — arrivals light up <em>Reached / Engaged</em>, then stitch at identification.
          </>
        )}
      </p>
    </section>
  );
}

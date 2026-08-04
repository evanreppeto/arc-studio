/**
 * Pure detection of "opportunities" from CRM signals. No I/O. v1 source:
 * cold leads — open, unworked leads that have gone quiet — surfaced for human
 * review (never auto-contacted). Deterministic so it stays unit-testable.
 */

import { countOf, DAY_NOUN } from "./vocabulary";

export type ColdLeadInput = {
  id: string;
  /** Human label (contact/company name or lead id) for the card. */
  label: string;
  persona: string;
  leadScore: number; // 0–100
  status: string; // lead_status value
  /** ISO timestamp of the lead's most recent activity, else when it arrived. */
  lastActivityAt: string;
  /**
   * Whether `lastActivityAt` is a real recorded interaction, or the fallback to
   * the lead's arrival date because nothing has been logged against it.
   *
   * These are different facts and the card must not state the second as the
   * first. "No activity in 90 days" asserts that someone checked; "nothing
   * recorded since it arrived 90 days ago" is what we actually know.
   */
  activityKnown: boolean;
  hasActiveCampaign: boolean;
};

/** What a cold-lead card can be named after, best first. */
export type ColdLeadLabelParts = {
  id: string;
  contactName?: string | null;
  companyName?: string | null;
  lossSummary?: string | null;
};

const LABEL_MAX = 60;

/**
 * Name a cold-lead card.
 *
 * Order matters and is the whole point: an operator triaging the inbox needs to
 * know *who* has gone quiet. Prior code preferred lossSummary and fell back to
 * `Lead <uuid>` — and in production lossSummary was set on 1 of 64 cold leads
 * while a contact AND company name existed for all 64, so the inbox rendered 64
 * cards titled "Lead c1aa307a — quiet 32 days". Unreadable, and every one of them
 * had a real name a join away.
 *
 * The uuid fallback stays last: it is a genuine last resort, not a default.
 */
export function buildColdLeadLabel(parts: ColdLeadLabelParts): string {
  const clean = (v: string | null | undefined) => v?.trim() || "";
  const contact = clean(parts.contactName);
  const company = clean(parts.companyName);
  // Both when we have both: "Dana Whitfield (North Shore Property Group)" tells an
  // operator who to call and which account it belongs to in one line.
  const named = contact && company ? `${contact} (${company})` : contact || company;
  const label = named || clean(parts.lossSummary) || `Lead ${parts.id.slice(0, 8)}`;
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1).trimEnd()}…` : label;
}

export type DetectionConfig = { now: string; coldDays?: number };

export type OpportunityCandidate = {
  kind: string;            // was "crm_inactivity"
  subjectType: string;     // was "lead"
  subjectId: string;
  title: string;
  summary: string;
  confidence: number; // 0–100
  urgency: "low" | "medium" | "high";
  evidence: Record<string, unknown>;  // was the cold-lead-specific object
  recommendedAction: string;
  recommendedCampaignType: string;
};

/**
 * How long a dismissal suppresses re-detection of the same (kind, subject), and
 * how far either side of that the actual expiry is spread.
 *
 * A fixed cooldown synchronises the queue: clear 39 cards in one sitting and all
 * 39 become eligible again on the same day, so the flood the cooldown prevents
 * arrives a month later in one batch instead. The spread staggers them across a
 * ~4-week window while keeping the average at the base.
 */
export const DISMISS_COOLDOWN_DAYS = 30;
export const DISMISS_COOLDOWN_JITTER_DAYS = 7;

/** FNV-1a (32-bit). Small, dependency-free, and well-distributed over short keys. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    // 32-bit FNV prime multiply, via shifts to stay inside int32.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Days a dismissal of `(kind, subjectId)` suppresses re-detection: the base
 * offset by a deterministic per-subject amount in [-jitter, +jitter].
 *
 * Deterministic, not random: the same subject must resolve to the same expiry on
 * every scan, or a card's return date would wander and a row could re-appear
 * early simply by being re-evaluated. Derived from the subject rather than the
 * clock so it is stable across processes and testable without freezing time.
 */
export function dismissCooldownDays(
  kind: string,
  subjectId: string,
  base: number = DISMISS_COOLDOWN_DAYS,
  jitter: number = DISMISS_COOLDOWN_JITTER_DAYS,
): number {
  const spread = Math.max(0, Math.trunc(jitter));
  if (spread === 0) return base;
  // hash % (2*spread + 1) - spread  =>  an integer in [-spread, +spread].
  const offset = (hash32(`${kind}:${subjectId}`) % (spread * 2 + 1)) - spread;
  // Never let jitter push the cooldown to zero or negative — that would make a
  // dismissal instantly re-raisable, which is the bug the cooldown exists for.
  return Math.max(1, base + offset);
}

/**
 * Baseline confidence an opportunity needs to reach the inbox.
 *
 * Deliberately low: it is a safety net against a genuinely broken score, not
 * the noise filter. Every detector except cold-lead already emits 54+ at its
 * weakest (a weather *advisory* scores exactly 55), so a higher global bar
 * would silently delete an entire severity tier — Freezing Rain and Hard Freeze
 * advisories are advisories, and burst pipes are real work.
 */
export const DEFAULT_CONFIDENCE_FLOOR = 50;

/**
 * Per-kind floors, for detectors whose weakest output isn't worth an operator's
 * attention. Only `crm_inactivity` needs one: it scores essentially off lead
 * score, bottoms out at 47, and produces far more cards than every other kind
 * combined. Measured against the live inbox, 60 cuts its weak tail without
 * touching a single high-urgency card; 65 starts discarding legitimate medium
 * signals and 70 discards a high one.
 *
 * A floor filters by quality, never by volume — a workspace with 200 genuinely
 * strong signals still sees all 200.
 */
export const CONFIDENCE_FLOOR_BY_KIND: Readonly<Record<string, number>> = {
  crm_inactivity: 60,
};

/** The floor a given opportunity kind must clear. */
export function confidenceFloorForKind(kind: string, base: number = DEFAULT_CONFIDENCE_FLOOR): number {
  // Never let a per-kind entry sit BELOW the configured base — an operator who
  // raises the base expects it to apply everywhere.
  return Math.max(base, CONFIDENCE_FLOOR_BY_KIND[kind] ?? 0);
}

/**
 * Drop candidates scoring below their kind's floor. Applied once at the
 * persistence chokepoint so every producer — the deterministic detectors,
 * signal-source connectors, and Arc's own proposals — is held to the same bar.
 */
export function applyConfidenceFloor<T extends { confidence: number; kind?: string }>(
  candidates: readonly T[],
  base: number = DEFAULT_CONFIDENCE_FLOOR,
): T[] {
  // A non-finite or negative base would silently pass everything; treat it as
  // "no floor configured" rather than guessing.
  const safeBase = Number.isFinite(base) && base > 0 ? base : 0;
  return candidates.filter((c) => c.confidence >= confidenceFloorForKind(c.kind ?? "", safeBase));
}

const DEFAULT_COLD_DAYS = 30;
const TERMINAL_STATUSES = new Set(["converted", "lost", "archived"]);
const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Cold-lead opportunities: open leads with no live campaign, quiet >= coldDays. */
export function detectColdLeadOpportunities(leads: ColdLeadInput[], config: DetectionConfig): OpportunityCandidate[] {
  const coldDays = config.coldDays ?? DEFAULT_COLD_DAYS;
  const out: OpportunityCandidate[] = [];
  for (const lead of leads) {
    if (TERMINAL_STATUSES.has(lead.status)) continue;
    if (lead.hasActiveCampaign) continue;
    const daysCold = daysBetween(lead.lastActivityAt, config.now);
    if (daysCold < coldDays) continue;

    // Confidence: lead quality plus a cold bonus (longer quiet = more worth re-engaging).
    const confidence = clamp(Math.round(lead.leadScore + Math.min(20, daysCold / 7)), 0, 100);
    const urgency: OpportunityCandidate["urgency"] =
      lead.leadScore >= 75 && daysCold >= 45 ? "high" : lead.leadScore >= 50 || daysCold >= 60 ? "medium" : "low";

    out.push({
      kind: "crm_inactivity",
      subjectType: "lead",
      subjectId: lead.id,
      // PERSISTED. These two are written to the opportunity row, so they are
      // what the card shows and what Arc reads back — a count disagreeing with
      // its noun is stored, not just rendered (BSR-690).
      title: lead.activityKnown
        ? `${lead.label} — quiet ${countOf(daysCold, DAY_NOUN)}`
        : `${lead.label} — nothing recorded in ${countOf(daysCold, DAY_NOUN)}`,
      summary: lead.activityKnown
        ? `Open lead (score ${lead.leadScore}) with no live campaign and no activity in ${countOf(daysCold, DAY_NOUN)}.`
        : `Open lead (score ${lead.leadScore}) with no live campaign. Nothing has been recorded against it since it arrived ${countOf(daysCold, DAY_NOUN)} ago — that is not the same as knowing nobody has worked it.`,
      confidence,
      urgency,
      evidence: {
        daysCold,
        leadScore: lead.leadScore,
        persona: lead.persona,
        lastActivityAt: lead.lastActivityAt,
        activitySource: lead.activityKnown ? "recorded_activity" : "lead_arrival_date",
      },
      recommendedAction: "Re-engage with a persona-tailored campaign",
      recommendedCampaignType: "re_engagement",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Weather-event opportunities
// ---------------------------------------------------------------------------
// Storm/flood/hail alerts in a workspace's coverage area drive same-week
// emergency-restoration demand. Surfaced (never auto-contacted) as a geo-targeted
// storm-response recommendation. Deterministic so it stays unit-testable. The
// live alert feed is injected at the I/O layer (see WeatherEventSource in
// src/lib/opportunities/detector.ts) — this module only scores normalized input.

/** Normalized alert severity, ordered advisory < watch < warning < emergency. */
export type WeatherSeverity = "advisory" | "watch" | "warning" | "emergency";

export type WeatherEventInput = {
  id: string;
  /** Alert/event type label, e.g. "Flash Flood Warning", "Severe Thunderstorm". */
  eventType: string;
  /** Human coverage-area label for the card, e.g. "Riverside / Brookfield". */
  area: string;
  severity: WeatherSeverity;
  /** ISO effective window; an event whose endsAt is already past is skipped. */
  startsAt?: string;
  endsAt?: string;
  /** Coverage ZIPs, surfaced on the card and used for the geo-target note. */
  zipCodes?: string[];
  /** Evidence links (NWS alert page, radar, water.noaa.gov, …). */
  sourceUrls?: string[];
};

export type WeatherDetectionConfig = {
  now: string;
  /**
   * The audience a damage-response flight should target, from the WORKSPACE's own
   * persona taxonomy — supplied by the caller, never invented here.
   *
   * This used to be a hardcoded `persona_homeowner_emergency` ("BSR's
   * emergency-response persona"). Personas are per-org now, so for any other tenant
   * that was a dangling reference to a persona they don't have. A pure detector
   * cannot know who a workspace sells to; omitted is the honest answer, and the
   * opportunity carries the weather facts either way.
   */
  persona?: string | null;
  /**
   * Which weather this workspace wants surfaced. Omitted keeps the historical
   * behaviour (property damage only) rather than widening it silently.
   */
  categories?: readonly WeatherCategory[];
};

/**
 * Weather that puts property in play — the only kind this connector exists for.
 *
 * NWS also publishes Air Quality, Heat, Dense Fog, Rip Current and Beach Hazard
 * alerts. They are real, but nothing about them damages a building, and the
 * opportunity written below asserts that response demand spikes — so filing one is a
 * fabricated claim wearing genuine NWS evidence, which is the hardest kind to catch.
 * Two live Air Quality Alerts over Chicago are what surfaced this.
 *
 * Deliberately broad across the connector's verticals rather than "storms": a roofer
 * cares about hail and wind, a plumber about a hard freeze bursting pipes, a
 * restoration firm about fire and flood. Weather damages property regardless of who
 * gets called to fix it — which is the whole point of a tenant-agnostic connector.
 * Matched word-boundaried on the NWS event name, so "Ice Storm Warning" hits and
 * "Air Quality Alert" does not. `red flag` is spelled out because NWS's fire-weather
 * product is "Red Flag Warning" — the word "fire" appears nowhere in it.
 */
const PROPERTY_DAMAGE_EVENT =
  /\b(tornado|thunderstorm|hail|flood|flooding|wind|storm|squall|hurricane|typhoon|tropical|blizzard|ice|icy|freezing|freeze|snow|sleet|winter|cold|surge|tsunami|fire)\b|red flag/i;

/** True when an NWS event name describes weather that can damage property. */
export function isPropertyDamageWeather(eventType: string | null | undefined): boolean {
  return PROPERTY_DAMAGE_EVENT.test((eventType ?? "").trim());
}

// ---------------------------------------------------------------------------
// Weather categories (per-workspace opt-in)
// ---------------------------------------------------------------------------

/**
 * What kind of demand an alert drives — the axis a workspace actually cares about.
 *
 * `property_damage` was the only category the connector supported, which made the
 * rest of NWS's catalogue unreachable rather than merely filtered. That was right
 * for a roofer and wrong for an HVAC business: an Excessive Heat Warning drives
 * real, urgent cooling work and was being discarded as "no property in play".
 *
 * Categories are trades-agnostic on purpose. They describe the WEATHER and the
 * demand it creates, never who gets called — Arc cannot know a workspace's trade,
 * and the operator opting in is what supplies that knowledge.
 */
export type WeatherCategory = "property_damage" | "fire_weather" | "extreme_heat" | "air_quality" | "marine_coastal";

export const WEATHER_CATEGORIES: readonly WeatherCategory[] = [
  "property_damage",
  "fire_weather",
  "extreme_heat",
  "air_quality",
  "marine_coastal",
] as const;

/**
 * Only property_damage by default.
 *
 * A workspace that never opts in keeps exactly today's behaviour. The alternative —
 * defaulting to everything — would start filing heat and lake-hazard cards into
 * inboxes that never asked for them, which is the invisible-default failure that
 * put Illinois storm opportunities in front of tenants in Phoenix.
 */
export const DEFAULT_WEATHER_CATEGORIES: readonly WeatherCategory[] = ["property_damage", "fire_weather"] as const;

// Matched word-boundaried on the NWS event name, most specific first: an
// "Excessive Heat Warning" is heat, and must not fall through to anything else.
const HEAT_EVENT = /\b(heat|hot)\b/i;
// NWS's fire-weather products: "Red Flag Warning" (which contains no "fire" at
// all), "Fire Weather Watch", "Extreme Fire Danger". Keyed on the product name
// rather than the word, because matching only "fire" catches the second and
// silently drops the first.
const FIRE_WEATHER_EVENT = /\bred flag\b|\bfire\b/i;
const AIR_QUALITY_EVENT = /\b(air quality|air stagnation|smoke|dust)\b/i;
const MARINE_EVENT = /\b(beach|rip current|surf|marine|small craft|lakeshore|coastal)\b/i;

/**
 * The category an NWS event name belongs to, or null when it drives no demand this
 * connector models (Dense Fog, for instance — real, but not a marketing signal).
 *
 * Order matters. `property_damage` is tested LAST despite being the default,
 * because its regex is broad enough to swallow other categories: "Coastal Flood
 * Warning" contains "flood", and "Lakeshore Flood Advisory" contains both — those
 * are marine products, and a workspace that opted into damage-only should not
 * receive them.
 */
export function weatherCategoryOf(eventType: string | null | undefined): WeatherCategory | null {
  const name = (eventType ?? "").trim();
  if (!name) return null;
  if (HEAT_EVENT.test(name)) return "extreme_heat";
  if (AIR_QUALITY_EVENT.test(name)) return "air_quality";
  if (MARINE_EVENT.test(name)) return "marine_coastal";
  // Before the property_damage fallback, which also matches `red flag` and
  // `fire` and would otherwise claim a fire FORECAST had already caused damage.
  if (FIRE_WEATHER_EVENT.test(name)) return "fire_weather";
  if (isPropertyDamageWeather(name)) return "property_damage";
  return null;
}

/** Parse an operator's configured categories, falling back to the default set. */
export function parseWeatherCategories(raw: unknown): WeatherCategory[] {
  const list = Array.isArray(raw) ? raw : [];
  const valid = list
    .map((v) => (typeof v === "string" ? v.trim().toLowerCase() : ""))
    .filter((v): v is WeatherCategory => (WEATHER_CATEGORIES as readonly string[]).includes(v));
  const deduped = [...new Set(valid)];
  // An empty or unparseable list means "not configured", not "watch nothing" —
  // silently watching nothing would look identical to a quiet weather week.
  return deduped.length > 0 ? deduped : [...DEFAULT_WEATHER_CATEGORIES];
}

/**
 * Per-category card copy. Each states the demand ITS weather actually drives.
 *
 * Splitting this is the reason categories can be enabled at all: the single
 * summary asserted "Damage-response demand typically spikes", so admitting a heat
 * alert under the old copy would have produced a card claiming an Excessive Heat
 * Warning damages buildings — genuine NWS evidence wrapped around a false claim,
 * which is precisely what the category filter was protecting against.
 */
const WEATHER_CATEGORY_COPY: Record<
  WeatherCategory,
  { demand: (area: string) => string; action: (area: string) => string; campaignType: string }
> = {
  property_damage: {
    demand: (area) =>
      `Damage-response demand typically spikes in the affected area within days; ` +
      `a geo-targeted campaign reaches affected property owners before competitors do.`,
    action: (area) => `Launch a geo-targeted damage-response campaign for ${area}`,
    campaignType: "storm_response",
  },
  fire_weather: {
    // A Red Flag Warning forecasts fire RISK. Nothing has burned, so there are no
    // "affected property owners" and no damage to respond to — the demand it
    // drives is prevention before the window, not restoration after it. Saying
    // otherwise is a fabricated claim wearing a real NWS alert id.
    demand: () =>
      `Fire risk is elevated while the alert is in effect, and property owners act on ` +
      `prevention — defensible space, clearing gutters and vents, readiness checks — ` +
      `during the window rather than after it.`,
    action: (area) => `Launch a geo-targeted fire-preparedness campaign for ${area}`,
    campaignType: "fire_preparedness",
  },
  extreme_heat: {
    demand: () =>
      `Cooling and heat-resilience demand rises sharply while the alert is in effect, ` +
      `and property owners act during the heat rather than after it.`,
    action: (area) => `Launch a geo-targeted heat-response campaign for ${area}`,
    campaignType: "heat_response",
  },
  air_quality: {
    demand: () =>
      `Indoor air quality becomes an active concern while the alert is in effect, ` +
      `and property owners look for filtration and ventilation help during the episode.`,
    action: (area) => `Launch a geo-targeted indoor-air-quality campaign for ${area}`,
    campaignType: "air_quality_response",
  },
  marine_coastal: {
    demand: () =>
      `Waterfront and shoreline conditions are hazardous while the alert is in effect, ` +
      `which drives protective and remediation work for affected owners.`,
    action: (area) => `Launch a geo-targeted waterfront-response campaign for ${area}`,
    campaignType: "coastal_response",
  },
};

const WEATHER_SEVERITY_RANK: Record<WeatherSeverity, number> = {
  advisory: 1,
  watch: 2,
  warning: 3,
  emergency: 4,
};
const WEATHER_SEVERITY_CONFIDENCE: Record<WeatherSeverity, number> = {
  advisory: 55,
  watch: 72,
  warning: 88,
  emergency: 95,
};

function weatherUrgency(severity: WeatherSeverity): OpportunityCandidate["urgency"] {
  const rank = WEATHER_SEVERITY_RANK[severity];
  return rank >= 3 ? "high" : rank >= 2 ? "medium" : "low";
}

function cleanUrls(urls: string[] | undefined): string[] {
  return (urls ?? []).filter((u): u is string => typeof u === "string" && u.trim().length > 0);
}

/**
 * Weather-event opportunities: active property-damaging alerts in the coverage area.
 * Severity drives both urgency (warning+ = high) and confidence. Expired alerts
 * (endsAt in the past) and non-damaging alerts (see isPropertyDamageWeather) are
 * skipped, so the inbox only shows live weather this business could be called out to.
 *
 * The copy is deliberately tenant-neutral: "property owners", not "homeowners", and
 * no company name. Every workspace shares this detector — a roofer, a plumber, a
 * property manager and an insurer all read the same card.
 */
export function detectWeatherEventOpportunities(
  events: WeatherEventInput[],
  config: WeatherDetectionConfig,
): OpportunityCandidate[] {
  const now = Date.parse(config.now);
  const persona = typeof config.persona === "string" && config.persona.trim() ? config.persona.trim() : null;
  const allowed = new Set<WeatherCategory>(config.categories ?? DEFAULT_WEATHER_CATEGORIES);
  const out: OpportunityCandidate[] = [];
  for (const ev of events) {
    if (!ev.id) continue;
    if (ev.endsAt) {
      const ends = Date.parse(ev.endsAt);
      if (!Number.isNaN(ends) && !Number.isNaN(now) && ends < now) continue; // expired alert
    }
    const severity: WeatherSeverity = WEATHER_SEVERITY_RANK[ev.severity] ? ev.severity : "advisory";
    const eventType = ev.eventType?.trim() || "Weather alert";
    // A real alert this workspace hasn't opted into — or one that drives no demand
    // this connector models at all.
    const category = weatherCategoryOf(eventType);
    if (!category || !allowed.has(category)) continue;
    const copy = WEATHER_CATEGORY_COPY[category];
    const area = ev.area?.trim() || "the coverage area";
    const zips = (ev.zipCodes ?? []).filter((z) => typeof z === "string" && z.trim().length > 0);

    out.push({
      kind: "weather_event",
      subjectType: "weather_event",
      subjectId: ev.id,
      title: `${eventType} — ${area}`,
      summary: `${eventType} in effect for ${area}. ${copy.demand(area)}`,
      confidence: WEATHER_SEVERITY_CONFIDENCE[severity],
      urgency: weatherUrgency(severity),
      evidence: {
        ...(persona ? { persona } : {}),
        eventType,
        // On the card so a reviewer can see WHY this alert was surfaced — a heat
        // card and a hail card look alike once rendered, and the claim each makes
        // is different.
        category,
        area,
        severity,
        ...(zips.length ? { zipCodes: zips } : {}),
        ...(ev.startsAt ? { startsAt: ev.startsAt } : {}),
        ...(ev.endsAt ? { endsAt: ev.endsAt } : {}),
        evidence_urls: cleanUrls(ev.sourceUrls),
      },
      recommendedAction: copy.action(area),
      recommendedCampaignType: copy.campaignType,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Next-iteration opportunities
// ---------------------------------------------------------------------------
// A campaign that produced real results is the strongest signal of all: repeat
// what worked. This turns a live campaign's own attribution (best channel, booked
// jobs) into a proactive "draft round two" recommendation — the closing move of
// the performance learning loop, surfaced in the inbox instead of waiting for the
// operator to open the campaign. Read-only; the draft it recommends stays
// approval-gated. The learning itself is derived upstream (buildPerformanceLearning
// over real attribution); this module only scores it into a candidate.

export type NextIterationInput = {
  campaignId: string;
  campaignName: string;
  /** Original campaign persona, carried onto the next-iteration draft when known. */
  persona?: string;
  /** Best-performing channel by booked jobs. */
  topChannel: string;
  /** Booked jobs on the top channel (the proven-outcome signal). */
  bookedJobs: number;
  /** Attributed leads on the top channel. */
  leads: number;
  /** Best asset by CTR, when there's delivery data. */
  topAsset?: string;
  /** Grounded next-iteration recommendation (from buildPerformanceLearning). */
  recommendation: string;
  /** Ready-to-send Arc prompt for the next iteration. */
  arcPrompt: string;
};

/**
 * Next-iteration opportunities: a campaign whose results warrant a follow-up.
 * A proven winner (booked jobs) is high-confidence and more urgent than one that
 * only drew interest. Skips campaigns with no delivered signal. Deterministic.
 */
export function detectNextIterationOpportunities(inputs: NextIterationInput[]): OpportunityCandidate[] {
  const out: OpportunityCandidate[] = [];
  for (const c of inputs) {
    if (!c.campaignId) continue;
    if (c.bookedJobs <= 0 && c.leads <= 0) continue; // nothing proven to repeat

    const name = c.campaignName?.trim() || "A campaign";
    const proven = c.bookedJobs > 0;
    const confidence = clamp((proven ? 68 : 55) + Math.min(20, c.bookedJobs * 5) + Math.min(10, Math.floor(c.leads / 5)), 0, 100);
    const urgency: OpportunityCandidate["urgency"] = c.bookedJobs >= 5 ? "high" : c.bookedJobs >= 1 ? "medium" : "low";

    const outcomeClause = proven
      ? `${c.topChannel} booked ${c.bookedJobs} ${c.bookedJobs === 1 ? "job" : "jobs"} from ${c.leads} ${c.leads === 1 ? "lead" : "leads"}`
      : `${c.topChannel} drew ${c.leads} ${c.leads === 1 ? "lead" : "leads"}`;
    const title = proven
      ? `${name} is converting — draft the next iteration`
      : `${name} is drawing interest — draft a stronger follow-up`;

    out.push({
      kind: "next_iteration",
      subjectType: "campaign",
      subjectId: c.campaignId,
      title,
      summary:
        `${outcomeClause}. ${c.recommendation} Arc can draft round two now — approval-gated, nothing sends until you approve.`,
      confidence,
      urgency,
      evidence: {
        ...(c.persona ? { persona: c.persona } : {}),
        campaignName: name,
        topChannel: c.topChannel,
        bookedJobs: c.bookedJobs,
        leads: c.leads,
        ...(c.topAsset ? { topAsset: c.topAsset } : {}),
        arcPrompt: c.arcPrompt,
      },
      recommendedAction: `Draft the next iteration — ${c.recommendation}`,
      recommendedCampaignType: "next_iteration",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Competitor-activity opportunities
// ---------------------------------------------------------------------------
// An active competitor flight in shared territory is a defend-your-share signal.
// Read from captured competitor_campaigns intel (see src/domain/competitor-intel.ts)
// and surfaced as a defensive-flight recommendation. Deterministic + unit-tested.

export type CompetitorSignalInput = {
  id: string;
  competitorName: string;
  /** Channel/source the flight was seen on (meta_ad_library, google_ads_transparency, …). */
  channel: string;
  /** Review status of the captured intel: needs_review | confirmed | archived. */
  status: string;
  /** Keywords/terms the competitor is bidding on or emphasizing. */
  keywords?: string[];
  /** How many distinct ad creatives were captured — a proxy for flight size. */
  creativeCount?: number;
  /** Persona the competitor is targeting, when captured. */
  persona?: string;
  /** ISO capture time; intel older than freshDays is treated as stale. */
  capturedAt?: string;
  /** Source link (ad-library entry, landing page) for the evidence panel. */
  url?: string;
};

export type CompetitorDetectionConfig = { now: string; freshDays?: number };

const DEFAULT_COMPETITOR_FRESH_DAYS = 45;

const COMPETITOR_CHANNEL_LABELS: Record<string, string> = {
  meta_ad_library: "Meta",
  google_ads_transparency: "paid-search",
  similarweb: "paid",
  landing_page: "landing-page",
};

function competitorChannelLabel(channel: string): string {
  return COMPETITOR_CHANNEL_LABELS[channel] ?? (channel || "paid").replace(/[_-]+/g, " ").trim();
}

/**
 * Competitor-activity opportunities: a live competitor flight in contested
 * territory. Archived intel is ignored; captures older than freshDays are treated
 * as stale (not an active flight). Confirmed intel and a bigger creative count
 * raise both confidence and urgency.
 */
export function detectCompetitorOpportunities(
  signals: CompetitorSignalInput[],
  config: CompetitorDetectionConfig,
): OpportunityCandidate[] {
  const freshDays = config.freshDays ?? DEFAULT_COMPETITOR_FRESH_DAYS;
  const out: OpportunityCandidate[] = [];
  for (const s of signals) {
    if (!s.id) continue;
    if (s.status === "archived") continue;
    if (s.capturedAt) {
      const age = daysBetween(s.capturedAt, config.now);
      if (age > freshDays) continue; // stale intel — no longer a live flight
    }

    const creativeCount = Math.max(0, Math.floor(s.creativeCount ?? 0));
    const activityLevel: "low" | "medium" | "high" =
      creativeCount >= 5 ? "high" : creativeCount >= 2 ? "medium" : "low";
    const confirmed = s.status === "confirmed";

    const urgency: OpportunityCandidate["urgency"] =
      confirmed && activityLevel === "high" ? "high" : activityLevel !== "low" || confirmed ? "medium" : "low";
    // Confirmed intel is more trustworthy; more creatives = a bigger flight.
    const confidence = clamp((confirmed ? 70 : 55) + Math.min(20, creativeCount * 4), 0, 100);

    const keywords = (s.keywords ?? []).filter((k) => typeof k === "string" && k.trim().length > 0);
    const name = s.competitorName?.trim() || "A competitor";
    const channel = competitorChannelLabel(s.channel);
    const keywordNote = keywords.length ? ` on ${keywords.slice(0, 3).join(", ")}` : "";

    out.push({
      kind: "competitor_signal",
      subjectType: "competitor_signal",
      subjectId: s.id,
      title: `${name} is running ${channel} ads — contested territory`,
      summary:
        `${name} has an active ${channel} flight${keywordNote}. Holding share of voice in contested territory needs a ` +
        `defensive flight before they capture in-market demand.`,
      confidence,
      urgency,
      evidence: {
        ...(s.persona ? { persona: s.persona } : {}),
        competitor: name,
        channel,
        activityLevel,
        creativeCount,
        ...(keywords.length ? { keywords } : {}),
        ...(s.capturedAt ? { capturedAt: s.capturedAt } : {}),
        evidence_urls: s.url && s.url.trim() ? [s.url.trim()] : [],
      },
      recommendedAction: `Prepare a defensive ${channel} flight to hold share of voice against ${name}`,
      recommendedCampaignType: "competitive_defense",
    });
  }
  return out;
}

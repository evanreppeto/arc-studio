/**
 * Pure, deterministic mapping of National Weather Service / NOAA payloads onto
 * the opportunity-detection weather contract. No I/O — the live fetch lives in
 * `src/lib/integrations/weather/nws.ts` (BSR-364); this module only translates
 * saved-or-live NWS JSON into `WeatherEventInput[]` and parses a workspace's
 * service-area config. Kept pure so it stays unit-testable against saved NWS
 * fixtures with no network.
 *
 * NWS alerts API: https://api.weather.gov/alerts/active (GeoJSON FeatureCollection).
 * NWS points/forecast API: https://api.weather.gov/points/{lat},{lng}.
 * No API key is required; the caller must send a descriptive User-Agent.
 */

import type { WeatherEventInput, WeatherSeverity } from "./opportunity-detection";

// ---------------------------------------------------------------------------
// NWS payload shapes — only the fields this mapping reads. All optional because
// the feed is external and we read defensively.
// ---------------------------------------------------------------------------

/** CAP/GeoJSON alert properties from /alerts/active. */
export type NwsAlertProperties = {
  /** CAP identifier — the stable per-alert id we dedup on. */
  id?: string | null;
  "@id"?: string | null;
  event?: string | null; // "Flash Flood Warning"
  severity?: string | null; // Extreme | Severe | Moderate | Minor | Unknown
  certainty?: string | null;
  urgency?: string | null;
  areaDesc?: string | null; // "Cook, IL; DuPage, IL"
  effective?: string | null;
  onset?: string | null;
  sent?: string | null;
  expires?: string | null;
  ends?: string | null;
  status?: string | null; // Actual | Exercise | System | Test | Draft
  messageType?: string | null; // Alert | Update | Cancel | Ack | Error
  headline?: string | null;
  geocode?: { SAME?: string[] | null; UGC?: string[] | null } | null;
};

export type NwsAlertFeature = {
  id?: string | null;
  properties?: NwsAlertProperties | null;
};

/** FeatureCollection returned by /alerts/active. */
export type NwsAlertsResponse = {
  features?: NwsAlertFeature[] | null;
};

/** /points/{lat},{lng} response (only the forecast link + relative location). */
export type NwsPointResponse = {
  properties?: {
    forecast?: string | null;
    forecastHourly?: string | null;
    relativeLocation?: { properties?: { city?: string | null; state?: string | null } | null } | null;
  } | null;
};

export type NwsForecastPeriod = {
  name?: string | null;
  startTime?: string | null;
  isDaytime?: boolean | null;
  temperature?: number | null;
  temperatureUnit?: string | null;
  shortForecast?: string | null;
  detailedForecast?: string | null;
};

/** Gridpoint forecast response (the short-term forecast periods). */
export type NwsForecastResponse = {
  properties?: { periods?: NwsForecastPeriod[] | null } | null;
};

// ---------------------------------------------------------------------------
// Service-area config (per workspace)
// ---------------------------------------------------------------------------

export type WeatherServicePoint = { lat: number; lng: number; label?: string };

/** A workspace's weather coverage: US state codes and/or lat-lng points. */
export type WeatherServiceArea = {
  /** Two-letter US/marine area codes for /alerts/active?area=… */
  states: string[];
  /** Lat-lng points for /alerts/active?point=… and /points forecasts. */
  points: WeatherServicePoint[];
};

/** Nothing configured — watch nowhere. See parseWeatherServiceArea. */
export const EMPTY_WEATHER_SERVICE_AREA: WeatherServiceArea = { states: [], points: [] };

/** True once the operator has told us anywhere to watch. */
export function isWeatherServiceAreaConfigured(area: WeatherServiceArea): boolean {
  return area.states.length > 0 || area.points.length > 0;
}

// --- Operator-entered points ------------------------------------------------
// A point is itself "lat,lng", so a comma-separated list can't carry one — which
// is why the config editor only ever offered states. These parse/format the
// one-point-per-line form the editor uses instead.

/** `lat,lng` then an optional free-text label: "41.88,-87.63 Chicago". */
const POINT_LINE_RE = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(.*)$/;

export type ServicePointsInput = {
  points: WeatherServicePoint[];
  /** Lines that couldn't be read, verbatim — the caller SHOWS these rather than
   *  dropping them. A typo'd coordinate silently vanishing is how an operator ends
   *  up believing they're watching somewhere they aren't. */
  invalid: string[];
};

/**
 * Parse the operator's points textarea: one point per line, `lat,lng` with an
 * optional trailing label. Blank lines are ignored. Out-of-range coordinates are
 * invalid, not merely odd — NWS would answer a well-formed query about nowhere.
 */
export function parseServicePointsInput(text: string): ServicePointsInput {
  const points: WeatherServicePoint[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = POINT_LINE_RE.exec(line);
    if (!m) {
      invalid.push(line);
      continue;
    }
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      invalid.push(line);
      continue;
    }
    const key = `${lat},${lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = m[3].trim();
    points.push({ lat, lng, ...(label ? { label } : {}) });
  }
  return { points, invalid };
}

/** Render points back into the editor's one-per-line form. Round-trips parseServicePointsInput. */
export function formatServicePointsInput(points: WeatherServicePoint[]): string {
  return points.map((p) => `${p.lat},${p.lng}${p.label ? ` ${p.label}` : ""}`).join("\n");
}

const STATE_CODE_RE = /^[A-Za-z]{2}$/;

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") return value.split(",");
  return [];
}

function parsePoint(value: unknown): WeatherServicePoint | null {
  // Accept { lat, lng, label? } objects and "lat,lng" strings.
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const lat = typeof obj.lat === "number" ? obj.lat : Number(obj.lat);
    const lng = typeof obj.lng === "number" ? obj.lng : Number(obj.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const label = typeof obj.label === "string" && obj.label.trim() ? obj.label.trim() : undefined;
      return { lat, lng, ...(label ? { label } : {}) };
    }
    return null;
  }
  if (typeof value === "string") {
    const [a, b] = value.split(",").map((s) => Number(s.trim()));
    if (Number.isFinite(a) && Number.isFinite(b)) return { lat: a, lng: b };
  }
  return null;
}

/**
 * Parse a workspace_connectors.config object into a normalized service area.
 * Reads `states` (array or comma string) and `points` ({lat,lng} objects or
 * "lat,lng" strings), tolerates the legacy `locations` field (2-letter tokens →
 * states, "lat,lng" tokens → points), and falls back to the demo default when
 * nothing usable is configured — so a freshly enabled connector still scans.
 */
export function parseWeatherServiceArea(config: Record<string, unknown> | null | undefined): WeatherServiceArea {
  const cfg = config ?? {};
  const states = new Set<string>();
  const points: WeatherServicePoint[] = [];
  const pointKeys = new Set<string>();

  const addState = (raw: string) => {
    const s = raw.trim().toUpperCase();
    if (STATE_CODE_RE.test(s)) states.add(s);
  };
  const addPoint = (p: WeatherServicePoint | null) => {
    if (!p) return;
    const key = `${p.lat},${p.lng}`;
    if (pointKeys.has(key)) return;
    pointKeys.add(key);
    points.push(p);
  };

  // Explicit fields.
  for (const s of toStringArray(cfg.states ?? cfg.areas)) addState(s);
  const rawPoints = cfg.points;
  if (Array.isArray(rawPoints)) for (const p of rawPoints) addPoint(parsePoint(p));

  // Legacy `locations`: classify each token as a state code or a lat,lng point.
  for (const token of toStringArray(cfg.locations)) {
    const t = token.trim();
    if (!t) continue;
    if (STATE_CODE_RE.test(t)) addState(t);
    else addPoint(parsePoint(t));
  }

  // Nothing usable configured -> watch NOWHERE, and let the caller say so.
  //
  // This used to fall back to a built-in default of Illinois ("BSR's home turf").
  // That default was invisible and wrong for every other tenant: enable the
  // connector without setting an area and Arc would quietly propose Illinois storm
  // opportunities — carrying real NWS evidence — to a workspace that might be in
  // Phoenix. A service area is the operator's to choose; guessing it is worse than
  // doing nothing, because the output looks source-backed either way.
  if (states.size === 0 && points.length === 0) return { ...EMPTY_WEATHER_SERVICE_AREA };
  return { states: [...states], points };
}

// ---------------------------------------------------------------------------
// Severity + area normalization
// ---------------------------------------------------------------------------

/**
 * Map an NWS event name + CAP severity onto the normalized weather scale. The
 * event name is the stronger signal (a "Warning" outranks a "Watch"); CAP
 * severity is the fallback. Shared by the live NWS mapping and the DB-table
 * source in detector.ts so both stay in lockstep.
 */
export function normalizeNwsSeverity(eventType: string | null | undefined, capSeverity: string | null | undefined): WeatherSeverity {
  const type = (eventType ?? "").toLowerCase();
  if (type.includes("emergency")) return "emergency";
  if (type.includes("warning")) return "warning";
  if (type.includes("watch")) return "watch";
  if (type.includes("advisory") || type.includes("statement")) return "advisory";
  switch ((capSeverity ?? "").toLowerCase()) {
    case "extreme":
      return "emergency";
    case "severe":
      return "warning";
    case "moderate":
      return "watch";
    case "minor":
      return "advisory";
    default:
      return "advisory";
  }
}

/** Human coverage-area label from NWS areaDesc ("Cook, IL; DuPage, IL"). */
export function summarizeAlertArea(areaDesc: string | null | undefined): string {
  const desc = (areaDesc ?? "").trim();
  if (!desc) return "the coverage area";
  const parts = desc.split(";").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return "the coverage area";
  const head = parts.slice(0, 2).join(" / ");
  return parts.length > 2 ? `${head} +${parts.length - 2} more` : head;
}

function httpUrl(value: string | null | undefined): string | null {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
}

// messageType values that mean "no longer an active hazard".
const INACTIVE_MESSAGE_TYPES = new Set(["cancel", "ack", "error"]);

/**
 * Translate an NWS /alerts/active FeatureCollection into WeatherEventInput[].
 * Deterministic and read-only:
 *   • drops non-`Actual` status (Test/Exercise/System/Draft),
 *   • drops Cancel/Ack/Error message types,
 *   • drops expired alerts (ends/expires already in the past),
 *   • dedups by CAP alert id (so re-scans + point/state overlap don't double up).
 * The subjectId is the CAP alert id, which upsertOpportunities dedups on.
 */
export function mapNwsAlertsToWeatherEvents(
  response: NwsAlertsResponse | null | undefined,
  opts: { now: string },
): WeatherEventInput[] {
  const nowMs = Date.parse(opts.now);
  const byId = new Map<string, WeatherEventInput>();

  for (const feature of response?.features ?? []) {
    const p = feature?.properties ?? {};
    const id = (p.id ?? feature?.id ?? "").trim();
    if (!id) continue;

    if (p.status && p.status.toLowerCase() !== "actual") continue;
    if (p.messageType && INACTIVE_MESSAGE_TYPES.has(p.messageType.toLowerCase())) continue;

    const endsAt = (p.ends ?? p.expires ?? undefined) || undefined;
    if (endsAt) {
      const ends = Date.parse(endsAt);
      if (!Number.isNaN(ends) && !Number.isNaN(nowMs) && ends < nowMs) continue; // expired
    }

    const sourceUrls = [...new Set([httpUrl(feature?.id), httpUrl(p["@id"])].filter((u): u is string => u !== null))];

    byId.set(id, {
      id,
      eventType: (p.event ?? "Weather alert").trim() || "Weather alert",
      area: summarizeAlertArea(p.areaDesc),
      severity: normalizeNwsSeverity(p.event, p.severity),
      startsAt: (p.onset ?? p.effective ?? p.sent ?? undefined) || undefined,
      endsAt,
      ...(sourceUrls.length ? { sourceUrls } : {}),
    });
  }

  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// Short-term forecast summary (bonus enrichment; opportunities are alert-driven)
// ---------------------------------------------------------------------------

export type ForecastPeriodSummary = { name: string; summary: string; temperature: string | null };

/** Condense the next N forecast periods into short, display-ready summaries. */
export function summarizeForecastPeriods(
  response: NwsForecastResponse | null | undefined,
  limit = 2,
): ForecastPeriodSummary[] {
  const periods = response?.properties?.periods ?? [];
  const out: ForecastPeriodSummary[] = [];
  for (const period of periods) {
    if (out.length >= limit) break;
    const name = (period?.name ?? "").trim();
    const summary = (period?.shortForecast ?? "").trim();
    if (!name && !summary) continue;
    const temp =
      typeof period?.temperature === "number"
        ? `${period.temperature}°${(period.temperatureUnit ?? "F").trim() || "F"}`
        : null;
    out.push({ name: name || "Upcoming", summary: summary || "See detailed forecast", temperature: temp });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Monitored-point coverage (BSR-756)
// ---------------------------------------------------------------------------

/** A configured point, with the place NWS actually resolves it to. */
export type MonitoredPointLocation = {
  /** What the operator called it. Free text — nothing verifies it on save. */
  label?: string | null;
  /** `relativeLocation.city` from /points/{lat,lng}. Null when unresolved. */
  city?: string | null;
  /** `relativeLocation.state` from the same response. */
  state?: string | null;
};

export type MonitoredPointCoverage = {
  /** One line per point: what it was called, and where it actually is. */
  lines: string[];
  /** Points whose resolved city is not obviously inside the service area. */
  unconfirmed: string[];
  /** Points whose label disagrees with the resolved city — a definite error. */
  mislabelled: string[];
  /** Operator-facing summary, or null when everything looks consistent. */
  warning: string | null;
};

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Compare where a workspace is WATCHING against where it says it OPERATES.
 *
 * BSR monitored four points; three were outside its service area — Naperville
 * (a different county), Evanston and Cicero. Alerts fired correctly for
 * geography the business cannot serve, each seeding an opportunity, and one
 * became a campaign scoped to "Chicagoland". Nothing checked, because a point is
 * a lat/lng and a service area is a name.
 *
 * ── What this can and cannot know ────────────────────────────────────────────
 * It cannot decide whether `41.94,-87.66` is "in Lakeview": there is no
 * geocoding here, and a workspace names its patch however it likes. What it CAN
 * do is compare NWS's own resolved city for each point against the places the
 * workspace named — city to city, both read from records.
 *
 * So a point resolving to the home city, or to somewhere named in the service
 * areas, passes. Anything else is reported as UNCONFIRMED, not wrong: a business
 * may legitimately serve a neighbouring town. The operator decides; this only
 * makes the question visible, which it never was before.
 *
 * A label that disagrees with the resolved city IS reported as an error —
 * "Chicago" resolving to Naperville is not a judgement call.
 */
export function describeMonitoredPointCoverage(input: {
  points: readonly MonitoredPointLocation[];
  serviceAreas?: readonly string[] | null;
  /** The workspace's own city, when known. A point here is presumed covered. */
  homeCity?: string | null;
}): MonitoredPointCoverage {
  const areas = (input.serviceAreas ?? []).map(norm).filter(Boolean);
  const home = norm(input.homeCity);
  const lines: string[] = [];
  const unconfirmed: string[] = [];
  const mislabelled: string[] = [];

  for (const point of input.points) {
    const label = (point.label ?? "").trim();
    const city = (point.city ?? "").trim();
    const state = (point.state ?? "").trim();
    const where = city ? (state ? `${city}, ${state}` : city) : "unresolved";
    lines.push(label ? `${label} → ${where}` : where);

    // Unresolved points can't be judged either way — say so, don't guess.
    if (!city) continue;

    const covered = (home && norm(city) === home) || areas.includes(norm(city));
    if (!covered) unconfirmed.push(label ? `${label} (${where})` : where);

    // Only meaningful when the operator wrote a place name; a descriptive label
    // like "north lakefront" is not a claim about which city it is.
    if (label && norm(label) !== norm(city) && areas.includes(norm(label)) === false && home && norm(label) === home) {
      mislabelled.push(`${label} actually resolves to ${where}`);
    }
  }

  const parts: string[] = [];
  if (mislabelled.length) {
    parts.push(`Mislabelled: ${mislabelled.join("; ")}.`);
  }
  if (unconfirmed.length) {
    parts.push(
      `${unconfirmed.length} of ${input.points.length} monitored point(s) resolve outside your service area: ${unconfirmed.join("; ")}. Alerts there will seed opportunities for work you may not take — confirm you serve them, or remove them.`,
    );
  }
  return { lines, unconfirmed, mislabelled, warning: parts.length ? parts.join(" ") : null };
}

/**
 * The city from a US postal address block, or null.
 *
 * Needed because `business_profiles` records where a workspace SERVES (named
 * areas) but not where it IS, and a monitored point resolving to the home city
 * is the one case that is unambiguously covered. Without it, a correctly-placed
 * point in a workspace whose service areas are neighbourhood names — "Lakeview",
 * not "Chicago" — reads as outside its own service area, and a warning that
 * cries wolf gets ignored within a week.
 *
 * Deliberately narrow: the last line matching `City, ST` (optionally + ZIP).
 * Anything it cannot parse returns null and the caller simply gets no home-city
 * signal, rather than a guess.
 */
export function cityFromPostalAddress(address: string | null | undefined): string | null {
  const lines = (address ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = /^(.+?),\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/.exec(lines[i]);
    if (match) {
      const city = match[1].trim();
      if (city) return city;
    }
  }
  return null;
}

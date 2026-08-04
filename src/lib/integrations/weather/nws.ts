import type {
  NwsAlertFeature,
  NwsAlertsResponse,
  NwsForecastResponse,
  NwsPointResponse,
  WeatherServiceArea,
} from "@/domain";

// ---------------------------------------------------------------------------
// National Weather Service / NOAA HTTP client (BSR-364). Read-only. No API key —
// the public api.weather.gov requires only a descriptive User-Agent. A short-TTL
// in-memory cache + in-flight de-duplication keep us a respectful caller: repeated
// scans within the TTL reuse one response, and concurrent identical requests
// collapse to a single fetch. The pure mapping of these payloads onto the
// opportunity contract lives in `src/domain/nws-weather.ts`.
//
// API: https://www.weather.gov/documentation/services-web-api
// ---------------------------------------------------------------------------

const NWS_BASE = "https://api.weather.gov";
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes — alerts don't change faster than this in practice.

/**
 * NWS asks every client to send a User-Agent identifying the app + a contact.
 * Overridable per deployment via NWS_USER_AGENT; the fallback is descriptive and
 * still valid. https://www.weather.gov/documentation/services-web-api#/
 */
function userAgent(): string {
  return (
    process.env.NWS_USER_AGENT?.trim() ||
    "BigShouldersGrowthEngine/1.0 (weather-signals; contact: ops@arc-studio.ai)"
  );
}

type FetchLike = typeof fetch;

export type NwsRequestOptions = {
  /** Injectable fetch (tests pass a fixture-backed stub); defaults to global fetch. */
  fetchImpl?: FetchLike;
  /** Cache TTL override (ms). */
  ttlMs?: number;
  /** Deterministic "now" for cache-age math (tests). */
  now?: number;
};

const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

/** Test/reset helper — clears the response cache + in-flight map between cases. */
export function __resetNwsCacheForTests(): void {
  cache.clear();
  inflight.clear();
}

async function nwsGet<T>(pathOrUrl: string, opts: NwsRequestOptions = {}): Promise<T> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${NWS_BASE}${pathOrUrl}`;
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? Date.now();

  const hit = cache.get(url);
  if (hit && now - hit.at < ttl) return hit.value as T;

  const pending = inflight.get(url);
  if (pending) return pending as Promise<T>;

  const doFetch = (opts.fetchImpl ?? fetch)(url, {
    headers: { "User-Agent": userAgent(), Accept: "application/geo+json" },
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`NWS request failed (${res.status}) for ${url}`);
      const json = (await res.json()) as T;
      cache.set(url, { at: now, value: json });
      return json;
    })
    .finally(() => inflight.delete(url));

  inflight.set(url, doFetch);
  return doFetch;
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

/** Active alerts for a two-letter US/marine area code (e.g. "IL"). */
export function fetchActiveAlertsByState(state: string, opts?: NwsRequestOptions): Promise<NwsAlertsResponse> {
  const area = state.trim().toUpperCase();
  return nwsGet<NwsAlertsResponse>(`/alerts/active?status=actual&area=${encodeURIComponent(area)}`, opts);
}

/** Active alerts covering a single lat-lng point. */
export function fetchActiveAlertsByPoint(lat: number, lng: number, opts?: NwsRequestOptions): Promise<NwsAlertsResponse> {
  return nwsGet<NwsAlertsResponse>(`/alerts/active?status=actual&point=${lat},${lng}`, opts);
}

/**
 * All active alerts across a workspace's service area (every configured state +
 * point), merged and de-duplicated by CAP alert id. Best-effort per source: a
 * single state/point that errors is skipped so one bad area can't sink the scan.
 * States/points are fetched sequentially — a respectful, low-rate caller.
 */
export async function fetchServiceAreaAlerts(
  area: WeatherServiceArea,
  opts?: NwsRequestOptions,
): Promise<NwsAlertsResponse> {
  const byId = new Map<string, NwsAlertFeature>();
  const collect = (res: NwsAlertsResponse) => {
    for (const f of res.features ?? []) {
      const id = (f?.properties?.id ?? f?.id ?? "").trim();
      if (id) byId.set(id, f);
    }
  };

  for (const state of area.states) {
    try {
      collect(await fetchActiveAlertsByState(state, opts));
    } catch {
      // best-effort per state
    }
  }
  for (const point of area.points) {
    try {
      collect(await fetchActiveAlertsByPoint(point.lat, point.lng, opts));
    } catch {
      // best-effort per point
    }
  }

  return { features: [...byId.values()] };
}

/** Count of active alerts across the service area — powers the Test connection check. */
export async function countActiveAlerts(area: WeatherServiceArea, opts?: NwsRequestOptions): Promise<number> {
  const res = await fetchServiceAreaAlerts(area, opts);
  return res.features?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Short-term forecast
// ---------------------------------------------------------------------------

/**
 * Short-term forecast for a lat-lng point. NWS is a two-hop API: /points/{lat,lng}
 * returns the gridpoint forecast URL, which we then fetch. Returns null when the
 * point can't be resolved (e.g. offshore) rather than throwing.
 */
export async function fetchPointForecast(
  lat: number,
  lng: number,
  opts?: NwsRequestOptions,
): Promise<NwsForecastResponse | null> {
  const point = await nwsGet<NwsPointResponse>(`/points/${lat},${lng}`, opts);
  const forecastUrl = point?.properties?.forecast;
  if (!forecastUrl) return null;
  return nwsGet<NwsForecastResponse>(forecastUrl, opts);
}

/**
 * Where NWS says a lat/lng actually is. The same `/points` response the forecast
 * hop already reads, whose `relativeLocation` was being discarded.
 *
 * This is the only authoritative place-name available for a configured point, so
 * it is what makes "you are watching Naperville" sayable at all (BSR-756). Nulls
 * on any failure — an unresolved point is reported as unresolved, never guessed.
 */
export async function fetchPointLocation(
  lat: number,
  lng: number,
  opts?: NwsRequestOptions,
): Promise<{ city: string | null; state: string | null }> {
  try {
    const point = await nwsGet<NwsPointResponse>(`/points/${lat},${lng}`, opts);
    const loc = point?.properties?.relativeLocation?.properties ?? null;
    return { city: loc?.city ?? null, state: loc?.state ?? null };
  } catch {
    return { city: null, state: null };
  }
}

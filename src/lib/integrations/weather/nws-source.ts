import {
  describeMonitoredPointCoverage,
  isWeatherServiceAreaConfigured,
  mapNwsAlertsToWeatherEvents,
  summarizeForecastPeriods,
  type MonitoredPointCoverage,
  type WeatherServiceArea,
} from "@/domain";
import type { WeatherEventInput } from "@/domain";
import type { WeatherEventSource } from "@/lib/opportunities/detector";

import {
  countActiveAlerts,
  fetchActiveAlertsByPoint,
  fetchActiveAlertsByState,
  fetchPointForecast,
  fetchPointLocation,
  fetchServiceAreaAlerts,
  type NwsRequestOptions,
} from "./nws";

// ---------------------------------------------------------------------------
// The REAL implementation of BSR-361's injectable `WeatherEventSource`, backed by
// the live NWS/NOAA feed (BSR-364). Read-only: it fetches active alerts for the
// workspace's service area and maps them to WeatherEventInput[] via the pure
// domain mapper. Best-effort — any fetch failure degrades to "no active alerts"
// so the opportunity scan is never broken by an NWS outage.
// ---------------------------------------------------------------------------

/** Build a WeatherEventSource that reads live NWS alerts for `area`. */
export function nwsWeatherEventSource(area: WeatherServiceArea, opts?: NwsRequestOptions): WeatherEventSource {
  return {
    async listActiveEvents(now: string): Promise<WeatherEventInput[]> {
      try {
        const res = await fetchServiceAreaAlerts(area, opts);
        return mapNwsAlertsToWeatherEvents(res, { now });
      } catch {
        return [];
      }
    },
  };
}

export type NwsConnectionResult = {
  ok: boolean;
  /** Active-alert count for the service area (present on success). */
  count?: number;
  /** Short forecast headline for the first configured point (best-effort). */
  forecast?: string;
  /**
   * Where each monitored point actually is, and whether that looks like
   * somewhere this workspace serves (BSR-756). Absent when there are no points
   * or NWS could not be reached.
   */
  coverage?: MonitoredPointCoverage;
  error?: string;
};

/**
 * Connectivity probe for the weather signal source: hits NWS with the workspace's
 * service area and returns the current active-alert count (plus, if a point is
 * configured, the next forecast headline). Powers Settings → Test connection.
 * Never throws — a failure is reported as { ok: false }.
 */
export async function checkNwsConnection(
  area: WeatherServiceArea,
  opts?: NwsRequestOptions & {
    /** `business_profiles.service_areas` — what the workspace says it covers. */
    serviceAreas?: readonly string[] | null;
    /** The workspace's own city, when known. */
    homeCity?: string | null;
  },
): Promise<NwsConnectionResult> {
  try {
    // Nothing to probe until the operator says where to watch. This used to fall
    // back to a built-in area so the button always "worked" — which reported a live
    // alert count for somebody else's state.
    if (!isWeatherServiceAreaConfigured(area)) {
      return { ok: false, error: "No service area configured — set the states (or points) to watch first." };
    }

    // A direct, throwing probe of the first configured source, so a genuine NWS
    // outage surfaces as a failed test. countActiveAlerts (below) is best-effort
    // per source and would otherwise mask a total outage as "0 alerts". The
    // probe's response is TTL-cached, so the count re-uses it for free.
    if (area.states[0]) await fetchActiveAlertsByState(area.states[0], opts);
    else await fetchActiveAlertsByPoint(area.points[0].lat, area.points[0].lng, opts);

    const count = await countActiveAlerts(area, opts);
    let forecast: string | undefined;
    const point = area.points[0];
    if (point) {
      try {
        const periods = summarizeForecastPeriods(await fetchPointForecast(point.lat, point.lng, opts), 1);
        if (periods[0]) forecast = `${periods[0].name}: ${periods[0].summary}`;
      } catch {
        // forecast is a bonus — a failure here doesn't fail the connectivity check
      }
    }
    // Resolve every configured point to the place NWS says it is, so "you are
    // watching Naperville" becomes sayable. Best-effort and only on an explicit
    // test click: a resolution failure must not fail the connectivity check.
    let coverage: MonitoredPointCoverage | undefined;
    if (area.points.length) {
      try {
        const located = await Promise.all(
          area.points.map(async (p) => ({ label: p.label ?? null, ...(await fetchPointLocation(p.lat, p.lng, opts)) })),
        );
        coverage = describeMonitoredPointCoverage({
          points: located,
          serviceAreas: opts?.serviceAreas ?? null,
          homeCity: opts?.homeCity ?? null,
        });
      } catch {
        // coverage is a bonus, like the forecast above
      }
    }
    return { ok: true, count, ...(forecast ? { forecast } : {}), ...(coverage ? { coverage } : {}) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "NWS unreachable" };
  }
}

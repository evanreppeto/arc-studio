import { type LocationProfile } from "@/domain";

import { gbpGet, toBusinessInformationName, type GbpGetOptions } from "./client";

/**
 * Live source behind the local-SEO half of the reviews-signals connector: reads
 * one configured Google Business Profile location, read-only.
 *
 * Best-effort by design — a non-2xx or transport error yields `null` so a
 * provider hiccup never sinks the detection scan, matching the reviews source
 * and the NWS/GNews sources.
 *
 * Read-only is enforced upstream: every call goes through `gbpGet`, which
 * cannot issue anything but a GET. See `client.ts` for why that matters here
 * specifically.
 */

const BUSINESS_INFORMATION_HOST = "https://mybusinessbusinessinformation.googleapis.com/v1";

/**
 * Fields to request. `readMask` is REQUIRED by locations.get — omit it and the
 * call 400s rather than defaulting to everything.
 *
 * This list is also the audit's contract: `detectLocalSeoOpportunities` only
 * judges a field that was actually read (MISSING_IS_NOT_EMPTY), so adding a
 * rule means adding its field here too, or the rule silently never fires.
 */
export const LOCATION_READ_FIELDS = [
  "title",
  "categories",
  "regularHours",
  "serviceArea",
  "profile",
  "websiteUri",
  "serviceItems",
] as const;

export const LOCATION_READ_MASK = LOCATION_READ_FIELDS.join(",");

type GbpCategory = { displayName?: string };
type GbpLocationResponse = {
  name?: string;
  title?: string;
  categories?: { primaryCategory?: GbpCategory; additionalCategories?: GbpCategory[] };
  regularHours?: { periods?: unknown[] };
  serviceArea?: { places?: { placeInfos?: unknown[] } };
  profile?: { description?: string };
  websiteUri?: string;
  serviceItems?: unknown[];
};

/** Bare location id from a `locations/{id}` resource name. */
function locationIdFrom(name: string): string {
  return name.replace(/^locations\//, "");
}

/**
 * Map the API response onto the provider-agnostic profile the domain auditor
 * reads. Every field is derived defensively: a malformed or partial response
 * must produce "unknown", never a confident zero that invents a gap.
 */
export function gbpLocationToProfile(response: GbpLocationResponse, resourceName: string): LocationProfile {
  const periods = response.regularHours?.periods;
  const placeInfos = response.serviceArea?.places?.placeInfos;
  return {
    id: locationIdFrom(resourceName),
    title: response.title?.trim() || undefined,
    primaryCategory: response.categories?.primaryCategory?.displayName?.trim() || null,
    additionalCategories: (response.categories?.additionalCategories ?? [])
      .map((c) => c.displayName?.trim())
      .filter((n): n is string => Boolean(n)),
    // `regularHours` present with zero periods is a real "no hours set"; absent
    // entirely is unknown, so leave it undefined rather than guessing false.
    hasRegularHours: response.regularHours ? Array.isArray(periods) && periods.length > 0 : undefined,
    serviceAreaCount: response.serviceArea ? (Array.isArray(placeInfos) ? placeInfos.length : 0) : undefined,
    description: response.profile ? (response.profile.description?.trim() || null) : undefined,
    websiteUri: response.websiteUri?.trim() || null,
    serviceItemCount: Array.isArray(response.serviceItems) ? response.serviceItems.length : undefined,
    readFields: [...LOCATION_READ_FIELDS],
  };
}

export type LocationSource = {
  fetchProfile(): Promise<LocationProfile | null>;
};

/**
 * Live location source for one configured location.
 *
 * `configLocation` is the stored `accounts/{a}/locations/{id}` string; it is
 * translated here because this API keys on the bare form. An untranslatable
 * value yields `null` rather than a doomed request.
 */
export function gbpLocationSource(
  accessToken: string,
  opts: { configLocation: string } & GbpGetOptions,
): LocationSource {
  return {
    async fetchProfile(): Promise<LocationProfile | null> {
      const name = toBusinessInformationName(opts.configLocation);
      if (!name) return null;
      const url = `${BUSINESS_INFORMATION_HOST}/${name}?readMask=${encodeURIComponent(LOCATION_READ_MASK)}`;
      const result = await gbpGet(url, accessToken, opts);
      if (!result.ok) return null;
      const json = result.json;
      if (!json || typeof json !== "object") return null;
      return gbpLocationToProfile(json as GbpLocationResponse, name);
    },
  };
}

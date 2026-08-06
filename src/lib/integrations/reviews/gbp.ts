import type { ReviewInput } from "@/domain";

import { gbpGet } from "../gbp/client";

/**
 * Live source behind the reviews-signals connector: recent Google Business Profile
 * reviews for one configured location, read-only. Best-effort — a non-2xx or a
 * transport error yields [] so a provider hiccup never sinks the detection scan
 * (mirrors the NWS/GNews sources).
 *
 * The location resource name (`accounts/{id}/locations/{id}`) is operator-configured
 * (config.gbpLocation) because the v4 reviews endpoint is keyed on it. We keep only a
 * brief snippet of each review, never the full text (ToS).
 *
 * Reads go through `gbpGet` rather than `fetch` directly: the credential's scope
 * permits writing to the live profile, so the read-only property is enforced at
 * one door instead of trusted at each call site. See `../gbp/client.ts`.
 */

const SNIPPET_MAX = 200;

export type GbpReviewSourceOptions = {
  /** "accounts/{id}/locations/{id}". Reviews are fetched for this location. */
  locationName: string;
  /** Injected in tests so no live network is hit. */
  fetchImpl?: typeof fetch;
  /** Cap how many reviews a scan pulls (one page is plenty for signal detection). */
  pageSize?: number;
};

type GbpReviewer = { displayName?: string };
type GbpReview = {
  reviewId?: string;
  reviewer?: GbpReviewer;
  starRating?: string; // "ONE" | … | "FIVE"
  comment?: string;
  createTime?: string;
};
type GbpReviewsResponse = { reviews?: GbpReview[] };

const STAR_TO_NUMBER: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/** Map a GBP review to the shared ReviewInput. Null when it lacks an id or rating. */
export function gbpReviewToInput(review: GbpReview, locationName: string): ReviewInput | null {
  const id = review.reviewId?.trim();
  const rating = review.starRating ? STAR_TO_NUMBER[review.starRating] : undefined;
  if (!id || !rating) return null;
  const comment = review.comment?.trim();
  // Parse createTime defensively — new Date("bad").toISOString() throws.
  const ms = review.createTime ? Date.parse(review.createTime) : NaN;
  const postedAt = Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
  return {
    id,
    rating,
    author: review.reviewer?.displayName?.trim() || undefined,
    snippet: comment ? comment.slice(0, SNIPPET_MAX) : undefined,
    postedAt,
    provider: "google",
    location: locationName,
  };
}

export type GbpConnectionResult = { ok: true; count?: number } | { ok: false; error: string };

/**
 * Operator "Test connection" probe: fetch one page of reviews for the configured
 * location. Unlike the detection source (best-effort → []), this reports WHY it
 * failed so the card can say "token rejected" vs "location not found" — a silent
 * [] would read as a healthy connector with no reviews.
 */
export async function checkGbpConnection(
  accessToken: string,
  locationName: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<GbpConnectionResult> {
  const location = locationName?.trim();
  if (!location) return { ok: false, error: "no business location configured" };
  const result = await gbpGet(`https://mybusiness.googleapis.com/v4/${location}/reviews?pageSize=1`, accessToken, opts);
  if (!result.ok) {
    if (result.status === 401 || result.status === 403) return { ok: false, error: `access rejected (${result.status}) — reconnect Google` };
    if (result.status === 404) return { ok: false, error: "location not found — check the location resource name" };
    return { ok: false, error: result.error };
  }
  const json = (result.json ?? {}) as GbpReviewsResponse;
  return { ok: true, count: Array.isArray(json.reviews) ? json.reviews.length : 0 };
}

export function gbpReviewSource(accessToken: string, opts: GbpReviewSourceOptions): { listRecentReviews(now: string): Promise<ReviewInput[]> } {
  const pageSize = opts.pageSize ?? 50;
  return {
    async listRecentReviews(): Promise<ReviewInput[]> {
      const location = opts.locationName?.trim();
      if (!location) return [];
      const url = `https://mybusiness.googleapis.com/v4/${location}/reviews?pageSize=${pageSize}`;
      const result = await gbpGet(url, accessToken, opts);
      if (!result.ok) return [];
      const json = (result.json ?? {}) as GbpReviewsResponse;
      const reviews = Array.isArray(json.reviews) ? json.reviews : [];
      return reviews.map((r) => gbpReviewToInput(r, location)).filter((r): r is ReviewInput => r !== null);
    },
  };
}

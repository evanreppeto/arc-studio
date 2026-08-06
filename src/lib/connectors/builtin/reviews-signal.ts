import {
  detectLocalSeoOpportunities,
  detectReviewSignalOpportunities,
  type LocationProfile,
  type OpportunityCandidate,
  type ReviewInput,
} from "@/domain";

import { gbpLocationSource } from "@/lib/integrations/gbp/location";
import { gbpReviewSource } from "@/lib/integrations/reviews/gbp";

import { readConnectorCredential } from "../credentials";
import { resolveGoogleAccessToken } from "../google-oauth";
import { resolveConnectorCredentialRef } from "../read-model";
import { registerSignalSource, type SignalDetectContext, type SignalSourceConnector } from "../registry";

export const REVIEWS_SIGNAL_CONNECTOR_KEY = "reviews-signals";

// ---------------------------------------------------------------------------
// Real `reviews-signals` signal_source connector (BSR-365). Read-only: reads
// recent Google Business Profile / Yelp reviews for the workspace and maps them
// to `review_signal` opportunity candidates via the pure domain classifier —
// service-recovery for negatives, referral/testimonial for positives. It NEVER
// replies to a review; any response only ever exists as an approval-gated draft
// the operator builds from the opportunity. The orchestrator is the only writer,
// and only to `opportunities` via upsertOpportunities.
//
// Live GBP/Yelp OAuth review pull is the remaining integration; until it lands,
// reviews are read from the connector's own per-workspace config (`config.reviews`),
// which is the exact injectable seam a live `gbpReviewSource(credential)` drops
// into. subjectId is the review id, so upsertOpportunities' open-status dedup
// keeps re-scans from doubling up.
// ---------------------------------------------------------------------------

export type ReviewSource = {
  listRecentReviews(now: string): Promise<ReviewInput[]>;
};

function isReviewInput(value: unknown): value is ReviewInput {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return typeof r.id === "string" && r.id.trim().length > 0 && typeof r.rating === "number";
}

/**
 * Default source until live OAuth: recent reviews seeded into the connector's
 * per-workspace config (`config.reviews`). Returns [] when none are configured —
 * an un-onboarded connector proposes nothing rather than inventing reviews.
 */
export function configReviewSource(config: Record<string, unknown> | null | undefined): ReviewSource {
  return {
    async listRecentReviews(): Promise<ReviewInput[]> {
      const raw = (config ?? {}).reviews;
      return Array.isArray(raw) ? raw.filter(isReviewInput) : [];
    },
  };
}

export type ReviewDetectInput = Pick<SignalDetectContext, "config"> & {
  now?: string;
  /** Injected in tests / by a live provider; defaults to the config source. */
  source?: ReviewSource;
};

/**
 * Detect review-signal opportunities from recent reviews. Best-effort: a source
 * that can't fetch returns [], so a provider outage yields zero candidates
 * rather than breaking the scan.
 */
export async function detectReviewOpportunities(input: ReviewDetectInput): Promise<OpportunityCandidate[]> {
  const now = input.now ?? new Date().toISOString();
  const source = input.source ?? configReviewSource(input.config);
  const reviews = await source.listRecentReviews(now);
  return detectReviewSignalOpportunities(reviews, { now });
}

/**
 * Pick the review source for a scan: the LIVE Google Business Profile source when
 * the workspace has connected (OAuth credential) AND configured its location, else
 * the config seam (dev/demo). Best-effort — any resolution failure falls back to the
 * config source so a scan never throws.
 */
async function resolveReviewSource(ctx: SignalDetectContext): Promise<ReviewSource> {
  const locationName = typeof ctx.config?.gbpLocation === "string" ? ctx.config.gbpLocation.trim() : "";
  if (!ctx.client || !ctx.workspaceId || !locationName) return configReviewSource(ctx.config);
  try {
    const ref = await resolveConnectorCredentialRef(ctx.client, ctx.workspaceId, REVIEWS_SIGNAL_CONNECTOR_KEY);
    const raw = await readConnectorCredential(ctx.client, ref);
    if (!raw) return configReviewSource(ctx.config);
    const resolved = await resolveGoogleAccessToken(ctx.client, ref, raw);
    if (!resolved.ok) return configReviewSource(ctx.config);
    return gbpReviewSource(resolved.accessToken, { locationName });
  } catch {
    return configReviewSource(ctx.config);
  }
}

/**
 * The profile half of this connector: read the configured location and audit it
 * for the gaps that suppress local-pack visibility.
 *
 * Same OAuth credential, same location config, no new connector — the profile
 * and its reviews are two reads of one Business Profile. Null whenever the
 * workspace hasn't connected or configured a location, or the read fails; the
 * audit then contributes nothing rather than inventing gaps from an empty
 * profile, which is the one failure mode that would matter here (every rule
 * fires on absence).
 */
async function resolveLocationProfile(ctx: SignalDetectContext): Promise<LocationProfile | null> {
  const configLocation = typeof ctx.config?.gbpLocation === "string" ? ctx.config.gbpLocation.trim() : "";
  if (!ctx.client || !ctx.workspaceId || !configLocation) return null;
  try {
    const ref = await resolveConnectorCredentialRef(ctx.client, ctx.workspaceId, REVIEWS_SIGNAL_CONNECTOR_KEY);
    const raw = await readConnectorCredential(ctx.client, ref);
    if (!raw) return null;
    const resolved = await resolveGoogleAccessToken(ctx.client, ref, raw);
    if (!resolved.ok) return null;
    return await gbpLocationSource(resolved.accessToken, { configLocation }).fetchProfile();
  } catch {
    return null;
  }
}

export const reviewsSignalConnector: SignalSourceConnector = {
  key: REVIEWS_SIGNAL_CONNECTOR_KEY,
  detect: async (ctx) => {
    // Independent reads: a reviews outage must not suppress the profile audit,
    // and vice versa. Both already degrade to empty on their own.
    const [source, profile] = await Promise.all([resolveReviewSource(ctx), resolveLocationProfile(ctx)]);
    const [reviews, localSeo] = await Promise.all([
      detectReviewOpportunities({ config: ctx.config, now: ctx.now, source }),
      Promise.resolve(detectLocalSeoOpportunities(profile, { now: ctx.now })),
    ]);
    return [...reviews, ...localSeo];
  },
};

registerSignalSource(reviewsSignalConnector);

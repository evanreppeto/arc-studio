/**
 * Pure, deterministic local-SEO auditing of a business location profile — the
 * classifier half of the profile read behind the reviews-signals connector.
 * No I/O: the live Google Business Profile fetch lives behind an injectable
 * source in the connector runtime, so this module translates an already-fetched
 * profile into `local_seo_gap` opportunities and stays unit-testable with no
 * network.
 *
 * Why this is the local-SEO surface that matters: for an owner-operator service
 * business, the local pack is driven by profile completeness, category accuracy
 * and service-area coverage far more than by page-level keyword work. These are
 * the gaps that suppress visibility and that the operator can actually fix.
 *
 * ── Guardrail: read-only, and deliberately so ─────────────────────────────
 * Every field audited here is writable through the same OAuth scope the reader
 * uses (`business.manage`). Editing them would change a live public storefront,
 * which is an outbound action and may never happen without human approval. So
 * this module proposes; it never patches. Findings are opportunities the
 * operator acts on, not changes Arc makes.
 */

import { type OpportunityCandidate } from "./opportunity-detection";

/**
 * A fetched location profile, provider-agnostic — only what the auditor reads.
 * Mirrors `ReviewInput`'s shape discipline so a second provider (Yelp, Apple
 * Business Connect) can feed the same rules without touching them.
 *
 * Every field is optional because a `readMask` fetch can legitimately omit any
 * of them, and "absent from the response" must never be scored the same as
 * "confirmed empty" — see `MISSING_IS_NOT_EMPTY` below.
 */
export type LocationProfile = {
  /** Stable location id (the `locations/{id}` segment) — the dedup key root. */
  id: string;
  /** Operator-facing location name, for card titles. */
  title?: string;
  /** Primary GBP category display name. The single strongest local ranking input. */
  primaryCategory?: string | null;
  additionalCategories?: string[];
  /** True when the profile carries any regular opening hours at all. */
  hasRegularHours?: boolean;
  /** Number of service areas (places the business travels to serve). */
  serviceAreaCount?: number;
  /** The "from the business" description. */
  description?: string | null;
  websiteUri?: string | null;
  /** Count of listed services / service items. */
  serviceItemCount?: number;
  /**
   * Which fields the fetch actually asked for. A rule only fires for a field
   * present here — see `MISSING_IS_NOT_EMPTY`.
   */
  readFields?: string[];
};

export type LocalSeoConfig = {
  now: string;
  /** A description shorter than this reads as a stub. Default 120 characters. */
  minDescriptionChars?: number;
};

/**
 * MISSING_IS_NOT_EMPTY.
 *
 * A `readMask` fetch returns only the fields it asked for, so an unrequested or
 * unreturned field is unknown, not blank. Auditing it anyway would invent gaps
 * — telling an operator their hours are missing when the fetch simply never
 * asked. Every rule below is gated on the field having been read.
 */
function wasRead(profile: LocationProfile, field: string): boolean {
  // No readFields at all = a caller that isn't tracking them (tests, a future
  // provider). Audit everything rather than silently going quiet.
  if (!profile.readFields) return true;
  return profile.readFields.includes(field);
}

const DEFAULT_MIN_DESCRIPTION_CHARS = 120;

type GapRule = {
  /** Stable slug — part of subjectId, so dedup survives copy edits. */
  key: string;
  /** The readMask field this rule judges. */
  field: string;
  applies(profile: LocationProfile, config: Required<Pick<LocalSeoConfig, "minDescriptionChars">>): boolean;
  title(profile: LocationProfile): string;
  summary(profile: LocationProfile): string;
  confidence: number;
  urgency: OpportunityCandidate["urgency"];
  recommendedAction: string;
  recommendedCampaignType: string;
};

/**
 * The rules, ordered by how much each gap suppresses local visibility.
 *
 * Confidence is high across the board on purpose: unlike a behavioural signal,
 * these are not inferences. The profile either has a primary category or it does
 * not. What varies is how much the gap costs, which is `urgency`.
 */
const RULES: readonly GapRule[] = [
  {
    key: "missing_primary_category",
    field: "categories",
    applies: (p) => !p.primaryCategory?.trim(),
    title: () => "No primary category set on the business profile",
    summary: () =>
      "The primary category is the strongest single input to local pack ranking — it tells Google which searches " +
      "this business should appear in at all. Without one the profile competes for almost nothing.",
    confidence: 95,
    urgency: "high",
    recommendedAction: "Set a primary Google Business Profile category that matches the core service",
    recommendedCampaignType: "local_seo_fix",
  },
  {
    key: "no_service_area",
    field: "serviceArea",
    applies: (p) => (p.serviceAreaCount ?? 0) === 0,
    title: () => "No service area defined — invisible in the towns you actually serve",
    summary: () =>
      "A business that travels to its customers ranks in a service area, not just at its address. With none set, " +
      "the profile only surfaces near the storefront pin and misses every surrounding town it actually covers.",
    confidence: 92,
    urgency: "high",
    recommendedAction: "Add the towns and ZIP codes the business actually serves as Google Business Profile service areas",
    recommendedCampaignType: "local_seo_fix",
  },
  {
    key: "missing_hours",
    field: "regularHours",
    applies: (p) => p.hasRegularHours === false,
    title: () => "No opening hours on the business profile",
    summary: () =>
      "Missing hours suppress the profile in \"open now\" searches and push callers to a competitor who lists them. " +
      "For emergency-response work this is the difference between getting the call and not.",
    confidence: 90,
    urgency: "medium",
    recommendedAction: "Add regular opening hours, including any emergency or after-hours availability",
    recommendedCampaignType: "local_seo_fix",
  },
  {
    key: "thin_description",
    field: "profile",
    applies: (p, c) => {
      const text = p.description?.trim() ?? "";
      return text.length < c.minDescriptionChars;
    },
    title: (p) => (p.description?.trim() ? "Business description is too thin to rank or convert" : "No business description"),
    summary: () =>
      "The description is where the services, service area and proof live in the searcher's own words. A stub gives " +
      "Google nothing to match and gives a homeowner no reason to pick this business over the next one.",
    confidence: 85,
    urgency: "medium",
    recommendedAction: "Write a description covering the core services, the areas served, and what makes the business the safe choice",
    recommendedCampaignType: "local_seo_fix",
  },
  {
    key: "missing_website",
    field: "websiteUri",
    applies: (p) => !p.websiteUri?.trim(),
    title: () => "No website linked from the business profile",
    summary: () =>
      "The profile's website link is the main path from a local search to a booking. Without it every click that " +
      "would have reached the site stops at the profile.",
    confidence: 88,
    urgency: "medium",
    recommendedAction: "Link the business website from the Google Business Profile",
    recommendedCampaignType: "local_seo_fix",
  },
  {
    key: "no_service_items",
    field: "serviceItems",
    applies: (p) => (p.serviceItemCount ?? 0) === 0,
    title: () => "No services listed on the business profile",
    summary: () =>
      "Listed services let the profile match specific searches rather than only the category. Each named service is " +
      "another query the business can appear for.",
    confidence: 80,
    urgency: "low",
    recommendedAction: "List the individual services offered on the Google Business Profile",
    recommendedCampaignType: "local_seo_fix",
  },
] as const;

/**
 * Translate a fetched location profile into opportunity candidates.
 *
 * `subjectId` is `${locationId}:${ruleKey}` so `upsertOpportunities`' open-status
 * dedup keeps re-scans from doubling up, and fixing one gap retires only that
 * card. `subjectType` is "location" (external — no CRM foreign key).
 */
export function detectLocalSeoOpportunities(
  profile: LocationProfile | null | undefined,
  config: LocalSeoConfig,
): OpportunityCandidate[] {
  const id = profile?.id?.trim();
  if (!profile || !id) return [];

  const minDescriptionChars = config.minDescriptionChars ?? DEFAULT_MIN_DESCRIPTION_CHARS;
  const label = profile.title?.trim();
  const out: OpportunityCandidate[] = [];

  for (const rule of RULES) {
    if (!wasRead(profile, rule.field)) continue;
    if (!rule.applies(profile, { minDescriptionChars })) continue;

    out.push({
      kind: "local_seo_gap",
      subjectType: "location",
      subjectId: `${id}:${rule.key}`,
      title: label ? `${rule.title(profile)} — ${label}` : rule.title(profile),
      summary: rule.summary(profile),
      confidence: rule.confidence,
      urgency: rule.urgency,
      evidence: {
        source: "google_business_profile",
        locationId: id,
        gap: rule.key,
        field: rule.field,
        ...(label ? { location: label } : {}),
        ...(rule.key === "thin_description"
          ? { descriptionChars: profile.description?.trim().length ?? 0, minDescriptionChars }
          : {}),
        ...(rule.key === "missing_primary_category" && profile.additionalCategories?.length
          ? { additionalCategories: profile.additionalCategories }
          : {}),
      },
      recommendedAction: rule.recommendedAction,
      recommendedCampaignType: rule.recommendedCampaignType,
    });
  }

  return out;
}

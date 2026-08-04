/**
 * Pure lead/company enrichment mapping (BSR-368). Firmographic data from an
 * enrichment vendor (employee count, revenue, industry, role) is deterministic
 * *input* to the app's existing scoring + ingest contract — this module owns the
 * translation, with no I/O. The live vendor lookup lives behind an injectable
 * provider in `src/lib/integrations/enrichment/`; here we only map a fetched
 * `EnrichmentFields` object onto:
 *   1. a normalized firmographics record persisted as lead/company metadata.
 *   2. an enriched `LeadIngestionInput` (tier stamped on the company block) so an
 *      enrichment pass augments an imported lead through the SAME gated ingest
 *      path — never a separate outbound or auto-write path.
 *
 * There was a third: `mapEnrichmentToPartnerSignals`, which turned firmographics
 * into `PartnerScoreSignals` for `calculateScores`. Nothing ever called it —
 * `applyEnrichmentToLead` stamps the tier on the company block directly, and
 * scoring reads it from there. Removed rather than left as a second, unused way
 * to say the same thing (BSR-751).
 *
 * Kept pure so it's unit-testable against fixtures with no network. Enrichment is
 * read-IN only: it augments records, it never contacts anyone.
 */

import { type LeadIngestionInput } from "./lead-ingestion";
import { type PartnerTier } from "./scoring";

export type EnrichmentFields = {
  /** Canonical company name from the vendor (may differ from CRM). */
  companyName?: string;
  /** Company web domain — the natural enrichment lookup key. */
  domain?: string;
  /** Full-time employee headcount. */
  employeeCount?: number;
  /** Estimated annual revenue in USD. */
  annualRevenueUsd?: number;
  /** Industry / vertical label. */
  industry?: string;
  /** Contact's job title / role. */
  role?: string;
  /** Seniority bucket if the vendor supplies one (e.g. "owner", "manager"). */
  seniority?: string;
  city?: string;
  state?: string;
};

/**
 * Firmographic thresholds that derive a partner tier. Deliberately coarse and
 * tenant-agnostic — a bigger organization is a higher-value account regardless of
 * industry. Tier A ≈ enterprise, B ≈ mid-market, C ≈ small. Either headcount OR
 * revenue clearing a threshold is enough (vendors often supply only one).
 */
export const ENRICHMENT_TIER_THRESHOLDS = {
  a: { employeeCount: 200, annualRevenueUsd: 50_000_000 },
  b: { employeeCount: 25, annualRevenueUsd: 5_000_000 },
} as const;

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Derive a partner tier (A/B/C) from firmographic size. Returns null when the
 * fields carry no headcount and no revenue — there's no size signal to tier on,
 * so scoring is left untouched rather than guessing a tier.
 */
export function deriveTierFromEnrichment(fields: EnrichmentFields): PartnerTier | null {
  const employees = isPositiveNumber(fields.employeeCount) ? fields.employeeCount : null;
  const revenue = isPositiveNumber(fields.annualRevenueUsd) ? fields.annualRevenueUsd : null;
  if (employees === null && revenue === null) return null;

  const meets = (t: { employeeCount: number; annualRevenueUsd: number }) =>
    (employees !== null && employees >= t.employeeCount) || (revenue !== null && revenue >= t.annualRevenueUsd);

  if (meets(ENRICHMENT_TIER_THRESHOLDS.a)) return "A";
  if (meets(ENRICHMENT_TIER_THRESHOLDS.b)) return "B";
  return "C";
}

/** The normalized, snake_case firmographics record stored as metadata. */
export type CompanyFirmographics = {
  domain?: string;
  employee_count?: number;
  annual_revenue_usd?: number;
  industry?: string;
  role?: string;
  seniority?: string;
};

function trimmed(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Normalize enrichment fields into the persisted firmographics shape, dropping
 * absent/empty values. Returns null when nothing usable was supplied so callers
 * can skip writing an empty metadata block.
 */
export function mapEnrichmentToCompanyFirmographics(fields: EnrichmentFields): CompanyFirmographics | null {
  const out: CompanyFirmographics = {};
  if (trimmed(fields.domain)) out.domain = trimmed(fields.domain);
  if (isPositiveNumber(fields.employeeCount)) out.employee_count = fields.employeeCount;
  if (isPositiveNumber(fields.annualRevenueUsd)) out.annual_revenue_usd = fields.annualRevenueUsd;
  if (trimmed(fields.industry)) out.industry = trimmed(fields.industry);
  if (trimmed(fields.role)) out.role = trimmed(fields.role);
  if (trimmed(fields.seniority)) out.seniority = trimmed(fields.seniority);
  return Object.keys(out).length ? out : null;
}

/**
 * Augment a lead-ingestion input with enrichment: stamp the derived partner tier
 * on the company block (so it flows into partnerScore) and stash normalized
 * firmographics under `metadata.enrichment`. Pure — returns a new input, never
 * mutates. An existing explicit `partnerTier` is preserved (operator/source data
 * wins over a derived guess). When the lead has no company block but enrichment
 * supplies a company name, a minimal company block is created so the tier lands.
 */
export function applyEnrichmentToLead(lead: LeadIngestionInput, fields: EnrichmentFields): LeadIngestionInput {
  const tier = deriveTierFromEnrichment(fields);
  const firmographics = mapEnrichmentToCompanyFirmographics(fields);

  const baseCompany = lead.company ?? (trimmed(fields.companyName) ? { name: trimmed(fields.companyName)! } : undefined);
  const company = baseCompany
    ? { ...baseCompany, ...(tier && !baseCompany.partnerTier ? { partnerTier: tier } : {}) }
    : undefined;

  const metadata = firmographics
    ? { ...(lead.metadata ?? {}), enrichment: firmographics }
    : lead.metadata;

  return {
    ...lead,
    ...(company ? { company } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

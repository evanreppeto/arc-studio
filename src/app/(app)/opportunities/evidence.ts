import type { OpportunityVM } from "./_components/opportunity-inbox";

/**
 * Evidence keys the page's bespoke rows already render, plus payloads that are
 * not evidence at all. Everything else falls through to a generic row.
 *
 * The bespoke rows were written for the DETERMINISTIC detectors (weather,
 * competitor, cold-lead), whose keys are fixed and known. Arc's generative scan
 * names its own key per finding — `advisory_area`, `crm_jobs`, `draft_assets`,
 * `serviceAreas_configured` — so an allowlist rendered two rows per card and
 * silently dropped the reasoning that justifies it. A census of the live org
 * found 20 distinct keys dropped against 7 rendered.
 */
const RENDERED_EVIDENCE_KEYS = new Set([
  // Rendered by a bespoke row in toVM().
  "eventType",
  "category",
  "area",
  "zipCodes",
  "competitor",
  "channel",
  "creativeCount",
  "activityLevel",
  "keywords",
  "source",
  "matchedKeywords",
  "topChannel",
  "bookedJobs",
  "leads",
  "topAsset",
  "leadScore",
  "daysCold",
  "lastActivityAt",
  "persona",
  "evidence_urls",
  "severity",
  // Deliberately withheld: a ready-to-send model prompt is a payload the Draft
  // flow consumes, not something an operator reads as evidence for a claim.
  "arcPrompt",
]);

/** Tokens that read as shouted acronyms rather than words once title-cased. */
const ACRONYMS = new Set(["crm", "cta", "roi", "seo", "sms", "url", "urls", "id", "ids", "nws", "kpi", "ai", "ugc"]);

/**
 * Turn an evidence key into a row label: `advisory_area` → "Advisory area",
 * `crm_jobs` → "CRM jobs", `mediaAvailable_approved` → "Media available approved".
 * Handles snake_case, kebab-case, and camelCase, since Arc mixes all three.
 */
export function humanizeEvidenceKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "";
  return words
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      if (i === 0) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      return lower;
    })
    .join(" ");
}

/** Longest a single evidence value may run before it stops being scannable. */
const MAX_VALUE_CHARS = 160;
/** How many array entries to name before collapsing the tail into "+N more". */
const MAX_ITEMS = 4;

/** Pull a human label out of an object entry, e.g. one element of `draft_assets`. */
function labelOf(value: Record<string, unknown>): string | null {
  for (const key of ["label", "name", "title", "campaign", "summary", "id"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

/**
 * Render an arbitrary JSON evidence value as one line of display text, or null
 * when there is nothing worth showing.
 *
 * An EMPTY array reads as "None" rather than being skipped: `serviceAreas_configured: []`
 * is precisely the finding Arc is reporting, and dropping it would hide the gap
 * the card exists to raise.
 */
export function formatEvidenceValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.length > MAX_VALUE_CHARS ? `${trimmed.slice(0, MAX_VALUE_CHARS - 1).trim()}…` : trimmed;
  }
  if (Array.isArray(value)) {
    if (!value.length) return "None";
    const parts = value
      .map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? labelOf(item as Record<string, unknown>)
          : formatEvidenceValue(item),
      )
      .filter((part): part is string => Boolean(part));
    if (!parts.length) return `${value.length} item${value.length === 1 ? "" : "s"}`;
    const shown = parts.slice(0, MAX_ITEMS).join(", ");
    return parts.length > MAX_ITEMS ? `${shown} +${parts.length - MAX_ITEMS} more` : shown;
  }
  if (typeof value === "object") {
    const label = labelOf(value as Record<string, unknown>);
    if (label) return label;
    const count = Object.keys(value as object).length;
    return count ? `${count} field${count === 1 ? "" : "s"}` : null;
  }
  return null;
}

/**
 * Generic rows for every evidence key the bespoke rows didn't claim. Pure, so the
 * mapping can be tested without rendering the page.
 */
export function extraEvidenceRows(evidence: Record<string, unknown>): OpportunityVM["evidence"] {
  const rows: OpportunityVM["evidence"] = [];
  for (const [key, raw] of Object.entries(evidence)) {
    if (RENDERED_EVIDENCE_KEYS.has(key)) continue;
    const label = humanizeEvidenceKey(key);
    if (!label) continue;
    const value = formatEvidenceValue(raw);
    if (value) rows.push({ label, value });
  }
  return rows;
}

// Provenance completeness for a media asset — pure, no I/O.
//
// BSR-514's sharpest rule: **missing provenance is itself a risk flag.** An asset
// whose origin we can't account for must never render as clean simply because
// nothing flagged it. Absence of evidence was being displayed as evidence of
// absence — a card with no risk chips read "reviewed and fine" when it actually
// meant "we don't know where this came from".
//
// The reviewer is deciding whether this may reach a customer. "Unknown" is the
// answer that most needs saying out loud.

/** How an asset came to exist, as stored on `media_assets.source`. */
export type AssetSourceKind = "real" | "ai_generated" | "composite" | "uploaded" | "stock" | "external" | "unknown";

export type AssetProvenanceInput = {
  source: string | null | undefined;
  /** The stored provenance blob (tool, model, jobId, sourceUrl, …). */
  provenance: Record<string, unknown> | null | undefined;
  /** Risk flags already recorded against the asset. */
  riskFlags: readonly string[];
};

export type AssetProvenanceAssessment = {
  kind: AssetSourceKind;
  /** True when we can account for how this asset was made. */
  accounted: boolean;
  /** What's absent, in reviewer-facing words. Empty when fully accounted for. */
  gaps: string[];
  /** Risk flags to display: the stored ones plus any provenance gap. */
  riskFlags: string[];
};

/** The flag added when an asset's origin can't be accounted for. */
export const UNVERIFIED_PROVENANCE_FLAG = "Provenance unverified — origin not recorded";

/** The flag added when a generated asset doesn't say what generated it. */
export const UNATTRIBUTED_GENERATION_FLAG = "Generated, but the model and job weren't recorded";

/** The flag added when a composite doesn't name what it was composed from. */
export const UNSOURCED_COMPOSITE_FLAG = "Composite — the real media it was built from isn't named";

function normalizeKind(source: string | null | undefined): AssetSourceKind {
  switch ((source ?? "").trim()) {
    case "real":
    case "real_media":
      return "real";
    case "ai_generated":
      return "ai_generated";
    case "composite":
      return "composite";
    case "uploaded":
      return "uploaded";
    case "stock":
      return "stock";
    case "external":
      return "external";
    default:
      return "unknown";
  }
}

function has(record: Record<string, unknown> | null | undefined, key: string): boolean {
  const v = record?.[key];
  return typeof v === "string" ? v.trim().length > 0 : v != null;
}

/**
 * Assess how well an asset's origin is accounted for, and return the risk flags
 * a card should display — the stored ones plus anything the gaps imply.
 *
 * Deliberately conservative: a gap is reported whenever we cannot positively
 * establish origin. Over-flagging costs a reviewer a glance; under-flagging can
 * put an unattributable image in front of a customer.
 */
export function assessProvenance(input: AssetProvenanceInput): AssetProvenanceAssessment {
  const kind = normalizeKind(input.source);
  const stored = [...input.riskFlags];
  const gaps: string[] = [];

  if (kind === "unknown") {
    gaps.push("Source type not recorded");
  }

  // A generated asset has to say what generated it, or the claim "AI-generated"
  // is unfalsifiable and the output can't be traced back to a prompt or job.
  if (kind === "ai_generated") {
    const attributed = has(input.provenance, "tool") || has(input.provenance, "model");
    if (!attributed) gaps.push("Generator not recorded");
    if (!has(input.provenance, "jobId")) gaps.push("Generation job id not recorded");
  }

  // The ticket's explicit rule: a composite must NAME its real source, not just
  // declare itself a composite. Otherwise "composite" hides the same question it
  // appears to answer.
  if (kind === "composite") {
    const named =
      has(input.provenance, "sourceAssetId") ||
      has(input.provenance, "sourceUrl") ||
      has(input.provenance, "composedFrom");
    if (!named) gaps.push("Real source not named");
  }

  // Imported/external media is only as trustworthy as its origin URL.
  if (kind === "external" || kind === "uploaded" || kind === "stock") {
    const traceable =
      has(input.provenance, "sourceUrl") ||
      has(input.provenance, "fetchedFrom") ||
      has(input.provenance, "googleDriveWebUrl");
    if (!traceable) gaps.push("Original location not recorded");
  }

  const derived: string[] = [];
  if (gaps.length) {
    if (kind === "ai_generated") derived.push(UNATTRIBUTED_GENERATION_FLAG);
    else if (kind === "composite") derived.push(UNSOURCED_COMPOSITE_FLAG);
    else derived.push(UNVERIFIED_PROVENANCE_FLAG);
  }

  return {
    kind,
    accounted: gaps.length === 0,
    gaps,
    // Stored flags first — a human-recorded concern outranks a derived one.
    riskFlags: [...stored, ...derived.filter((d) => !stored.includes(d))],
  };
}

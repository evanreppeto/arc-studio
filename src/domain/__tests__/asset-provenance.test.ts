import { describe, expect, it } from "vitest";

import {
  UNATTRIBUTED_GENERATION_FLAG,
  UNSOURCED_COMPOSITE_FLAG,
  UNVERIFIED_PROVENANCE_FLAG,
  assessProvenance,
} from "../asset-provenance";

function assess(over: Parameters<typeof assessProvenance>[0] extends infer T ? Partial<T> : never = {}) {
  return assessProvenance({ source: "real", provenance: {}, riskFlags: [], ...over });
}

describe("assessProvenance", () => {
  it("accounts for real media without inventing gaps", () => {
    const a = assess({ source: "real" });
    expect(a.kind).toBe("real");
    expect(a.accounted).toBe(true);
    expect(a.riskFlags).toEqual([]);
  });

  // The rule this module exists for. Before it, an asset with no recorded source
  // and no stored flags rendered with a clean card — absence of evidence
  // displayed as evidence of absence.
  it("flags an unknown source rather than rendering it clean", () => {
    const a = assess({ source: null });
    expect(a.kind).toBe("unknown");
    expect(a.accounted).toBe(false);
    expect(a.riskFlags).toContain(UNVERIFIED_PROVENANCE_FLAG);
  });

  it("flags a generated asset that doesn't say what generated it", () => {
    const a = assess({ source: "ai_generated", provenance: {} });
    expect(a.accounted).toBe(false);
    expect(a.gaps).toContain("Generator not recorded");
    expect(a.riskFlags).toContain(UNATTRIBUTED_GENERATION_FLAG);
  });

  it("accepts a generated asset that records its model and job", () => {
    const a = assess({
      source: "ai_generated",
      provenance: { tool: "Gemini", model: "imagen-4", jobId: "job_123" },
    });
    expect(a.accounted).toBe(true);
    expect(a.riskFlags).toEqual([]);
  });

  it("still flags a generated asset that names a model but no job", () => {
    const a = assess({ source: "ai_generated", provenance: { model: "imagen-4" } });
    expect(a.gaps).toContain("Generation job id not recorded");
  });

  // "Composite" otherwise hides the very question it appears to answer.
  it("requires a composite to name the real media it was built from", () => {
    expect(assess({ source: "composite", provenance: {} }).riskFlags).toContain(UNSOURCED_COMPOSITE_FLAG);
    expect(assess({ source: "composite", provenance: { sourceAssetId: "asset_9" } }).accounted).toBe(true);
  });

  it("requires imported media to record where it came from", () => {
    expect(assess({ source: "external", provenance: {} }).accounted).toBe(false);
    expect(assess({ source: "uploaded", provenance: { fetchedFrom: "https://x.test/a.png" } }).accounted).toBe(true);
    expect(assess({ source: "stock", provenance: { sourceUrl: "https://s.test/1" } }).accounted).toBe(true);
  });

  it("keeps human-recorded flags ahead of derived ones and never duplicates", () => {
    const a = assess({ source: null, riskFlags: ["Embedded text may not be legible"] });
    expect(a.riskFlags[0]).toBe("Embedded text may not be legible");
    expect(a.riskFlags).toContain(UNVERIFIED_PROVENANCE_FLAG);

    const already = assess({ source: null, riskFlags: [UNVERIFIED_PROVENANCE_FLAG] });
    expect(already.riskFlags.filter((f) => f === UNVERIFIED_PROVENANCE_FLAG)).toHaveLength(1);
  });

  it("treats blank and whitespace provenance values as absent", () => {
    expect(assess({ source: "ai_generated", provenance: { tool: "   ", jobId: "" } }).accounted).toBe(false);
  });
});

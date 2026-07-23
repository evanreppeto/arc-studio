import { describe, expect, it } from "vitest";

import { describeExternalMediaProvenance, deriveMediaIngestTags, parseExternalMediaProvenance, parseMediaIngestPayload } from "../media-ingest";

describe("describeExternalMediaProvenance", () => {
  it("builds lineage rows from declared tool lineage and separates the prompt", () => {
    const described = describeExternalMediaProvenance({
      tool: "Higgsfield",
      model: "soul-x",
      jobId: "hf_123",
      sourceUrl: "https://higgsfield.ai/jobs/hf_123",
      prompt: "storm sky over a roofline",
    });
    expect(described.rows).toEqual([
      ["ai", "Made in Higgsfield · soul-x"],
      ["ai", "Source job · hf_123"],
      ["upload", "Original · higgsfield.ai"],
    ]);
    expect(described.prompt).toBe("storm sky over a roofline");
  });

  it("falls back to the ingest paths' origin keys for the Original row", () => {
    expect(describeExternalMediaProvenance({ origin: "api_import", fetchedFrom: "https://cdn.example.com/a.png" }).rows).toEqual([
      ["upload", "Original · cdn.example.com"],
    ]);
    expect(describeExternalMediaProvenance({ googleDriveWebUrl: "https://drive.google.com/file/d/x" }).rows).toEqual([
      ["upload", "Original · drive.google.com"],
    ]);
  });

  it("returns nothing for assets with no external lineage", () => {
    expect(describeExternalMediaProvenance({ origin: "operator_upload" })).toEqual({ rows: [], prompt: null });
    expect(describeExternalMediaProvenance(null)).toEqual({ rows: [], prompt: null });
  });
});

describe("parseExternalMediaProvenance", () => {
  it("keeps declared lineage, trims, and drops empties and junk", () => {
    expect(
      parseExternalMediaProvenance({ tool: " Higgsfield ", model: "soul-x", prompt: "storm roof", jobId: "j1", sourceUrl: "https://h.io/j1", extra: "ignored", confidence: 3 }),
    ).toEqual({ tool: "Higgsfield", model: "soul-x", prompt: "storm roof", jobId: "j1", sourceUrl: "https://h.io/j1" });
    expect(parseExternalMediaProvenance({ tool: "  ", prompt: 42 })).toEqual({});
    expect(parseExternalMediaProvenance(null)).toEqual({});
    expect(parseExternalMediaProvenance("higgsfield")).toEqual({});
  });
});

describe("deriveMediaIngestTags", () => {
  it("tokenizes the filename and leads with the tool", () => {
    expect(deriveMediaIngestTags({ fileName: "Storm-Roof-Hero_final.PNG", tool: "Higgsfield" })).toEqual([
      "higgsfield",
      "storm",
      "roof",
      "hero",
    ]);
  });

  it("drops stopwords and short tokens, caps the list, and dedupes", () => {
    const tags = deriveMediaIngestTags({ fileName: "the-new-final-a-b-crew-crew-photo-lakeview-spring-porch-gutter-deck.jpg" });
    expect(tags).toEqual(["crew", "photo", "lakeview", "spring", "porch", "gutter"]);
    expect(tags.length).toBeLessThanOrEqual(6);
  });

  it("returns nothing useful for an opaque filename instead of inventing tags", () => {
    expect(deriveMediaIngestTags({ fileName: "IMG_20260723_0001.jpg" })).toEqual([]);
  });
});

describe("parseMediaIngestPayload", () => {
  const base = { fileName: "roof.png", sourceUrl: "https://cdn.example.com/roof.png" };

  it("accepts a minimal https payload with held-for-review defaults", () => {
    const parsed = parseMediaIngestPayload(base);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      fileName: "roof.png",
      sourceUrl: "https://cdn.example.com/roof.png",
      contentBase64: null,
      availableToArc: false,
      provenance: {},
      tags: [],
    });
  });

  it("normalizes tags and provenance and honors an explicit availableToArc", () => {
    const parsed = parseMediaIngestPayload({
      ...base,
      tags: ["Roof", "  storm  ", 7, ""],
      availableToArc: true,
      provenance: { tool: "gemini", prompt: "roofline at dusk" },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.tags).toEqual(["roof", "storm"]);
    expect(parsed.value.availableToArc).toBe(true);
    expect(parsed.value.provenance).toEqual({ tool: "gemini", prompt: "roofline at dusk" });
  });

  it("requires a fileName and exactly one content source, and refuses http", () => {
    expect(parseMediaIngestPayload({ sourceUrl: base.sourceUrl })).toMatchObject({ ok: false });
    expect(parseMediaIngestPayload({ fileName: "a.png" })).toMatchObject({
      ok: false,
      errors: [{ code: "content_required", message: expect.any(String) }],
    });
    expect(parseMediaIngestPayload({ fileName: "a.png", sourceUrl: base.sourceUrl, contentBase64: "aGk=" })).toMatchObject({
      ok: false,
      errors: [{ code: "content_ambiguous", message: expect.any(String) }],
    });
    expect(parseMediaIngestPayload({ fileName: "a.png", sourceUrl: "http://cdn.example.com/a.png" })).toMatchObject({
      ok: false,
      errors: [{ code: "source_url_https", message: expect.any(String) }],
    });
    expect(parseMediaIngestPayload([])).toMatchObject({ ok: false });
  });
});

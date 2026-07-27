import { describe, expect, it } from "vitest";

import { mapMediaAssetForTest } from "../read-model";

describe("campaign media lineage passthrough", () => {
  it("carries external lineage rows and the prompt from an audit media entry", () => {
    const asset = mapMediaAssetForTest(
      {
        url: "https://x/a.png",
        source: "ai_generated",
        tool: "Higgsfield",
        model: "soul-x",
        job_id: "hf_123",
        prompt: "storm sky over a roofline",
      },
      "Asset audit",
      "attached",
    );
    expect(asset?.lineage).toEqual([
      ["ai", "Made in Higgsfield · soul-x"],
      ["ai", "Source job · hf_123"],
    ]);
    expect(asset?.prompt).toBe("storm sky over a roofline");
    // Generation provenance still flips the origin badge.
    expect(asset?.origin).toBe("generated");
  });

  it("accepts camelCased ingest keys and the source_url original row", () => {
    const asset = mapMediaAssetForTest(
      { url: "https://x/b.png", jobId: "job-9", source_url: "https://cdn.tool.io/b.png" },
      "Asset audit",
      "attached",
    );
    expect(asset?.lineage).toEqual([
      ["ai", "Source job · job-9"],
      ["upload", "Original · cdn.tool.io"],
    ]);
  });

  it("leaves lineage empty and prompt null for plain media", () => {
    const asset = mapMediaAssetForTest("https://x/c.png", "Asset audit", "attached");
    expect(asset?.lineage).toEqual([]);
    expect(asset?.prompt).toBeNull();
  });
});

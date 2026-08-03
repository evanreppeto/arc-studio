import { describe, expect, it } from "vitest";

import { mapMediaAssetForTest } from "../read-model";

// Both of these facts were recorded on prod media entries all along and dropped
// by the mapper. The risk-flag half is the one that matters: a flag naming a
// specific image was invisible to the person pressing Approve.
describe("campaign media format + risk flags", () => {
  it("carries the declared aspect ratio and per-asset risk flags", () => {
    const asset = mapMediaAssetForTest(
      {
        url: "https://x/a.png",
        format: "9:16",
        risk_flags: ["privacy/redaction", "embedded text"],
      },
      "Asset audit",
      "attached",
    );

    expect(asset?.format).toBe("9:16");
    expect(asset?.riskFlags).toEqual(["privacy/redaction", "embedded text"]);
  });

  it("accepts the camelCased ingest spellings", () => {
    const asset = mapMediaAssetForTest(
      { url: "https://x/b.png", aspectRatio: "1:1", riskFlags: ["claim risk"] },
      "Asset audit",
      "attached",
    );

    expect(asset?.format).toBe("1:1");
    expect(asset?.riskFlags).toEqual(["claim risk"]);
  });

  it("normalizes the separators producers actually write", () => {
    expect(mapMediaAssetForTest({ url: "https://x/c.png", format: "16x9" }, "s", "attached")?.format).toBe("16:9");
    expect(mapMediaAssetForTest({ url: "https://x/d.png", format: " 4 : 3 " }, "s", "attached")?.format).toBe("4:3");
  });

  // The value reaches a CSS `aspect-ratio`, so anything that isn't a plain w:h
  // must be dropped rather than passed through to the stylesheet.
  it("rejects a ratio that isn't a sane w:h", () => {
    for (const format of ["", "wide", "16/", "0:3", "3:0", "100:1", "1:100", "4:3; transform: scale(9)"]) {
      expect(mapMediaAssetForTest({ url: "https://x/e.png", format }, "s", "attached")?.format).toBeNull();
    }
  });

  it("defaults to no declared format and no flags rather than inventing either", () => {
    const asset = mapMediaAssetForTest("https://x/f.png", "Asset audit", "attached");
    expect(asset?.format).toBeNull();
    expect(asset?.riskFlags).toEqual([]);
  });

  it("ignores a risk_flags payload that isn't a list of strings", () => {
    const asset = mapMediaAssetForTest(
      { url: "https://x/g.png", risk_flags: [{ flag: "privacy" }, "", "  ", "real flag"] },
      "Asset audit",
      "attached",
    );
    expect(asset?.riskFlags).toEqual(["real flag"]);
  });
});

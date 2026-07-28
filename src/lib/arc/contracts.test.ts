import { describe, expect, it } from "vitest";

import { parseArcPartnerCampaignRequest } from "./contracts";

describe("parseArcPartnerCampaignRequest creativeAssets", () => {
  it("defaults creativeAssets to an empty array", () => {
    const request = parseArcPartnerCampaignRequest({});
    expect(request.creativeAssets).toEqual([]);
  });

  it("accepts creative assets and applies the default type", () => {
    const request = parseArcPartnerCampaignRequest({
      creativeAssets: [
        { url: "https://cdn.example/hero.png" },
        { type: "video", url: "https://cdn.example/spot.mp4", title: "Hero spot" },
      ],
    });

    expect(request.creativeAssets).toHaveLength(2);
    expect(request.creativeAssets[0]).toMatchObject({ type: "image", url: "https://cdn.example/hero.png" });
    expect(request.creativeAssets[1]).toMatchObject({ type: "video", title: "Hero spot" });
  });

  it("rejects a creative asset with an invalid url", () => {
    expect(() =>
      parseArcPartnerCampaignRequest({ creativeAssets: [{ type: "image", url: "not-a-url" }] }),
    ).toThrow();
  });

  it("leaves restorationFocus unset when the caller never names one", () => {
    // It used to default to "water_backup", which stamped a restoration term
    // onto campaigns for law firms, dental practices, and agencies.
    const request = parseArcPartnerCampaignRequest({});

    expect(request.restorationFocus).toBeUndefined();
  });

  it("still honors an explicitly supplied restorationFocus", () => {
    const request = parseArcPartnerCampaignRequest({ restorationFocus: "burst_pipe" });

    expect(request.restorationFocus).toBe("burst_pipe");
  });
});

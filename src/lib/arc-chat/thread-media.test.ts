import { describe, expect, it } from "vitest";

import { toArcThreadMedia } from "./thread-media";

/**
 * Studio's copilot pane used to receive body + role only, so a reply that had
 * just rendered a creative arrived as a paragraph describing a picture the
 * operator could not see — in a tool whose whole job is looking at the picture,
 * under an empty state that promised "anything Arc renders shows up … on the
 * artboard, for your approval."
 *
 * The approval ids are the load-bearing part. Media without them is still worth
 * showing, but it cannot be approved, and the panel has to be able to tell the
 * difference rather than rendering a dead Approve button.
 */
describe("toArcThreadMedia", () => {
  it("carries the approval off the action card so the render is actionable", () => {
    const [media] = toArcThreadMedia({
      actions: [
        {
          kind: "draft",
          title: "Storm-season hero",
          rows: [],
          flags: [],
          media: { kind: "image", url: "https://cdn/a.png", format: "4:5" },
          approval: { kind: "campaign", campaignId: "camp-1", assetId: "asset-1" },
        },
      ],
    });
    expect(media).toMatchObject({
      url: "https://cdn/a.png",
      kind: "image",
      format: "4:5",
      campaignId: "camp-1",
      assetId: "asset-1",
    });
  });

  it("falls back to the card's title when the media has no caption of its own", () => {
    const [media] = toArcThreadMedia({
      actions: [{ kind: "draft", title: "Storm-season hero", rows: [], flags: [], media: { kind: "image", url: "https://cdn/a.png" } }],
    });
    expect(media.caption).toBe("Storm-season hero");
  });

  it("keeps reply-level media that no card claims, with no approval", () => {
    const [media] = toArcThreadMedia({ media: [{ kind: "video", url: "https://cdn/clip.mp4" }] });
    expect(media).toMatchObject({ kind: "video", url: "https://cdn/clip.mp4", campaignId: null, assetId: null });
  });

  it("prefers the card's copy when the same url appears in both", () => {
    // The runner writes to both. Reading metadata.media first would drop the
    // approval on the floor and turn an approvable draft into a picture.
    const out = toArcThreadMedia({
      media: [{ kind: "image", url: "https://cdn/a.png" }],
      actions: [
        {
          kind: "draft",
          title: "Hero",
          rows: [],
          flags: [],
          media: { kind: "image", url: "https://cdn/a.png" },
          approval: { kind: "campaign", campaignId: "camp-1", assetId: "asset-1" },
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].assetId).toBe("asset-1");
  });

  it("skips media with no url rather than emitting an unrenderable tile", () => {
    expect(toArcThreadMedia({ media: [{ kind: "image", url: "" }] })).toEqual([]);
    expect(toArcThreadMedia({})).toEqual([]);
  });
});

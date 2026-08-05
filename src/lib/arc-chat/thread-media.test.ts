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
 *
 * The fixtures below are the shapes a prod census found (2026-08-05, all 51 Arc
 * replies), not invented ones — see the note in thread-media.ts. Prod is the
 * authority on what the runner writes; anything here that drifts from it is
 * testing a contract nobody implements.
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

  /**
   * Not an edge case — the NORMAL case. `media.caption` was null on all five
   * media-bearing cards on prod, so the card's title is what names every tile an
   * operator actually sees. If this fallback goes, every thumbnail loses its label
   * at once and the tests would still be green without this.
   */
  it("names the tile from the card's title, which is where the name really is", () => {
    const [media] = toArcThreadMedia({
      actions: [
        {
          kind: "draft",
          title: "Service Van — Driveway Morning (Logo Added)",
          rows: [],
          flags: [],
          // Real prod key set: no caption, format present, source/riskFlags alongside.
          media: { kind: "image", url: "https://cdn/van.png", format: "1:1", source: "composite" },
          approval: { kind: "campaign", campaignId: "camp-1", assetId: "asset-1" },
        },
      ],
    });
    expect(media.caption).toBe("Service Van — Driveway Morning (Logo Added)");
  });

  /**
   * Both real traffic: 4 of the 5 media cards on prod carried an approval, 1 did
   * not. The approval-less one has to survive as a viewable-but-not-approvable
   * tile, or Arc generates something and the panel shows nothing at all.
   */
  it("keeps a media card that carries no approval, marked as having none", () => {
    const [media] = toArcThreadMedia({
      actions: [
        {
          kind: "draft",
          title: "Autumn Front Porch — Steps with Leaves",
          rows: [],
          flags: [],
          media: { kind: "image", url: "https://cdn/porch.png", format: "4:3", source: "ai_generated" },
        },
      ],
    });
    expect(media).toMatchObject({ url: "https://cdn/porch.png", campaignId: null, assetId: null });
  });

  /**
   * `format` is free text from the runner. "4:3" appears on prod and is not one of
   * Studio's four formats — it is displayed on the badge, never looked up, so it
   * must pass through rather than being normalised or dropped.
   */
  it("passes a format through even when Studio has no such format", () => {
    const [media] = toArcThreadMedia({
      actions: [{ kind: "draft", title: "Porch", rows: [], flags: [], media: { kind: "image", url: "https://cdn/p.png", format: "4:3" } }],
    });
    expect(media.format).toBe("4:3");
  });

  /**
   * Reply-level media was populated on ZERO of 51 prod replies — the runner
   * writes creative to action cards only. This branch is kept for a runner that
   * starts filling it, so the test documents it as the unused path it is rather
   * than implying parity with cards.
   */
  it("still reads reply-level media, the branch prod has never exercised", () => {
    const [media] = toArcThreadMedia({ media: [{ kind: "video", url: "https://cdn/clip.mp4" }] });
    expect(media).toMatchObject({ kind: "video", url: "https://cdn/clip.mp4", campaignId: null, assetId: null });
  });

  /**
   * The 12 approval-bearing cards on prod with no media are email / SMS / landing
   * page / paid-social COPY, not pictures. Studio is the image surface; they are
   * reviewed on the campaign page. Emitting a tile with no url for them would put
   * an unrenderable thumbnail in the thread for every text draft Arc writes.
   */
  it("emits nothing for a text draft that has an approval but no picture", () => {
    expect(
      toArcThreadMedia({
        actions: [
          {
            kind: "draft",
            title: 'Email — "The next clear step after water in your home"',
            rows: [],
            flags: [],
            preview: "Subject: Water in your home? Here's the next clear step.",
            approval: { kind: "campaign", campaignId: "camp-1", assetId: "asset-1" },
          },
        ],
      }),
    ).toEqual([]);
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

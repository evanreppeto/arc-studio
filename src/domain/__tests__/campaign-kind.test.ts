import { describe, expect, it } from "vitest";

import { isCreativeOnlyCampaign, resolveCampaignKind } from "../campaign-kind";

describe("isCreativeOnlyCampaign", () => {
  /** The two rows that were sitting in the live "Needs you" queue. */
  it("classifies a pure generation batch", () => {
    expect(isCreativeOnlyCampaign(["image_prompt", "image_prompt", "image_prompt"])).toBe(true);
    expect(isCreativeOnlyCampaign(["video_prompt"])).toBe(true);
    expect(isCreativeOnlyCampaign(["image_prompt", "video_prompt"])).toBe(true);
  });

  /**
   * The row this predicate exists to protect.
   *
   * "Pre-Winter Pipe & Water-Heater Check" on prod holds an email, an image
   * prompt and a social ad. A rule keyed on *containing* creative would file a
   * real outbound campaign as a batch and pull it out of the approval queue.
   */
  it("does not classify a campaign that merely contains creative", () => {
    expect(isCreativeOnlyCampaign(["email", "image_prompt", "social_ad"])).toBe(false);
    expect(isCreativeOnlyCampaign(["image_prompt", "sms"])).toBe(false);
  });

  it("leaves ordinary campaigns alone", () => {
    expect(isCreativeOnlyCampaign(["email", "sms", "landing_page"])).toBe(false);
    expect(isCreativeOnlyCampaign(["social_ad"])).toBe(false);
  });

  /**
   * A composed creative is a finished ad, written as `social_ad` by Studio's
   * compose path. It belongs to a campaign and must not be swept up here.
   */
  it("does not treat a composed ad as raw creative", () => {
    expect(isCreativeOnlyCampaign(["social_ad", "social_ad"])).toBe(false);
  });

  /**
   * An empty campaign is one Arc has not finished building. It already has its
   * own line on the board ("Arc is still building it") and is not a batch.
   */
  it("does not classify an empty campaign", () => {
    expect(isCreativeOnlyCampaign([])).toBe(false);
    expect(isCreativeOnlyCampaign(["", "   "])).toBe(false);
  });

  /**
   * The read-model humanizes `asset_type` before some callers see it, so the
   * same campaign reaches this function as "image_prompt" on one path and
   * "Image Prompt" on another. Answering differently by spelling would make the
   * board's grouping depend on which code path assembled the row.
   */
  it("reads raw enum values and humanized labels the same way", () => {
    expect(isCreativeOnlyCampaign(["Image Prompt", "Image Prompt"])).toBe(true);
    expect(isCreativeOnlyCampaign(["Video Prompt"])).toBe(true);
    expect(isCreativeOnlyCampaign(["image-prompt"])).toBe(true);
    expect(isCreativeOnlyCampaign(["Email", "Image Prompt"])).toBe(false);
  });
});

describe("resolveCampaignKind", () => {
  /** Declared wins, because contents move and intent does not. */
  it("prefers what was declared at creation", () => {
    expect(resolveCampaignKind("creative_batch", ["email", "sms"])).toBe("creative_batch");
    expect(resolveCampaignKind("campaign", ["image_prompt", "image_prompt"])).toBe("campaign");
  });

  /**
   * The case the column exists for. Arc often writes creative before copy, so a
   * real campaign is briefly all-creative. Derived, it files under "Creative
   * from Studio" and moves to the approval queue when the email lands — the
   * same work appearing twice, in two places.
   */
  it("holds a declared campaign steady while it is still creative-only", () => {
    expect(resolveCampaignKind("campaign", ["image_prompt"])).toBe("campaign");
    expect(resolveCampaignKind("campaign", ["image_prompt", "video_prompt"])).toBe("campaign");
  });

  /** NULL means nobody declared it — every existing row. Derive, as before. */
  it("falls back to the deliverables when undeclared", () => {
    expect(resolveCampaignKind(null, ["image_prompt", "image_prompt"])).toBe("creative_batch");
    expect(resolveCampaignKind(null, ["email", "image_prompt"])).toBe("campaign");
    expect(resolveCampaignKind(undefined, ["image_prompt"])).toBe("creative_batch");
    expect(resolveCampaignKind(null, [])).toBe("campaign");
  });

  /** A junk value is not a declaration. The CHECK stops it at the DB; this
   *  stops a hand-written row or a future value from silently winning. */
  it("ignores a value it does not recognise", () => {
    expect(resolveCampaignKind("batch", ["image_prompt"])).toBe("creative_batch");
    expect(resolveCampaignKind("", ["email"])).toBe("campaign");
  });
});

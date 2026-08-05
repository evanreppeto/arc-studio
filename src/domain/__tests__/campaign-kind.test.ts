import { describe, expect, it } from "vitest";

import { isCreativeOnlyCampaign } from "../campaign-kind";

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

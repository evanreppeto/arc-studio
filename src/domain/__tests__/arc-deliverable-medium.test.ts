import { describe, expect, it } from "vitest";

import { arcDeliverableMedium } from "@/domain";

/** The `channel` values below are the ones prod actually stores (raw runner
 *  values) plus the display forms the chat cards carry. */
describe("arcDeliverableMedium", () => {
  it("classifies the raw channel values stored in prod", () => {
    expect(arcDeliverableMedium({ channel: "email" })).toBe("email");
    expect(arcDeliverableMedium({ channel: "sms" })).toBe("sms");
    expect(arcDeliverableMedium({ channel: "meta_ad" })).toBe("social");
    expect(arcDeliverableMedium({ channel: "web" })).toBe("page");
    expect(arcDeliverableMedium({ channel: "doc" })).toBe("doc");
  });

  it("classifies the display forms the chat cards carry", () => {
    expect(arcDeliverableMedium({ channel: "Email", format: "64-account segment" })).toBe("email");
    expect(arcDeliverableMedium({ channel: "SMS", format: "152 / 160 chars" })).toBe("sms");
    expect(arcDeliverableMedium({ channel: "Paid social", format: "1:1 · Meta" })).toBe("social");
    expect(arcDeliverableMedium({ channel: "Landing page", format: "Mobile-ready" })).toBe("page");
    expect(arcDeliverableMedium({ channel: "One-pager", format: "pdf" })).toBe("doc");
  });

  /** `one-pager` and `landing page` both contain "page". A doc rendered as a
   *  landing-page hero misstates what will ship. */
  it("reads a one-pager as a document, not a page", () => {
    expect(arcDeliverableMedium({ channel: "One-pager" })).toBe("doc");
    expect(arcDeliverableMedium({ channel: "one pager", format: "pdf" })).toBe("doc");
    expect(arcDeliverableMedium({ channel: "Partner handoff note" })).toBe("doc");
  });

  it("does not read 'ad' out of the middle of an ordinary word", () => {
    expect(arcDeliverableMedium({ channel: "Readiness brief" })).toBe("doc");
    expect(arcDeliverableMedium({ channel: "Roadmap" })).toBe("generic");
  });

  it("falls back to generic rather than guessing", () => {
    expect(arcDeliverableMedium({ channel: "" })).toBe("generic");
    expect(arcDeliverableMedium({})).toBe("generic");
    expect(arcDeliverableMedium({ channel: "Carrier pigeon" })).toBe("generic");
  });

  it("reads the format when the channel is silent", () => {
    expect(arcDeliverableMedium({ channel: null, format: "pdf" })).toBe("doc");
  });
});

import { describe, expect, it } from "vitest";

import { inferMediaCategory, resolveArcModelRoute } from "./model-routing";

describe("resolveArcModelRoute", () => {
  it("preserves an explicit Spark or Forge choice", () => {
    expect(resolveArcModelRoute({ preference: "fast", request: "Build a campaign" })).toBe("fast");
    expect(resolveArcModelRoute({ preference: "standard", request: "Hello" })).toBe("standard");
  });

  it("uses Spark for conversation, research, and analysis in auto mode", () => {
    expect(resolveArcModelRoute({ preference: "auto", request: "Hello, what can you help me with?" })).toBe("fast");
    expect(resolveArcModelRoute({ preference: "auto", request: "Find and rank our strongest leads" })).toBe("fast");
    expect(resolveArcModelRoute({ preference: "auto", request: "Analyze campaign performance" })).toBe("fast");
    expect(resolveArcModelRoute({ preference: "auto", command: "find-leads" })).toBe("fast");
  });

  it("reserves Forge for creation and workspace actions in auto mode", () => {
    expect(resolveArcModelRoute({ preference: "auto", request: "Draft a follow-up email" })).toBe("standard");
    expect(resolveArcModelRoute({ preference: "auto", request: "Update this lead's status" })).toBe("standard");
  });
});

describe("inferMediaCategory", () => {
  it("reads a clip request as video", () => {
    for (const request of [
      "make me a short video for the fall push",
      "animate this photo",
      "cut a 15s reel from the before/after",
      "we need b-roll of the van",
    ]) {
      expect(inferMediaCategory(request)).toBe("video");
    }
  });

  it("defaults to image for everything else", () => {
    // Image is the cheap wrong answer: a mis-attributed pick is dropped by the
    // resolver and auto-picks, where defaulting to video would mis-attribute
    // nearly every turn.
    for (const request of ["draft a campaign for spring", "make a square ad", "", "hello"]) {
      expect(inferMediaCategory(request)).toBe("image");
    }
  });

  it("does not fire on a word that merely contains a trigger", () => {
    expect(inferMediaCategory("write the reelection announcement")).toBe("image");
    expect(inferMediaCategory("check the emotional tone")).toBe("image");
  });

  it("treats a missing request as image rather than throwing", () => {
    expect(inferMediaCategory(null)).toBe("image");
    expect(inferMediaCategory(undefined)).toBe("image");
  });
});

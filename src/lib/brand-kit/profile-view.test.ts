import { describe, expect, it } from "vitest";

import { NEUTRAL_DEFAULTS, type BusinessProfile } from "@/domain";

import { toBrandProfileView } from "./profile-view";

const PROFILE: BusinessProfile = {
  ...NEUTRAL_DEFAULTS,
  displayName: "Summit Restoration",
  legalName: "Summit Restoration, LLC",
  tagline: "Water damage, handled.",
  industry: "restoration",
  websiteUrl: "https://summit.example",
  serviceAreas: ["north shore"],
  tone: "warm, trustworthy",
  voiceGuidance: "Speak plainly.",
  preferredPhrases: ["licensed"],
  bannedPhrases: ["cheapest"],
  services: ["Water mitigation"],
  proofPoints: [
    { kind: "certification", label: "IICRC certified" },
    { kind: "stat", label: "Google 4.9/5", detail: "800+ reviews" },
  ],
  guardrails: { disallowedClaims: ["No guaranteed outcomes"], complianceNotes: "" },
  brandPalette: {
    primary: { label: "Deep Blue", hex: "#123456" },
    secondary: { label: "", hex: "" }, // empty slot → dropped
    accent: { label: "Amber", hex: "#f2a93b" },
    dark: { label: "Ink", hex: "#111418" },
    light: { label: "Paper", hex: "#f5f7fa" },
    headingFont: "Fraunces",
    bodyFont: "Geist",
  },
  status: "active",
};

describe("toBrandProfileView", () => {
  it("maps a full profile into the Brand screen view-model", () => {
    const view = toBrandProfileView(PROFILE, [], false, "Fallback");

    expect(view.identity.name).toBe("Summit Restoration");
    expect(view.identity.published).toBe(true);
    expect(view.identity.segments).toEqual(["Restoration", "North Shore"]);
    // Empty palette slots are dropped; roles are assigned in slot order.
    expect(view.palette.map((p) => p.role)).toEqual(["Primary", "Accent", "Ink", "Paper"]);
    expect(view.palette.every((p) => /^#[0-9a-f]{6}$/i.test(p.hex))).toBe(true);
    // A comma-separated tone field becomes multiple title-cased chips.
    expect(view.tone).toEqual(["Warm", "Trustworthy"]);
    // Proof points render "label — detail" when a detail is present.
    expect(view.proofPoints).toEqual(["IICRC certified", "Google 4.9/5 — 800+ reviews"]);
    expect(view.services).toEqual(["Water mitigation"]);
    expect(view.guardrails).toEqual(["No guaranteed outcomes"]);
    expect(view.headingFont).toBe("Fraunces");
  });

  it("falls back to the given name and yields an empty palette for neutral defaults", () => {
    const view = toBrandProfileView(NEUTRAL_DEFAULTS, [], false, "My Workspace");
    expect(view.identity.name).toBe("My Workspace");
    expect(view.identity.published).toBe(false);
    expect(view.palette).toEqual([]);
    expect(view.proofPoints).toEqual([]);
    expect(view.identity.logoUrl).toBeNull();
  });

  it("surfaces only a fetchable logo — the creative renderer fetches this URL", () => {
    const withLogo = toBrandProfileView({ ...PROFILE, logoUrl: "https://cdn.example/logo.png" }, [], false, "Fallback");
    expect(withLogo.identity.logoUrl).toBe("https://cdn.example/logo.png");

    // A relative path or a data: URL would 404 or bloat the render, so it is not
    // presented as the brand mark.
    for (const bad of ["/brand/logo.png", "data:image/png;base64,iVBORw0KGgo=", ""]) {
      expect(toBrandProfileView({ ...PROFILE, logoUrl: bad }, [], false, "Fallback").identity.logoUrl).toBeNull();
    }
    expect(toBrandProfileView({ ...PROFILE, logoUrl: null }, [], false, "Fallback").identity.logoUrl).toBeNull();
  });
});

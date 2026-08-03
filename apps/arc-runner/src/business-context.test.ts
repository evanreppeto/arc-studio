import { describe, expect, it, vi } from "vitest";
import { NEUTRAL_CONTEXT, fromAppContext, resolveBusinessContext, type AppBusinessContext } from "./business-context";
import type { ArcClient } from "./arc-client";

const emptyColor = { label: "", hex: "" };

const APP: AppBusinessContext = {
  businessName: "Acme Co",
  industry: "plumbing",
  services: ["repairs", "installs"],
  tone: "friendly",
  voiceGuidance: "Be concise.",
  preferredPhrases: ["fast response"],
  bannedPhrases: ["cheap", "guaranteed"],
  proofPoints: [{ kind: "stat", label: "20 years in business" }],
  brainFacts: ["Messaging: mention weekend support"],
  personas: [{ key: "homeowner", label: "Homeowner" }],
  guardrails: { disallowedClaims: ["same-day always"], complianceNotes: "Stay licensed-scope." },
  palette: { primary: emptyColor, secondary: emptyColor, accent: emptyColor, dark: emptyColor, light: emptyColor, headingFont: "", bodyFont: "" },
  logoUrl: null,
  tagline: null,
  description: null,
  websiteUrl: null,
  serviceAreas: [],
};

const baseApp: AppBusinessContext = {
  businessName: "BSR", industry: "Restoration", services: [], tone: "calm", voiceGuidance: null,
  preferredPhrases: [], bannedPhrases: [], proofPoints: [], personas: [],
  brainFacts: [],
  guardrails: { disallowedClaims: [], complianceNotes: "" },
  palette: { primary: { label: "Navy", hex: "#1B2A4A" }, secondary: emptyColor, accent: { label: "Gold", hex: "#C8A24B" }, dark: emptyColor, light: emptyColor, headingFont: "Oswald", bodyFont: "" },
  logoUrl: "https://x/logo.png", tagline: "Chicago's crew", description: null, websiteUrl: "https://bsr.com", serviceAreas: ["Chicago"],
};

describe("fromAppContext", () => {
  it("folds brand fields into the runner's 5-field shape", () => {
    const c = fromAppContext(APP);
    expect(c.businessName).toBe("Acme Co");
    expect(c.industry).toContain("plumbing");
    expect(c.industry).toContain("repairs");
    expect(c.brandVoice).toContain("friendly");
    expect(c.brandVoice).toContain("fast response");
    expect(c.brandVoice).toContain("cheap"); // banned phrases surfaced as "never use"
    expect(c.compliance).toContain("Stay licensed-scope.");
    expect(c.compliance).toContain("same-day always");
    expect(c.creativePolicy).toContain("20 years in business");
    expect(c.brandVoice).toContain("Messaging: mention weekend support");
  });
});

describe("resolveBusinessContext", () => {
  it("maps the fetched app context", async () => {
    const client = { apiGet: vi.fn(async () => ({ context: APP })) } as unknown as ArcClient;
    const c = await resolveBusinessContext(client);
    expect(c.businessName).toBe("Acme Co");
    expect(client.apiGet).toHaveBeenCalledWith("/api/v1/arc/brand/context");
  });

  it("falls back to neutral context when the fetch fails", async () => {
    const client = { apiGet: vi.fn(async () => { throw new Error("boom"); }) } as unknown as ArcClient;
    const c = await resolveBusinessContext(client);
    expect(c).toEqual(NEUTRAL_CONTEXT);
  });
});

describe("fromAppContext brand identity", () => {
  it("renders palette colors, fonts, logo, tagline, website, service areas", () => {
    const ctx = fromAppContext(baseApp);
    const text = JSON.stringify(ctx);
    expect(text).toContain("#1B2A4A");
    expect(text).toContain("Navy");
    expect(text).toContain("#C8A24B");
    expect(text).toContain("Oswald");
    expect(text).toContain("https://x/logo.png");
    expect(text).toContain("Chicago's crew");
    expect(text).toContain("https://bsr.com");
  });
  it("carries the operator's business description into the prompt", () => {
    const ctx = fromAppContext({ ...baseApp, description: "Water, fire, and mold restoration for Chicago homeowners." });
    expect(ctx.brandVoice).toContain("Water, fire, and mold restoration for Chicago homeowners.");
  });
  it("omits the description when the operator has not written one", () => {
    expect(fromAppContext({ ...baseApp, description: null }).brandVoice).not.toContain("About:");
  });
  it("omits empty palette slots and empty identity fields", () => {
    const ctx = fromAppContext({ ...baseApp, palette: { ...baseApp.palette, primary: emptyColor, accent: emptyColor, headingFont: "", bodyFont: "" }, logoUrl: null, tagline: null });
    const text = JSON.stringify(ctx);
    expect(text).not.toContain("Navy");
    expect(text).not.toContain("logo.png");
  });
});

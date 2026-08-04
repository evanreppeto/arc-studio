import { describe, expect, it } from "vitest";
import {
  NEUTRAL_DEFAULTS,
  NEUTRAL_PERSONAS,
  parseBusinessProfile,
  validateBusinessProfile,
  INDUSTRY_TEMPLATES,
  getIndustryTemplate,
  assembleArcContext,
  parseBrandPalette,
  EMPTY_BRAND_PALETTE,
  mergeBrandPalette,
  applyBrandPaletteEdit,
  type BusinessProfile,
  type PersonaDefinition,
  type ArcBusinessContext,
} from "@/domain/brand-kit";

describe("mergeBrandPalette", () => {
  it("fills empty slots from a vision palette, normalizes hex, keeps set slots, ignores invalid", () => {
    const current = { ...EMPTY_BRAND_PALETTE, primary: { label: "Brand", hex: "#123456" } };
    const result = mergeBrandPalette(current, {
      primary: { label: "New", hex: "#999999" }, // already set → ignored
      secondary: { label: "Teal", hex: "#18B4A6" }, // fills, lowercased
      accent: { label: "Amber", hex: "f2a93b" }, // missing # → normalized
      dark: { label: "Bad", hex: "not-a-hex" }, // invalid → ignored
      headingFont: "Fraunces",
    });
    expect(result.primary).toEqual({ label: "Brand", hex: "#123456" });
    expect(result.secondary).toEqual({ label: "Teal", hex: "#18b4a6" });
    expect(result.accent).toEqual({ label: "Amber", hex: "#f2a93b" });
    expect(result.dark).toEqual({ label: "", hex: "" });
    expect(result.headingFont).toBe("Fraunces");
    expect(result.bodyFont).toBe("");
  });

  it("returns the current palette unchanged when the update is null", () => {
    expect(mergeBrandPalette(EMPTY_BRAND_PALETTE, null)).toEqual(EMPTY_BRAND_PALETTE);
  });
});

describe("NEUTRAL_DEFAULTS", () => {
  it("is industry-agnostic: no services, no restoration assumptions, draft status", () => {
    expect(NEUTRAL_DEFAULTS.services).toEqual([]);
    expect(NEUTRAL_DEFAULTS.status).toBe("draft");
    expect(NEUTRAL_DEFAULTS.density).toBe("comfortable");
    expect(NEUTRAL_DEFAULTS.motion).toBe("standard");
    const serialized = JSON.stringify(NEUTRAL_DEFAULTS).toLowerCase();
    expect(serialized).not.toContain("restoration");
    expect(serialized).not.toContain("water");
  });

  it("ships universally-safe guardrails only", () => {
    expect(NEUTRAL_DEFAULTS.guardrails.disallowedClaims.length).toBeGreaterThan(0);
    const claims = NEUTRAL_DEFAULTS.guardrails.disallowedClaims.join(" ").toLowerCase();
    expect(claims).not.toContain("insurance");
  });

  it("provides generic starter personas", () => {
    const keys = NEUTRAL_PERSONAS.map((p) => p.key);
    expect(keys).toContain("decision_maker");
    expect(NEUTRAL_PERSONAS.every((p) => p.label.length > 0)).toBe(true);
  });
});

describe("parseBusinessProfile", () => {
  it("maps a snake_case DB row to a BusinessProfile, applying defaults for nulls", () => {
    const profile = parseBusinessProfile({
      display_name: "Acme Co",
      services: ["consulting"],
      accent: null,
      density: null,
      guardrails: { disallowedClaims: ["x"], complianceNotes: "y" },
      status: "active",
    });
    expect(profile.displayName).toBe("Acme Co");
    expect(profile.services).toEqual(["consulting"]);
    expect(profile.accent).toBe(NEUTRAL_DEFAULTS.accent);
    expect(profile.density).toBe("comfortable");
    expect(profile.guardrails.complianceNotes).toBe("y");
    expect(profile.status).toBe("active");
  });

  it("falls back to neutral defaults when given an empty object", () => {
    const profile = parseBusinessProfile({});
    expect(profile.status).toBe("draft");
    expect(profile.services).toEqual([]);
    expect(profile.guardrails.disallowedClaims).toEqual(
      NEUTRAL_DEFAULTS.guardrails.disallowedClaims,
    );
  });
});

describe("validateBusinessProfile", () => {
  it("rejects an empty display name", () => {
    const result = validateBusinessProfile({ ...NEUTRAL_DEFAULTS, displayName: "  " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("display_name_required");
  });

  it("rejects a non-hex accent", () => {
    const result = validateBusinessProfile({ ...NEUTRAL_DEFAULTS, displayName: "Acme", accent: "blue" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("accent_invalid");
  });

  it("accepts a valid profile", () => {
    const result = validateBusinessProfile({ ...NEUTRAL_DEFAULTS, displayName: "Acme", accent: "#1A2B3C" });
    expect(result.ok).toBe(true);
  });
});

describe("INDUSTRY_TEMPLATES", () => {
  it("includes broad buckets and a neutral start, all equal citizens", () => {
    const ids = INDUSTRY_TEMPLATES.map((t) => t.id);
    expect(ids).toContain("neutral");
    expect(ids).toContain("home_property_services");
    expect(ids).toContain("professional_services");
    // restoration is NOT a top-level bucket; it is only a flavor under home/property
    expect(ids).not.toContain("restoration");
    expect(INDUSTRY_TEMPLATES.length).toBeGreaterThanOrEqual(6);
  });

  it("every non-neutral template pre-fills personas and services", () => {
    for (const tpl of INDUSTRY_TEMPLATES) {
      if (tpl.id === "neutral") continue;
      expect(tpl.personas.length).toBeGreaterThan(0);
      expect(tpl.profile.services && tpl.profile.services.length).toBeGreaterThan(0);
    }
  });

  it("getIndustryTemplate returns the neutral template for an unknown id", () => {
    expect(getIndustryTemplate("does_not_exist").id).toBe("neutral");
    expect(getIndustryTemplate("professional_services").id).toBe("professional_services");
  });
});

describe("assembleArcContext", () => {
  it("derives the business name and carries voice, services, and guardrails", () => {
    const profile: BusinessProfile = { ...NEUTRAL_DEFAULTS, displayName: "Acme Co", services: ["consulting"], tone: "professional" };
    const ctx: ArcBusinessContext = assembleArcContext(profile, NEUTRAL_PERSONAS);
    expect(ctx.businessName).toBe("Acme Co");
    expect(ctx.services).toEqual(["consulting"]);
    expect(ctx.tone).toBe("professional");
    expect(ctx.guardrails.disallowedClaims.length).toBeGreaterThan(0);
    expect(ctx.personas.map((p) => p.key)).toContain("decision_maker");
  });

  it("uses a safe placeholder name when displayName is blank", () => {
    const ctx = assembleArcContext(NEUTRAL_DEFAULTS, []);
    expect(ctx.businessName).toBe("the business");
    expect(ctx.personas).toEqual([]);
  });

  it("only includes active personas, sorted by sortOrder", () => {
    const personas: PersonaDefinition[] = [
      { key: "b", label: "B", audienceType: "customer", sortOrder: 2, isActive: true, metadata: {} },
      { key: "a", label: "A", audienceType: "customer", sortOrder: 1, isActive: true, metadata: {} },
      { key: "x", label: "X", audienceType: "customer", sortOrder: 0, isActive: false, metadata: {} },
    ];
    const ctx = assembleArcContext({ ...NEUTRAL_DEFAULTS, displayName: "Acme" }, personas);
    expect(ctx.personas.map((p) => p.key)).toEqual(["a", "b"]);
  });

  it("can carry approved Brain facts for the agent runtime", () => {
    const ctx = assembleArcContext({ ...NEUTRAL_DEFAULTS, displayName: "Acme" }, [], [
      "Messaging: Use a calm expert voice.",
      "Proof: IICRC certified.",
    ]);

    expect(ctx.brainFacts).toEqual([
      "Messaging: Use a calm expert voice.",
      "Proof: IICRC certified.",
    ]);
  });
});

describe("assembleArcContext brand identity", () => {
  it("includes palette + visual identity fields", () => {
    const profile = {
      ...NEUTRAL_DEFAULTS, displayName: "BSR", logoUrl: "https://x/logo.png",
      tagline: "Chicago's restoration crew", description: "We restore.", websiteUrl: "https://bsr.com",
      serviceAreas: ["Chicago", "Suburbs"],
      brandPalette: { ...NEUTRAL_DEFAULTS.brandPalette, accent: { label: "Gold", hex: "#C8A24B" }, headingFont: "Oswald" },
    };
    const ctx = assembleArcContext(profile, NEUTRAL_PERSONAS, []);
    expect(ctx.logoUrl).toBe("https://x/logo.png");
    expect(ctx.tagline).toBe("Chicago's restoration crew");
    expect(ctx.websiteUrl).toBe("https://bsr.com");
    expect(ctx.serviceAreas).toEqual(["Chicago", "Suburbs"]);
    expect(ctx.palette.accent).toEqual({ label: "Gold", hex: "#C8A24B" });
    expect(ctx.palette.headingFont).toBe("Oswald");
  });
});

describe("parseBrandPalette", () => {
  it("maps a full jsonb palette", () => {
    const p = parseBrandPalette({
      primary: { label: "Navy", hex: "#1B2A4A" }, secondary: { label: "", hex: "#C8A24B" },
      accent: { label: "Gold", hex: "#C8A24B" }, dark: { hex: "#101317" }, light: { hex: "#FFFFFF" },
      headingFont: "Oswald", bodyFont: "Inter",
    });
    expect(p.primary).toEqual({ label: "Navy", hex: "#1B2A4A" });
    expect(p.dark).toEqual({ label: "", hex: "#101317" });
    expect(p.headingFont).toBe("Oswald");
  });
  it("defaults missing keys to empty color/font", () => {
    const p = parseBrandPalette({ primary: { hex: "#1B2A4A" } });
    expect(p.primary).toEqual({ label: "", hex: "#1B2A4A" });
    expect(p.secondary).toEqual({ label: "", hex: "" });
    expect(p.bodyFont).toBe("");
  });
  it("returns an all-empty palette for null/garbage", () => {
    expect(parseBrandPalette(null).accent).toEqual({ label: "", hex: "" });
    expect(parseBrandPalette("nope").headingFont).toBe("");
  });
});

describe("parseBusinessProfile brandPalette", () => {
  it("reads brand_palette jsonb", () => {
    const profile = parseBusinessProfile({ display_name: "BSR", brand_palette: { accent: { label: "Gold", hex: "#C8A24B" } } });
    expect(profile.brandPalette.accent).toEqual({ label: "Gold", hex: "#C8A24B" });
  });
  it("defaults to an empty palette when the column is absent", () => {
    expect(parseBusinessProfile({ display_name: "BSR" }).brandPalette).toEqual(NEUTRAL_DEFAULTS.brandPalette);
  });
});

describe("validateBusinessProfile palette hex", () => {
  const base = { ...NEUTRAL_DEFAULTS, displayName: "BSR" };
  it("allows empty palette values", () => {
    expect(validateBusinessProfile(base).ok).toBe(true);
  });
  it("rejects a malformed palette hex", () => {
    const bad = { ...base, brandPalette: { ...base.brandPalette, primary: { label: "", hex: "1B2A4A" } } };
    const r = validateBusinessProfile(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("palette_primary_invalid");
  });
});

// An operator editing their own palette needs the opposite semantics to
// mergeBrandPalette (which serves machine extraction). These tests pin the
// difference, because getting it wrong shows a saved-looking screen carrying the
// previous colour — the state in which someone approves off-brand creative.
describe("applyBrandPaletteEdit", () => {
  const current = {
    ...EMPTY_BRAND_PALETTE,
    primary: { label: "Brand", hex: "#123456" },
    headingFont: "Fraunces",
  };

  it("overwrites a slot the operator has already set", () => {
    const r = applyBrandPaletteEdit(current, { colors: { primary: { label: "New", hex: "#ABCDEF" } } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.palette.primary).toEqual({ label: "New", hex: "#abcdef" });
  });

  it("normalizes a hex typed without the hash, and lowercases it", () => {
    const r = applyBrandPaletteEdit(current, { colors: { accent: { label: "Gold", hex: "C8A24B" } } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.palette.accent).toEqual({ label: "Gold", hex: "#c8a24b" });
  });

  it("reports a malformed hex instead of silently keeping the old colour", () => {
    const r = applyBrandPaletteEdit(current, { colors: { primary: { label: "Brand", hex: "nope" } } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("primary");
  });

  it("clears a slot, and its label with it, on an empty hex", () => {
    const r = applyBrandPaletteEdit(current, { colors: { primary: { label: "Brand", hex: "  " } } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.palette.primary).toEqual({ label: "", hex: "" });
  });

  it("leaves slots the edit never mentions untouched", () => {
    const r = applyBrandPaletteEdit(current, { colors: { accent: { label: "Gold", hex: "#c8a24b" } } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.palette.primary).toEqual({ label: "Brand", hex: "#123456" });
      expect(r.palette.headingFont).toBe("Fraunces");
    }
  });

  it("sets fonts only when the edit names them", () => {
    const untouched = applyBrandPaletteEdit(current, { bodyFont: "Geist" });
    expect(untouched.ok).toBe(true);
    if (untouched.ok) {
      expect(untouched.palette.headingFont).toBe("Fraunces");
      expect(untouched.palette.bodyFont).toBe("Geist");
    }
  });
});

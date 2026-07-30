import { describe, expect, it } from "vitest";

import { DEFAULT_PERSONAS } from "@/lib/personas/default-personas";
import { isKnownIndustry, personasForIndustry } from "@/lib/personas/industry-templates";
import { canonicalIndustryKey, getProductLanguage } from "@/lib/product-language";

import { INDUSTRIES, INDUSTRY_SLUGS, getIndustry } from "./industries";

describe("industry landing pages", () => {
  it("every page points at a real industry template", () => {
    // The whole promise of these pages is that the vocabulary and personas they
    // show are the ones onboarding actually produces. A key that isn't a real
    // template silently falls back to `general`, so the page would render a
    // generic vocabulary while claiming to speak the trade's language — the
    // exact broken promise BSR-584 exists to prevent.
    for (const industry of INDUSTRIES) {
      expect(isKnownIndustry(industry.industryKey), `${industry.slug} key`).toBe(true);
    }
  });

  it("resolves each key to a non-default persona pack", () => {
    // A real key that still yields DEFAULT_PERSONAS means the page's persona
    // block is the neutral set dressed up as industry-specific.
    for (const industry of INDUSTRIES) {
      const personas = personasForIndustry(industry.industryKey);
      expect(personas.length, `${industry.slug} personas`).toBeGreaterThan(0);
      expect(personas, `${industry.slug} personas are industry-specific`).not.toBe(
        DEFAULT_PERSONAS,
      );
    }
  });

  it("resolves each key to industry vocabulary, not the general fallback", () => {
    const general = getProductLanguage("general");
    for (const industry of INDUSTRIES) {
      const language = getProductLanguage(industry.industryKey);
      expect(language.industry, `${industry.slug} language key`).toBe(industry.industryKey);
      // At least one object label must differ from the neutral set, or the page
      // is claiming a tailored vocabulary it does not actually get.
      const differs = (Object.keys(language.crmObjects) as Array<
        keyof typeof language.crmObjects
      >).some((k) => language.crmObjects[k].label !== general.crmObjects[k].label);
      expect(differs, `${industry.slug} vocabulary differs from general`).toBe(true);
    }
  });

  it("keeps industryKey canonical so it matches what onboarding stores", () => {
    for (const industry of INDUSTRIES) {
      expect(canonicalIndustryKey(industry.industryKey)).toBe(industry.industryKey);
    }
  });

  it("has unique slugs and resolves each one", () => {
    expect(new Set(INDUSTRY_SLUGS).size).toBe(INDUSTRY_SLUGS.length);
    for (const slug of INDUSTRY_SLUGS) {
      expect(getIndustry(slug)?.slug).toBe(slug);
    }
    expect(getIndustry("not-an-industry")).toBeUndefined();
  });

  it("gives every page the trade-specific substance the shared keys depend on", () => {
    // Roofing, HVAC and commercial cleaning all resolve to `home_services`, so
    // their derived blocks are identical by design. If the trade-specific fields
    // were thin too, they would be doorway pages. Guard the floor.
    for (const industry of INDUSTRIES) {
      expect(industry.situations.length, `${industry.slug} situations`).toBeGreaterThanOrEqual(3);
      expect(industry.signals.length, `${industry.slug} signals`).toBeGreaterThanOrEqual(3);
      expect(
        industry.workedExample.steps.length,
        `${industry.slug} worked example`,
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it("does not reuse situation copy across pages that share an industry key", () => {
    const seen = new Map<string, string>();
    for (const industry of INDUSTRIES) {
      for (const situation of industry.situations) {
        const prior = seen.get(situation.body);
        expect(prior, `${industry.slug} duplicates copy from ${prior}`).toBeUndefined();
        seen.set(situation.body, industry.slug);
      }
    }
  });
});

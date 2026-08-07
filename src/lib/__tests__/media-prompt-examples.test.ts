import { describe, expect, it } from "vitest";

import { getMediaPromptExamples } from "../product-language";

/**
 * A placeholder teaches by example, so a hardcoded one teaches the WRONG example
 * to every industry it wasn't written for. Studio shipped with "a clean service
 * van in a suburban driveway" in both prompt boxes — right for a restoration
 * tenant, a non-sequitur for a clinic, a law firm, or a shop.
 *
 * This is the universality rule the product runs on (docs/UNIVERSALITY.md): if a
 * feature needs industry-specific nouns, they come from the industry template,
 * never from a hardcode.
 */

const KEYS = ["general", "restoration", "home_services", "professional_services", "agency", "healthcare", "real_estate", "saas", "ecommerce"];

/** Trade nouns that must not leak outside the trades verticals. */
const TRADE_WORDS = /\b(van|driveway|roof|storm|crew)\b/i;

describe("getMediaPromptExamples", () => {
  it("has an example for every industry the product knows", () => {
    for (const key of KEYS) {
      const ex = getMediaPromptExamples(key);
      expect(ex.image.length, key).toBeGreaterThan(20);
      expect(ex.video.length, key).toBeGreaterThan(20);
    }
  });

  it("only uses trade nouns in the trades verticals", () => {
    // The exact bug: a law firm or a clinic being shown a service van.
    for (const key of ["general", "professional_services", "agency", "healthcare", "real_estate", "saas", "ecommerce"]) {
      expect(getMediaPromptExamples(key).image, key).not.toMatch(TRADE_WORDS);
      expect(getMediaPromptExamples(key).video, key).not.toMatch(TRADE_WORDS);
    }
    // …and still speaks their language where it IS the vertical.
    expect(getMediaPromptExamples("restoration").image).toMatch(TRADE_WORDS);
    expect(getMediaPromptExamples("home_services").image).toMatch(TRADE_WORDS);
  });

  it("falls back to the neutral example for an unknown or missing industry", () => {
    const neutral = getMediaPromptExamples("general");
    for (const value of [undefined, null, "", "  ", "underwater basket weaving"]) {
      expect(getMediaPromptExamples(value)).toEqual(neutral);
    }
  });

  it("never asks for text, logos, or signage", () => {
    // The server strips those from generated images unconditionally, so an
    // example asking for them would teach a prompt that quietly does not work.
    for (const key of KEYS) {
      const ex = getMediaPromptExamples(key);
      expect(`${ex.image} ${ex.video}`, key).not.toMatch(/\b(text|logo|sign|signage|words|caption|headline)\b/i);
    }
  });

  it("gives video an example with motion, not a restated still", () => {
    for (const key of KEYS) {
      const ex = getMediaPromptExamples(key);
      expect(ex.video, key).not.toBe(ex.image);
      expect(ex.video, key).toMatch(/\b(slow|pan|push|dolly|move|moving|rotation|pulls)\b/i);
    }
  });
});

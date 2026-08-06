import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { personaAccent, PERSONA_ACCENTS } from "@/domain";

/**
 * Colour has to answer a question (BSR-661).
 *
 * DESIGN.md §8 has banned purple since the design system was written, and it
 * kept coming back anyway — as a persona hue in five places, a journey stage, a
 * library folder colour, and a `--vio` token that was mostly resolving to
 * nothing because it had never been defined globally. Red is likewise reserved
 * for destructive controls, and it was carrying the "emergency" persona.
 *
 * Bans are only as good as the thing that enforces them.
 */

const APP_DIR = new URL(".", import.meta.url).pathname;

/** Purple/violet in the ranges that kept reappearing. */
const PURPLE = /#(9678c8|b58fd0|b08fd0|cdbbe6|a78bfa|8b5cf6)\b|rgba\(\s*1[45]\d,\s*1[12]\d,\s*2[0-9]\d/i;
/** The destructive red, and the softened variants used as category colours. */
const RESERVED_RED = /#(cc6666|cc6a6a)\b/i;

function files(dir: string, exts: string[], out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files(full, exts, out);
    else if (exts.some((e) => full.endsWith(e)) && !full.includes(".test.")) out.push(full);
  }
  return out;
}

describe("semantic colour", () => {
  const sources = files(APP_DIR, [".tsx", ".ts", ".css"]);

  it("sweeps a real file set (guards against an empty pass)", () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it("renders no purple anywhere in the signed-in app", () => {
    const offenders = sources
      .filter((f) => {
        // Third-party vendor logos legitimately use their own brand colour.
        // `connector-catalog.ts` holds the integration list (and its logo
        // colours) that used to be a literal inside settings-view.tsx.
        if (f.endsWith("settings-view.tsx") || f.endsWith("brand-badge.tsx") || f.endsWith("connector-catalog.ts")) return false;
        return PURPLE.test(readFileSync(f, "utf8"));
      })
      .map((f) => f.replace(APP_DIR, ""));
    expect(offenders).toEqual([]);
  });

  it("keeps the destructive red out of the colour ramps we assign to categories", () => {
    const RAMPS = /const\s+(\w*(?:PALETTE|ACCENTS|DOTS|COLORS|COLOURS)\w*)\s*(?::[^=]+)?=\s*[[{]([^\]}]*)[\]}]/g;
    const offenders: string[] = [];
    for (const f of sources.filter((x) => x.endsWith(".tsx") || x.endsWith(".ts"))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(RAMPS)) {
        // FALLBACK_SWATCHES is the palette a customer picks their OWN brand
        // colour from — their red is not our category red.
        if (m[1] === "FALLBACK_SWATCHES") continue;
        if (RESERVED_RED.test(m[2]) || PURPLE.test(m[2])) {
          offenders.push(`${f.replace(APP_DIR, "")}: ${m[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("gives one persona one colour, whatever screen asks", () => {
    // The bug this replaces: analytics assigned by array index, so position —
    // not identity — decided the hue.
    for (const name of ["Property manager", "property_manager", "PROPERTY MANAGER"]) {
      expect(personaAccent(name)).toBe(personaAccent("Property manager"));
    }
    expect(personaAccent("Plumbing partner")).toBe(PERSONA_ACCENTS.green);
    // Unknown personas are stable too, not random per render.
    expect(personaAccent("Some Unseen Persona")).toBe(personaAccent("Some Unseen Persona"));
  });

  it("offers no purple or red in the persona ramp at all", () => {
    for (const hex of Object.values(PERSONA_ACCENTS)) {
      expect(PURPLE.test(hex), `${hex} is purple`).toBe(false);
      expect(RESERVED_RED.test(hex), `${hex} is the destructive red`).toBe(false);
    }
  });
});

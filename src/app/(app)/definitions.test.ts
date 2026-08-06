import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFINITIONS, definitionText, type DefinitionKey } from "@/domain";

/**
 * Coined terms carry a definition (BSR-659).
 *
 * The app invents words and puts real weight on them — `Confidence` appeared
 * four times on one screen, `Arc-ready` was the primary filter on Library,
 * `Trusted` decides what Arc may write in your name. None was defined anywhere,
 * so a user could not act differently at 79% than at 91%.
 *
 * The rule these tests encode is the one that made the old copy useless: a
 * definition has to say what the number is measured FROM. "Arc's confidence in
 * this signal" restates the label and helps nobody.
 */

const APP_DIR = new URL(".", import.meta.url).pathname;

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files(full, out);
    else if (full.endsWith(".tsx") && !full.includes(".test.")) out.push(full);
  }
  return out;
}

describe("definitions", () => {
  const keys = Object.keys(DEFINITIONS) as DefinitionKey[];

  it("defines each term without leaning on the term itself", () => {
    for (const key of keys) {
      const { term, meaning } = DEFINITIONS[key];
      expect(meaning.length, `${term} has a stub definition`).toBeGreaterThan(24);
      // "Arc's confidence in this signal" — the exact failure this replaces.
      const head = term.toLowerCase().split(" ")[0];
      expect(meaning.toLowerCase().startsWith(head), `${term}'s definition opens by restating the term`).toBe(false);
    }
  });

  it("keeps internal vocabulary out of the definitions themselves", () => {
    // Otherwise the explanation just moves the problem down one line.
    const banned = /\b(wired|org-scoped|approval-gated|metered|runner|node|payload|denominator)\b/i;
    for (const key of keys) {
      expect(banned.test(definitionText(key)), `${key} explains one coined term with another`).toBe(false);
    }
  });

  it("wires the definition component to the screens that invented the words", () => {
    const rendered = files(APP_DIR)
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    for (const term of Object.keys(DEFINITIONS) as DefinitionKey[]) {
      const wired = rendered.includes(`term="${term}"`) || rendered.includes(`definitionText("${term}")`);
      expect(wired, `${term} is defined but no screen uses it`).toBe(true);
    }
  });

  it("spreads the explainer panel beyond the one screen that had it", () => {
    // /journeys had the only "How this works" in the app and it was the single
    // most useful thing on that screen.
    const withPanel = files(APP_DIR).filter((f) => readFileSync(f, "utf8").includes("<HowThisWorks>"));
    expect(withPanel.length).toBeGreaterThanOrEqual(3);
  });
});

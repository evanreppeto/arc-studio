/**
 * `.env.example` and the capability catalogue must not drift (BSR-480).
 *
 * The failure this prevents is the one the ticket was written about: a variable
 * gets added in code, nobody documents it, prod never sets it, and the feature
 * is silently inert. Two hand-maintained lists guarantee that eventually —
 * `EMAIL_UNSUBSCRIBE_SECRET` was referenced in the dispatch layer and appeared
 * in neither the example file nor the health console.
 *
 * Reads the real file rather than a fixture, because a fixture would drift too.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ENV_CAPABILITIES, allKnownEnvVars } from "../env-capabilities";

const EXAMPLE = join(process.cwd(), ".env.example");

function declaredInExample(): string[] {
  const raw = readFileSync(EXAMPLE, "utf8");
  const names = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (match) names.add(match[1]);
  }
  return [...names].sort();
}

describe(".env.example ↔ catalogue", () => {
  it("documents every variable the catalogue knows about", () => {
    const declared = new Set(declaredInExample());
    // Aliases are described in prose rather than given their own blank line —
    // listing NEXT_PUBLIC_SUPABASE_URL twice under two names would invite
    // someone to set the wrong one. So check primary names only.
    const primary = ENV_CAPABILITIES.flatMap((c) => c.vars.map((v) => v.name));
    const missing = [...new Set(primary)].filter((name) => !declared.has(name));
    expect(missing, `add to .env.example: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no variable in the file that the catalogue cannot explain", () => {
    const known = new Set(allKnownEnvVars());
    const orphans = declaredInExample().filter((name) => !known.has(name));
    expect(
      orphans,
      `add to src/domain/env-capabilities.ts, with what breaks when unset: ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("marks every variable required, optional or platform", () => {
    // The mark is the whole point — an unmarked list is what .env.example
    // already was. Each documented var must carry one of the three words in a
    // comment somewhere above it.
    const raw = readFileSync(EXAMPLE, "utf8");
    const lines = raw.split(/\r?\n/);
    const unmarked: string[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].match(/^([A-Z][A-Z0-9_]*)=/);
      if (!match) continue;
      // Walk back over the contiguous comment block introducing this variable
      // (and any sibling assignments that share it).
      let mark: string | null = null;
      for (let j = i - 1; j >= 0 && j > i - 30; j -= 1) {
        const line = lines[j];
        if (/^[A-Z][A-Z0-9_]*=/.test(line)) continue;
        if (line.trim() === "") break;
        const found = line.match(/^#\s*(required|optional|platform)\b/);
        if (found) {
          mark = found[1];
          break;
        }
      }
      if (!mark) unmarked.push(match[1]);
    }

    expect(unmarked, `mark these required/optional/platform: ${unmarked.join(", ")}`).toEqual([]);
  });
});

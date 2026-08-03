import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guard against the recurring leak this test is named for (BSR-655): internal
 * plumbing vocabulary rendered to the customer.
 *
 * For a long time the signed-in app wore small monospace badges next to section
 * headings that answered an *engineer's* question — "is this section reading
 * real data yet?" — in the *customer's* UI. Several printed literal database
 * identifiers: `wired · listNodes`, `wired · media_assets`,
 * `wired · tone · voice_guidance`, `wired · node created_at`. An owner-operator
 * looking at their own marketing data has no idea what any of that means.
 *
 * The leak recurs because each badge looks harmless where it is added. This test
 * makes the whole class fail at once instead.
 *
 * Scope: **rendered text only.** Code comments are stripped first — a comment
 * explaining that something is wired is fine and often useful. Identifiers are
 * untouched; only what a user can read is checked.
 */

const APP_DIR = new URL(".", import.meta.url).pathname;

/** Words that describe our plumbing, not the user's business. */
const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /\bwired\b/i, why: "grades our own plumbing; a rendered section reads real data by definition" },
  { pattern: /\bneeds sync\b/i, why: "say what the user must connect, on the value line" },
  { pattern: /\borg-scoped\b/i, why: "architecture vocabulary" },
  { pattern: /\bapproval-gated\b/i, why: 'say "nothing sends until you approve it"' },
  { pattern: /\bmetered spend\b/i, why: "billing-system vocabulary" },
  { pattern: /\brunner\b/i, why: "the Cloud Run worker's name; users do not know what a runner is" },
  // Database identifiers that reached the UI verbatim.
  { pattern: /\b(media_assets|voice_guidance|proof_points|listNodes|created_at|org_id|workspace_id)\b/, why: "database or API identifier" },
];

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      tsxFiles(full, out);
    } else if (full.endsWith(".tsx") && !full.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

/** Drop `//` and block comments so a developer note never trips the guard. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Text a user can actually read: JSX text nodes between tags. Deliberately
 * narrow — it will not catch copy passed through a variable, so it is a floor
 * on this class of bug rather than a proof of absence.
 */
function renderedText(source: string): string[] {
  const out: string[] = [];
  for (const [, text] of source.matchAll(/>([^<>{}]+)</g)) {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed && /[a-z]/i.test(trimmed)) out.push(trimmed);
  }
  return out;
}

/**
 * Stored identifiers rendered as body text — the same leak by a different route.
 *
 * The word-list guard below cannot see this one: the offending text is not a
 * literal in the source, it is a *value* (`{stage.key}`), so nothing to match
 * until it reaches a browser. Settings → Records printed the stored key under
 * every row — "Needs review / needs_review", "Qualified / qualified" — and the
 * custom-field editor printed the column name the same way. Both shipped and sat
 * there through a manual UI audit that was looking for exactly this.
 *
 * Rendering an identifier a user cannot act on is the leak whether it arrives as
 * a string literal or as a column value.
 *
 * Deliberately narrow: JSX *children* only. `key={x.key}` and `title={x.key}` are
 * props, not rendered text, and are left alone.
 */
const IDENTIFIER_FIELDS = ["key", "objectKey", "fieldType", "slug"];
const RENDERED_IDENTIFIER = new RegExp(
  // Excluded by the leading class: `=` for prop values (`objectKey={record.key}`)
  // and `$` for template interpolation (`` `cf:${c.key}` ``) — neither is text a
  // user reads, and both are common enough that matching them would train the
  // next person to ignore this test.
  String.raw`(^|[^=$])\{\s*[A-Za-z_$][\w$]*\.(${IDENTIFIER_FIELDS.join("|")})\s*\}`,
  "gm",
);

describe("stored identifiers are not rendered as body text", () => {
  it("no component renders a bare .key / .slug / .fieldType as a JSX child", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(APP_DIR)) {
      const source = stripComments(readFileSync(file, "utf8"));
      for (const [match] of source.matchAll(RENDERED_IDENTIFIER)) {
        offenders.push(`${file.replace(APP_DIR, "")}: ${match.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("plumbing vocabulary never reaches the customer", () => {
  const files = tsxFiles(APP_DIR);

  it("finds the app's components (guards against an empty sweep passing)", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(BANNED)("does not render $pattern — $why", ({ pattern }) => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const text of renderedText(stripComments(readFileSync(file, "utf8")))) {
        if (pattern.test(text)) offenders.push(`${file.replace(APP_DIR, "")}: ${text.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

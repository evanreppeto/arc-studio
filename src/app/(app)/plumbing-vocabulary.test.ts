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
  { pattern: /\bbackend\b/i, why: "our architecture, not theirs; say \"workspace\" — what they connect" },
  // Environment variables named in customer-facing copy. Listed explicitly for
  // the same reason the database identifiers below are: `renderedText` matches
  // `>…<` and so also scoops up code between TS generics, where SCREAMING_SNAKE
  // is ordinary and harmless. A general pattern here fired on `PAGE_SIZES`,
  // `SORT_LABELS` and a dozen more. The general rule still exists — it runs
  // against attribute text, which is clean — see the env-var test below.
  { pattern: /\b(ARC_MEDIA_ENABLED|ARC_AGENT_API_TOKEN|GEMINI_API_KEY|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|SUPABASE_SERVICE_ROLE_KEY|RESEND_API_KEY)\b/, why: "an environment variable name; only settable by someone with shell access, who is not the person clicking" },
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

/**
 * Drop `//` and block comments so a developer note never trips the guard.
 *
 * A block comment opens only where a comment can actually start: at the
 * beginning of a line, after whitespace, or after `{` (a JSX comment). What
 * that excludes is the point — in `accept="image/*,video/*"` the `/*` follows
 * `e`, so it is a MIME wildcard, not an opener.
 *
 * The old version accepted any `/*`. That one attribute opened a "comment" that
 * ran to the next `*` + `/`, and everything between was invisible to every
 * check in this file: 15 lines of studio-view.tsx and 26 of library-view.tsx,
 * including a `data-soon` control sitting in the middle of one of them
 * (BSR-731). A guard with a hole that silently swallows source is worse than no
 * guard, because the green tick gets read as coverage.
 */
function stripComments(source: string): string {
  return source
    .replace(/(^|[\s{])\/\*[\s\S]*?\*\//g, (_m, lead: string) => lead)
    .replace(/^\s*\/\/.*$/gm, "");
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
 * Copy that reaches the screen through an ATTRIBUTE rather than a text node.
 *
 * `renderedText` above matches `>text<` and so is blind to all of these, which
 * is how "Media generation is off — set ARC_MEDIA_ENABLED + GEMINI_API_KEY"
 * shipped: a `data-soon` value, printed verbatim into a toast by
 * `ComingSoonToasts`, past a guard that was only ever looking between tags
 * (BSR-731).
 *
 * `placeholder` and `title` are here for the same reason — Studio said "Connect
 * a backend to chat with Arc" in a placeholder and "Arc chat needs a connected
 * backend" in a title, both invisible to the old scanner.
 */
const TEXT_BEARING_ATTRS = ["data-soon", "placeholder", "title", "aria-label"];

function attributeText(source: string): string[] {
  const out: string[] = [];
  for (const attr of TEXT_BEARING_ATTRS) {
    // JSX form: attr="…" or attr={`…`}
    for (const [, dq, tpl] of source.matchAll(new RegExp(`${attr}=(?:"([^"]*)"|\\{\`([^\`]*)\`\\})`, "g"))) {
      out.push(dq ?? tpl ?? "");
    }
    // Object-property form, e.g. {...(gate ? { "data-soon": gate } : {})}.
    // A literal is read directly; an identifier is followed ONE hop, below.
    for (const [, lit, ident] of source.matchAll(new RegExp(`"${attr}":\\s*(?:"([^"]*)"|([A-Za-z_$][\\w$]*))`, "g"))) {
      if (lit) out.push(lit);
      else if (ident) out.push(...constStringLiterals(source, ident));
    }
  }
  // Drop `${…}` holes: a template renders the VALUE, so the identifier inside is
  // no more user-facing than a variable name anywhere else. Leaving them in made
  // `title={`Sort: ${SORT_LABELS[value]}`}` read as an env var.
  return out.map((t) => t.replace(/\$\{[^}]*\}/g, " ")).filter((t) => t.trim() && /[a-z]/i.test(t));
}

/**
 * String literals inside `const <name> = …;` in the same file. ONE hop, on
 * purpose: `genGate` and `videoGate` are ternary chains of user-facing copy
 * assigned to a const and handed straight to `data-soon`, and that indirection
 * was enough to hide two env var names. Following one named local is a long way
 * short of dataflow analysis and catches the shape that actually occurs.
 */
function constStringLiterals(source: string, name: string): string[] {
  const decl = source.match(new RegExp(String.raw`const\s+${name}\s*=([\s\S]*?);\s*
`));
  if (!decl) return [];
  return [...decl[1].matchAll(/"([^"]+)"/g)].map(([, text]) => text);
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

/**
 * Attribute copy gets the GENERAL env-var rule, not just the known names.
 *
 * `attributeText` returns curated, quoted, genuinely user-facing strings, so
 * SCREAMING_SNAKE inside one is an environment variable rather than a code
 * identifier — unlike `renderedText`, whose `>…<` match also spans TS generics.
 * This is where a *new* variable name gets caught without waiting for someone to
 * add it to a list.
 */
const ENV_VAR = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;

describe("no control explains itself with an environment variable", () => {
  it("names no env var in a toast, placeholder, title or aria-label", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(APP_DIR)) {
      for (const text of attributeText(stripComments(readFileSync(file, "utf8")))) {
        if (ENV_VAR.test(text)) offenders.push(`${file.replace(APP_DIR, "")}: ${text.slice(0, 90)}`);
      }
    }
    expect(offenders, "say what the operator can change, not what an engineer would set").toEqual([]);
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
      const source = stripComments(readFileSync(file, "utf8"));
      for (const text of [...renderedText(source), ...attributeText(source)]) {
        if (pattern.test(text)) offenders.push(`${file.replace(APP_DIR, "")}: ${text.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The hole every check above shares: they walk `src/app/(app)` and read JSX.
 * Copy AUTHORED IN `src/lib/` and handed to a screen as a prop is invisible to
 * all of them.
 *
 * That is not hypothetical. Studio's "why can't I generate?" line is
 * `MediaGenerationAccess.reason`, written in `src/lib/media/enablement.ts`, and
 * it read:
 *
 *   "Media generation is off for this workspace. Enable the Media Generation
 *    connector in Settings → Connections (included on platform credits, or add
 *    your own Gemini API key)."
 *
 * — a vendor name, a billing noun and two architecture nouns, rendered in the
 * corner of the canvas, past a guard built for exactly this and passing.
 *
 * Scope is deliberately the `reason` channel: these are the strings whose whole
 * job is to be shown to an operator when something is switched off, so any one
 * of them is customer copy by construction. It does not attempt to find every
 * user-facing literal in `lib/` — a general sweep there is mostly log lines and
 * error messages, and a guard that cries wolf gets suppressed.
 */
const LIB_DIR = new URL("../../lib/", import.meta.url).pathname;

/** Vocabulary §4.2 keeps out of copy the customer reads. */
const NOT_FOR_CUSTOMERS: { pattern: RegExp; why: string }[] = [
  { pattern: /\b(Gemini|Resend|Higgsfield|Veo)\b/, why: "a vendor's name; the operator bought Arc, not this" },
  { pattern: /\bplatform credits\b/i, why: "billing-system vocabulary" },
  { pattern: /\bAPI (key|token)\b/i, why: "say what to open, not what to paste" },
  { pattern: /\bcredential\b/i, why: "architecture noun" },
];

function libTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__") libTsFiles(full, out);
    } else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * String literals that become an operator-visible `reason`: `reason: "…"`,
 * `reason = "…"`, and the `const *REASON* = "…"` constants they are built from.
 */
function reasonLiterals(source: string): string[] {
  const out: string[] = [];
  for (const [, dq, sq] of source.matchAll(/\breason\s*[:=]\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g)) {
    out.push(dq ?? sq ?? "");
  }
  for (const [, dq, sq] of source.matchAll(/\bconst\s+\w*REASON\w*\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g)) {
    out.push(dq ?? sq ?? "");
  }
  return out.filter((text) => text.trim().length > 0);
}

describe("off-switch copy written in lib/ is still customer copy", () => {
  const files = libTsFiles(LIB_DIR);

  it("finds the library (guards against an empty sweep passing)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("finds reason strings to check (guards against a regex that matches nothing)", () => {
    const total = files.reduce((n, file) => n + reasonLiterals(stripComments(readFileSync(file, "utf8"))).length, 0);
    expect(total).toBeGreaterThan(5);
  });

  it.each(NOT_FOR_CUSTOMERS)("no reason string says $pattern — $why", ({ pattern }) => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const text of reasonLiterals(stripComments(readFileSync(file, "utf8")))) {
        if (pattern.test(text)) offenders.push(`${file.replace(LIB_DIR, "")}: ${text.slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * One route, one name (BSR-663).
 *
 * `/crm` used to be called four different things: "Relationships" in the nav
 * rail, "Relationships" in the breadcrumb, "CRM" in the browser tab, and
 * "People" in the page heading — with "CRM" appearing nowhere else in the app,
 * so a bookmark or a row of browser tabs showed a word the user had never seen.
 * `/arc` had the mirror-image bug: its tab title was a bare "Arc" while every
 * other route used "X — Arc Studio".
 *
 * The nav label is the source of truth; the tab title follows it.
 */

const SHELL = readFileSync(new URL("./_components/app-shell.tsx", import.meta.url), "utf8");

/** Nav items only — `hint` is what distinguishes them from command-palette actions. */
function navLabels(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of SHELL.matchAll(/\{ label: "([^"]+)", href: "([^"]+)", icon: \w+, hint: "[^"]+" \}/g)) {
    out.set(m[2], m[1]);
  }
  return out;
}

/** The CRUMBS map the breadcrumb reads. */
function crumbs(): Map<string, string> {
  const block = SHELL.match(/const CRUMBS: Record<string, string> = \{([\s\S]*?)\n\};/)?.[1] ?? "";
  const out = new Map<string, string>();
  for (const x of block.matchAll(/"([^"]+)": "([^"]+)"/g)) out.set(x[1], x[2]);
  return out;
}

function titleFor(href: string): string | null {
  const file = new URL(`.${href}/page.tsx`, import.meta.url).pathname;
  if (!existsSync(file)) return null;
  const src = readFileSync(file, "utf8");
  // Static metadata, or a generateMetadata template literal.
  return src.match(/export const metadata = \{ title: "([^"]+)" \}/)?.[1]
    ?? src.match(/return \{ title: `([^`]+)` \}/)?.[1]
    ?? null;
}

describe("route naming", () => {
  const nav = navLabels();
  const crumb = crumbs();

  it("reads the nav (guards against an empty sweep passing)", () => {
    expect(nav.size).toBeGreaterThanOrEqual(12);
  });

  it("gives every nav route a breadcrumb under the same name", () => {
    const mismatched: string[] = [];
    for (const [href, label] of nav) {
      const c = crumb.get(href);
      // /crm is tenant-vocabulary driven and resolved at render, so its static
      // entry is the default label rather than a mismatch.
      if (href === "/crm") continue;
      if (c !== label) mismatched.push(`${href}: nav "${label}" vs crumb "${c ?? "(none)"}"`);
    }
    expect(mismatched).toEqual([]);
  });

  it("titles every tab with its own name, suffixed consistently", () => {
    const wrong: string[] = [];
    for (const [href, label] of nav) {
      const title = titleFor(href);
      if (title === null) continue; // route composes its metadata elsewhere
      if (href === "/crm") {
        // Follows the tenant's vocabulary, so it must interpolate rather than
        // hard-code — the bug was a literal "CRM" here.
        if (!title.includes("${crmLabel}")) wrong.push(`${href}: "${title}" should follow crmLabel`);
        continue;
      }
      if (title !== `${label} — Arc Studio`) wrong.push(`${href}: "${title}" ≠ "${label} — Arc Studio"`);
    }
    expect(wrong).toEqual([]);
  });

  it("describes every nav item, so a metaphor is never the only clue", () => {
    // Brain, Journeys, Studio and Outbox are metaphors; the pages themselves had
    // to explain them in a subtitle.
    const items = [...SHELL.matchAll(/\{ label: "([^"]+)", href: "[^"]+", icon: \w+, hint: "([^"]+)" \}/g)];
    expect(items.length).toBe(nav.size);
    for (const [, label, hint] of items) {
      expect(hint.length, `${label} has a stub hint`).toBeGreaterThan(12);
    }
  });
});

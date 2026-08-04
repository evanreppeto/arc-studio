import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Navigation inside the app stays inside the app.
 *
 * `window.location.href = "/somewhere"` triggers a full document load: the
 * client cache is discarded, the nav progress bar never runs, in-page state is
 * lost, and the transition costs a cold render instead of a cached one. The
 * shell invests in `RoutePrewarm` and `NavProgress` precisely so that clicks
 * feel instant; a location assignment opts out of all of it.
 *
 * The Library's per-card "Add to campaign" was the case that prompted this. It
 * assigned `window.location.href = "/campaigns"` — so it did not merely reload,
 * it discarded the operator's selection AND added nothing to any campaign,
 * while `addLibraryAssetsToCampaign` sat wired to the bulk bar a few lines
 * below it.
 *
 * EXTERNAL destinations are exempt and must stay exempt: the
 * `/api/connectors/…/authorize` OAuth handoffs and provider URLs have to leave
 * the SPA, and routing them through the client router would break the redirect.
 */

const APP_DIR = new URL(".", import.meta.url).pathname;

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (full.endsWith(".tsx") && !full.includes(".test.")) out.push(full);
  }
  return out;
}

/**
 * An assignment whose destination is an in-app route.
 *
 * Deliberately conservative: only a literal starting `/` that is not `/api/`
 * counts. A variable destination (`res.url`) is left alone because this cannot
 * know where it points, and the ones in the tree today are provider redirects.
 */
function stripComments(source: string): string {
  // Comments are stripped before matching, or this check reports the comment
  // that documents a fix as though it were the bug — which it did on its first
  // run, against the very line explaining why the Library button changed.
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function internalLocationAssignments(source: string): string[] {
  const hits: string[] = [];
  for (const m of stripComments(source).matchAll(/window\.location\.href\s*=\s*([^;\n]+)/g)) {
    const target = m[1].trim();
    const literal = /^["'`](\/[^"'`]*)["'`]/.exec(target);
    if (!literal) continue; // computed destination — see the doc comment
    if (literal[1].startsWith("/api/")) continue; // route handler / OAuth handoff
    hits.push(literal[1]);
  }
  return hits;
}

describe("in-app navigation uses the client router", () => {
  const offenders = new Map<string, string[]>();
  for (const file of tsxFiles(APP_DIR)) {
    const hits = internalLocationAssignments(readFileSync(file, "utf8"));
    if (hits.length > 0) offenders.set(file.replace(APP_DIR, ""), hits);
  }

  it("never full-reloads to an in-app route", () => {
    const report = [...offenders].map(([file, hits]) => `${file}: ${hits.join(", ")}`);
    expect(
      report,
      "use <Link> or router.push for in-app routes — window.location discards the client cache, the nav progress bar and any in-page state",
    ).toEqual([]);
  });

  it("still allows the external handoffs it must", () => {
    // Guard the premise: if these disappear, the exemption above is untested and
    // this file is asserting less than it appears to.
    const settings = readFileSync(join(APP_DIR, "settings/_components/settings-view.tsx"), "utf8");
    expect(settings).toMatch(/window\.location\.href\s*=\s*"\/api\/connectors\//);
  });
});

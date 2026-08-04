import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DemoDataBar } from "@/app/(app)/_components/demo-data-bar";
import { DEMO_DATA_LABEL, DEMO_DATA_MEANING } from "../vocabulary";

/**
 * One wording for made-up numbers, and one place that says it (BSR-656).
 *
 * `/journeys` badged its funnel "demo data", Settings said "Sample data",
 * "Sample activity" and "Sample workspaces", and `/analytics` and `/crm`
 * rendered `710 leads` and `$225k won revenue` with no marking at all — three
 * wordings and a silence, for one thing.
 *
 * The silence was the dangerous half. A reader has no way to tell an
 * illustrative number from their own, and the first thing anyone does with a
 * number that looks real is believe it.
 *
 * Scanned via `git ls-files` rather than a directory walk: `grep -r` silently
 * skips any file containing a NUL byte.
 */

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

/** Ad-hoc spellings that mean "these numbers are not real". */
const BANNED = ["Sample data", "Sample activity", "Sample workspaces", "demo data", "DEMO DATA", "Demo mode data"];

/**
 * Files allowed to contain the words.
 *
 * - `vocabulary.ts` and the bar document the retired spellings in their own
 *   comments, and hold the canonical one.
 * - tests, including this one, quote them to assert they are gone.
 * - `demo-mode.ts` explains the env flag in prose.
 */
const ALLOWED = [
  "src/domain/vocabulary.ts",
  "src/app/(app)/_components/demo-data-bar.tsx",
  "src/lib/demo/demo-mode.ts",
  ".test.ts",
  ".test.tsx",
];

function trackedSource(): Array<{ path: string; code: string }> {
  return execFileSync("git", ["ls-files", "-z", "src"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\0")
    .filter((path) => /\.tsx?$/.test(path))
    .filter((path) => !ALLOWED.some((allowed) => path.includes(allowed)))
    .map((path) => ({ path, code: readFileSync(`${REPO_ROOT}${path}`, "utf8") }));
}

/** Strip comments so a note ABOUT the old wording is not read as the old wording. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("one wording for demo data", () => {
  const files = trackedSource().map(({ path, code }) => ({ path, code: withoutComments(code) }));

  it("scans a non-trivial number of files, so a broken glob cannot pass silently", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it.each(BANNED)('no source spells it "%s"', (phrase) => {
    const offenders = files
      .filter(({ code }) => code.includes(`"${phrase}"`) || code.includes(`>${phrase}<`))
      .map(({ path }) => path);

    expect(
      offenders,
      `"${phrase}" is a second name for what DEMO_DATA_LABEL already calls "${DEMO_DATA_LABEL}".\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});

/**
 * The bar is the only thing standing between a viewer and an unmarked `$225k`,
 * so its wiring is worth pinning. It is console-wide by design: demo data is a
 * deployment decision, and twenty-seven read models can serve fixtures — hand
 * placing a badge on each is how the next screen gets forgotten.
 */
describe("the console-wide demo bar stays wired", () => {
  const shell = readFileSync(`${REPO_ROOT}src/app/(app)/_components/app-shell.tsx`, "utf8");
  const layout = readFileSync(`${REPO_ROOT}src/app/(app)/layout.tsx`, "utf8");
  const bar = readFileSync(`${REPO_ROOT}src/app/(app)/_components/demo-data-bar.tsx`, "utf8");

  it("renders inside the shell every signed-in screen shares", () => {
    expect(shell).toContain("<DemoDataBar show={demoData} />");
  });

  it("is driven by the env flag, not by a per-page guess", () => {
    expect(layout).toContain("demoData={isDemoDataEnabled()}");
  });

  it("takes its words from the vocabulary rather than spelling them again", () => {
    expect(bar).toContain("DEMO_DATA_LABEL");
    expect(bar).toContain("DEMO_DATA_MEANING");
    // The meaning has to name the fix, not just the problem.
    expect(DEMO_DATA_MEANING).toMatch(/connect a workspace/i);
    expect(DEMO_DATA_LABEL).toBe("Demo data");
  });

  /**
   * The half that matters on prod. A bar claiming "these numbers are
   * illustrative" over a customer's real revenue is a worse lie than the
   * silence it replaced, so the off state is the one to pin.
   *
   * `isDemoDataEnabled()` is already proven false for unset/other values in
   * `demo/demo-mode.test.ts`, and the layout assertion above proves that value
   * is what reaches the bar. This closes the last link: false renders nothing.
   */
  it("renders nothing at all when demo data is off", () => {
    expect(DemoDataBar({ show: false })).toBeNull();
    expect(DemoDataBar({ show: true })).not.toBeNull();
  });
});

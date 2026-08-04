import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { notConfigured, reasonIfUnavailable, unavailable } from "./unavailable";

/**
 * "Not configured" is an answer; "unavailable" is an outage (BSR-546 follow-up).
 *
 * `unavailable.ts` warned against conflating them from the day it was written —
 * *"Not for legitimate non-failures … which are answers, not outages, and would
 * only train people to ignore the alert"* — and two read models did it anyway,
 * because `unavailable` was the only status on offer. The result was a red
 * **"Some analytics couldn't load"** banner on every backend-less preview,
 * naming a query that had never run and could not have failed.
 *
 * A banner that cries wolf is how the next real outage gets ignored. These tests
 * hold the two apart.
 */

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

describe("reasonIfUnavailable", () => {
  it("stays silent about a workspace with no backend", () => {
    expect(reasonIfUnavailable(notConfigured())).toBeNull();
  });

  it("still reports a real failure, with its reason", () => {
    const failed = unavailable("analytics.conversion")(new Error("column does not exist"));
    expect(reasonIfUnavailable(failed)).toBe("column does not exist");
  });

  it("falls back to generic copy when a failure carried no message", () => {
    expect(reasonIfUnavailable({ status: "unavailable" })).toBe("This data could not be loaded.");
  });

  it("says nothing about live or empty reads", () => {
    expect(reasonIfUnavailable({ status: "live" })).toBeNull();
    expect(reasonIfUnavailable({ status: "empty" })).toBeNull();
    expect(reasonIfUnavailable(null)).toBeNull();
  });
});

/**
 * The source-level half: a `!isSupabaseAdminConfigured()` guard must not return
 * `unavailable`. That is the exact line that produced the false banner, and it
 * is a one-word mistake to repeat.
 *
 * Scanned via `git ls-files` rather than a directory walk — `grep -r` silently
 * skips any file containing a NUL byte.
 */
describe("no not-configured guard reports itself as a failure", () => {
  const files = execFileSync("git", ["ls-files", "-z", "src"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\0")
    .filter((path) => /\.tsx?$/.test(path) && !path.includes(".test."))
    .map((path) => ({ path, code: readFileSync(`${REPO_ROOT}${path}`, "utf8") }));

  it("scans a non-trivial number of files, so a broken glob cannot pass silently", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it("never returns `unavailable` from a not-configured guard", () => {
    // The whole statement on one line, which is how every one of these is written.
    const offending = /!\s*isSupabaseAdminConfigured\(\)[^\n]*return\s*\{\s*status:\s*["']unavailable["']/;
    const offenders = files.filter(({ code }) => offending.test(code)).map(({ path }) => path);

    expect(
      offenders,
      `A missing backend is an answer, not an outage — return notConfigured() so the page does not raise a load-failure banner.\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});

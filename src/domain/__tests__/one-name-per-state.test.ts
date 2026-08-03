import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { WORK_STATE_LABEL } from "../vocabulary";

/**
 * One state, one string — enforced, not just documented (BSR-656).
 *
 * `vocabulary.ts` has existed since the first round of this fix and the drift
 * came straight back: by 2026-08-03 the campaign detail screen showed FOUR names
 * for a single state at once — "In review" on the header pill, "Needs you" on
 * the asset card, "In review" again in Launch readiness, and "Pending" in its
 * count — for one campaign, in one viewport. Library said "In review" and "Needs
 * review", Arc chat said "Ready for review", and the approvals read-model said
 * "Pending approval".
 *
 * A convention nothing checks is a convention that decays. This is the check.
 *
 * Scanned via `git ls-files` rather than a directory walk: `grep -r` silently
 * skips any file containing a NUL byte, which is how a previous census came back
 * clean on files that were not clean.
 */

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

/**
 * Banned spellings, mapped to the canonical label they should have used.
 *
 * Only phrases that name a STATE — where a thing currently is. Two categories
 * are deliberately absent, because banning them would force a wrong change:
 *
 *  - A different axis. `crm/read-model.ts` classifies a lead's *urgency* as
 *    "Needs review". That is not an approval state and must not be flattened
 *    into one.
 *  - A past-tense EVENT. The approval audit trail (`DECISION_ACTION`) and the
 *    activity feed record "Revision requested" as something that happened, next
 *    to a separate `insightLabel: "Needs you"` for where the item now sits. An
 *    event log says what was done; a pill says where it is. Same words, two
 *    honest jobs.
 */
const BANNED: Array<{ phrase: string; use: string }> = [
  { phrase: "Pending approval", use: WORK_STATE_LABEL.needs_you },
  { phrase: "Pending owner approval", use: WORK_STATE_LABEL.needs_you },
  { phrase: "Awaiting approval", use: WORK_STATE_LABEL.needs_you },
  { phrase: "Awaiting review", use: WORK_STATE_LABEL.needs_you },
  { phrase: "Ready for review", use: WORK_STATE_LABEL.needs_you },
  { phrase: "Awaiting your confirm", use: WORK_STATE_LABEL.needs_you },
  { phrase: "Needs approval", use: WORK_STATE_LABEL.needs_you },
];

/**
 * Files that may legitimately contain the words.
 *
 * - `vocabulary.ts` documents the retired spellings in its own header.
 * - tests, including this one, quote them to assert they are gone.
 * - the landing page is marketing copy showing a mock UI, not the app.
 */
const ALLOWED = [
  "src/domain/vocabulary.ts",
  "src/app/landing/",
  ".test.ts",
  ".test.tsx",
];

function trackedSourceFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "src"], { cwd: REPO_ROOT, encoding: "utf8" });
  return out
    .split("\0")
    .filter((path) => /\.(ts|tsx)$/.test(path))
    .filter((path) => !ALLOWED.some((allowed) => path.includes(allowed)));
}

/** Strip comments so a note ABOUT the old wording is not read as the old wording. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("one name per work state", () => {
  const files = trackedSourceFiles().map((path) => ({
    path,
    code: withoutComments(readFileSync(`${REPO_ROOT}${path}`, "utf8")),
  }));

  it("scans a non-trivial number of files (guards against the glob silently matching nothing)", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it.each(BANNED)('no source spells the state "$phrase" — use "$use"', ({ phrase, use }) => {
    const offenders = files
      .filter(({ code }) => code.includes(`"${phrase}"`) || code.includes(`\`${phrase}\``) || code.includes(`>${phrase}<`))
      .map(({ path }) => path);

    expect(
      offenders,
      `"${phrase}" is a second name for a state that is already called "${use}". Render WORK_STATE_LABEL instead of spelling it.\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  /**
   * The states themselves must keep coming from the module. A file that spells a
   * canonical label as a literal is one rename away from drifting again — this
   * catches the copy-paste before it becomes a fifth name.
   */
  it("routes the campaign screen's own labels through the vocabulary", () => {
    const detail = readFileSync(
      `${REPO_ROOT}src/app/(app)/campaigns/[campaignId]/_components/campaign-detail-view.tsx`,
      "utf8",
    );
    // The header pill and Launch readiness render the campaign lifecycle, which
    // is a parallel set of display words in the domain type. Both must translate.
    // Passing the raw value as a PROP is fine — PerformancePanel compares it, it
    // does not print it — so this only bans rendering it as a JSX text node.
    expect(detail).toContain("{lifecycleLabel(launchState.lifecycle)}");
    expect(detail).not.toMatch(/[>\s]\{launchState\.lifecycle\}\s*</);
  });
});

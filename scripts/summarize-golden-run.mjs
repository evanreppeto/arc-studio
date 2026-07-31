#!/usr/bin/env node
/**
 * Turn Playwright's JSON report into a per-question record for the job summary
 * (BSR-507).
 *
 * A pass/fail total hides WHICH capability degraded, and "slow degradation in
 * one area" is the thing the golden suite exists to make visible. So this prints
 * a row per question with its capability and status.
 *
 * It also prints SKIPPED questions loudly. A skipped golden question reports as
 * a green run while exercising nothing — that is the state the suite has been in
 * every night since it was written, and it should never be quiet.
 *
 * Usage: node scripts/summarize-golden-run.mjs playwright-report/results.json
 */

import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: summarize-golden-run.mjs <playwright-json-report>");
  process.exit(2);
}

const report = JSON.parse(readFileSync(path, "utf8"));

/** Walk Playwright's nested suites and yield every spec with its outcome. */
function* specs(suite, trail = []) {
  const here = suite.title ? [...trail, suite.title] : trail;
  for (const spec of suite.specs ?? []) {
    const result = spec.tests?.[0];
    yield {
      title: spec.title,
      trail: here,
      status: result?.status ?? "unknown", // expected | unexpected | skipped | flaky
      error: result?.results?.[0]?.error?.message ?? null,
    };
  }
  for (const child of suite.suites ?? []) yield* specs(child, here);
}

const all = [...(report.suites ?? []).flatMap((s) => [...specs(s)])];
const golden = all.filter((s) => s.trail.some((t) => t.includes("golden questions")));

if (!golden.length) {
  console.log("### Golden questions\n\nNo golden question results in this report.");
  process.exit(0);
}

const ICON = { expected: "PASS", unexpected: "FAIL", skipped: "SKIPPED", flaky: "FLAKY" };

const skipped = golden.filter((s) => s.status === "skipped").length;
const failed = golden.filter((s) => s.status === "unexpected").length;
const passed = golden.filter((s) => s.status === "expected").length;

const lines = [
  "### Golden questions",
  "",
  `${passed} passed · ${failed} failed · ${skipped} skipped, of ${golden.length}.`,
  "",
];

if (skipped === golden.length) {
  lines.push(
    "> **Every golden question skipped.** Arc's reasoning was not exercised at all — this run is green",
    "> without having checked anything. Set the repo variable `ARC_SMOKE_ENABLED=1` once the runner has a",
    "> Secret Manager token scoped to the smoke workspace.",
    "",
  );
}

lines.push("| Question | Result | Detail |", "| --- | --- | --- |");
for (const spec of golden) {
  // Pull the GRADER's line out of Playwright's error, not Playwright's own
  // "expect(received).toBe(expected)" — the grader is the one that names the
  // missing fact. It always reports what it matched, which makes a reliable
  // marker; fall back to the first line that isn't the assertion boilerplate.
  const errorLines = (spec.error ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const detail =
    errorLines.find((l) => l.includes("Matched [")) ??
    errorLines.find((l) => !l.startsWith("Error:") && !l.startsWith("at ")) ??
    "";
  // The "why" blurb is for whoever opens the question set, not for this table.
  const trimmed = detail.split("Why this question exists:")[0].trim();
  lines.push(`| \`${spec.title}\` | ${ICON[spec.status] ?? spec.status} | ${trimmed.slice(0, 180).replace(/\|/g, "\\|")} |`);
}

console.log(lines.join("\n"));

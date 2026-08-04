#!/usr/bin/env node
/**
 * Watch the gap between the slowest real test and the suite's timeout (BSR-739).
 *
 * `test-timeout-contract.test.ts` pins the BUDGET — testTimeout must be at least
 * 12s. Nothing pinned the other side: the slowest actual test. That number was
 * measured once by hand (3179ms, recorded in a comment) and never looked at
 * again, so if it crept toward the budget the first signal would have been the
 * suite flaking, which is exactly how the 5s default failed in the first place.
 *
 * A test's reported duration INCLUDES the module transform it triggered — that
 * is the whole reason the budget is 30s — so this measures the real thing, not
 * the assertion in isolation.
 *
 * It reads the report the normal run already writes, so it measures wherever the
 * suite ran. That matters more than it sounds: on an idle laptop the slowest
 * test is under a second, while the same file has been recorded at 5023ms under
 * a full parallel run. A check that only ever ran locally would report a
 * comfortable margin that CI does not have.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const REPORT = resolve(ROOT, "test-results.json");
const CONFIG = resolve(ROOT, "vitest.config.ts");

/** Fractions of the configured timeout. Chosen against what has actually been seen. */
const WARN_AT = 0.33;
const FAIL_AT = 0.66;

/** Read `name: 12_000` / `name: 12000` out of the config source. */
function declaredMs(source, name) {
  const match = source.match(new RegExp(`${name}\\s*:\\s*([0-9_]+)`));
  return match ? Number(match[1].replace(/_/g, "")) : null;
}

function read(path, what) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    console.error(`check-test-timing: could not read ${what} at ${path}`);
    console.error("Run the full suite first (`pnpm test`); a filtered run does not produce a comparable report.");
    process.exit(2);
  }
}

const timeout = declaredMs(read(CONFIG, "vitest.config.ts"), "testTimeout");
if (!timeout) {
  console.error("check-test-timing: vitest.config.ts declares no testTimeout — see test-timeout-contract.test.ts");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(read(REPORT, "the test report"));
} catch (error) {
  console.error(`check-test-timing: ${REPORT} is not valid JSON — ${error instanceof Error ? error.message : error}`);
  process.exit(2);
}

const tests = [];
for (const file of report.testResults ?? []) {
  for (const assertion of file.assertionResults ?? []) {
    // A skipped test has no meaningful duration; counting it as 0 would drag a
    // "slowest" claim toward nonsense if the suite were ever mostly skipped.
    if (assertion.status === "pending" || assertion.status === "skipped") continue;
    tests.push({
      ms: Math.round(assertion.duration ?? 0),
      file: (file.name ?? "").replace(`${ROOT}/`, ""),
      name: assertion.fullName || assertion.title || "(unnamed)",
    });
  }
}

// An empty report means the run did not happen, not that everything is fast.
// Passing here would turn a broken command into a green check.
if (tests.length === 0) {
  console.error("check-test-timing: the report contains no completed tests — did the suite actually run?");
  process.exit(2);
}

/**
 * Refuse a PARTIAL report.
 *
 * `pnpm test <one-file>` overwrites the same report, and a check run afterwards
 * would read five tests, find the slowest at 1ms, and announce enormous
 * headroom. That is the failure this whole ticket is about, reproduced inside
 * the fix — false comfort from a measurement that did not cover the thing it
 * claimed to. Caught by running exactly that sequence.
 *
 * The floor is derived from what is on disk rather than hard-coded, so it stays
 * true as the suite grows.
 */
function countTestFiles(dir, seen = 0) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) seen = countTestFiles(full, seen);
    else if (/\.test\.(ts|tsx)$/.test(entry)) seen += 1;
  }
  return seen;
}

const onDisk = countTestFiles(resolve(ROOT, "src"));
const covered = new Set(tests.map((t) => t.file)).size;
if (covered < onDisk * 0.9) {
  console.error(
    `check-test-timing: the report covers ${covered} of ${onDisk} test files — that is a filtered run, ` +
      "and its timings say nothing about the suite. Run `pnpm test` (no path) and try again.",
  );
  process.exit(2);
}

tests.sort((a, b) => b.ms - a.ms);
const slowest = tests[0];
const pct = slowest.ms / timeout;

console.log(`Slowest test: ${slowest.ms}ms of a ${timeout}ms budget (${Math.round(pct * 100)}%), across ${tests.length} tests.`);
console.log("Top 5:");
for (const t of tests.slice(0, 5)) {
  console.log(`  ${String(t.ms).padStart(6)}ms  ${t.file} › ${t.name.slice(0, 70)}`);
}

/** GitHub renders this as an annotation; elsewhere it is just a line. */
function annotate(level, message) {
  if (process.env.GITHUB_ACTIONS) console.log(`::${level}::${message}`);
}

if (pct >= FAIL_AT) {
  const message =
    `The slowest test is ${slowest.ms}ms, over ${Math.round(FAIL_AT * 100)}% of the ${timeout}ms timeout ` +
    `(${slowest.file}). Raise the budget or make the test cheaper — at this margin, contention decides results.`;
  annotate("error", message);
  console.error(`\ncheck-test-timing: FAIL — ${message}`);
  process.exit(1);
}

if (pct >= WARN_AT) {
  const message =
    `The slowest test is ${slowest.ms}ms, over ${Math.round(WARN_AT * 100)}% of the ${timeout}ms timeout ` +
    `(${slowest.file}). Still passing, but the headroom that keeps this suite deterministic is shrinking.`;
  annotate("warning", message);
  console.warn(`\ncheck-test-timing: WARNING — ${message}`);
}

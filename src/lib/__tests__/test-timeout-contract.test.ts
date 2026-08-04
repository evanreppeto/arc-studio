import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The suite's per-test budget must measure the test, not the bundler.
 *
 * Vitest's 5s default charges MODULE TRANSFORM to whichever test triggers it,
 * and dozens of tests here `await import(…)` inside the test body on purpose —
 * it is the only way to get a fresh module after setting an env var or calling
 * `vi.resetModules()`, which is exactly what the "reports the failure instead of
 * an empty list" guards need. The first such import transforms that module's
 * whole tree; for an API route that is the Next server stack.
 *
 * Measured, idle machine, one file alone: the first test in
 * `src/app/api/v1/arc/media/diagnose/route.test.ts` spent 5023ms and timed out.
 * In a full run the same tests passed or failed depending on how many workers
 * happened to be transforming at once — three consecutive clean-tree runs gave
 * 1, 6 and 4 failures, a different set each time, and a fourth was green. Every
 * failure was `Test timed out in 5000ms`, never a wrong value.
 *
 * The slowest test observed across four green runs after the fix was 3179ms, so
 * the floor below is roughly four times the worst real case — high enough that
 * transform cost can never decide a result, low enough that a genuinely hung
 * test still reports rather than hanging the run.
 *
 * This is a contract test because the failure it prevents is invisible: drop the
 * timeouts and the suite still passes, most of the time, on an idle machine.
 */

const CONFIG = readFileSync(resolve(import.meta.dirname, "../../../vitest.config.ts"), "utf8");

/** Read `name: 12_000` / `name: 12000` out of the config source. */
function declaredMs(name: string): number | null {
  const match = CONFIG.match(new RegExp(`${name}\\s*:\\s*([0-9_]+)`));
  return match ? Number(match[1].replace(/_/g, "")) : null;
}

const FLOOR_MS = 12_000;

describe("the suite's timeouts leave room for on-demand module transform", () => {
  it("declares a test timeout well above the slowest real test", () => {
    const testTimeout = declaredMs("testTimeout");
    expect(testTimeout, "vitest.config.ts must set testTimeout — see this file's header").not.toBeNull();
    expect(testTimeout).toBeGreaterThanOrEqual(FLOOR_MS);
  });

  it("gives hooks the same room, since beforeAll warms modules too", () => {
    // A `beforeAll` that imports the module under test pays the identical
    // transform cost, against a separate 5s default that would flake the same way.
    const hookTimeout = declaredMs("hookTimeout");
    expect(hookTimeout, "vitest.config.ts must set hookTimeout — see this file's header").not.toBeNull();
    expect(hookTimeout).toBeGreaterThanOrEqual(FLOOR_MS);
  });
});

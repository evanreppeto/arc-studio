import path from "path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Arc runner is a standalone service with its own dependency stack.
    // e2e/** holds the Playwright suite (`pnpm test:e2e`); keep it out of vitest.
    exclude: [...configDefaults.exclude, "e2e/**", "apps/arc-runner/**", "arc-runner/**", "mark-runner/**", ".worktrees/**", ".claude/worktrees/**"],
    // Vitest's 5s default charges MODULE TRANSFORM to the test that triggers it.
    //
    // Dozens of tests here deliberately `await import(…)` inside the test body:
    // it is the only way to get a fresh module after setting an env var or
    // calling `vi.resetModules()`, which is exactly what the "reports the
    // failure instead of an empty list" guards need. The first such import in a
    // file transforms that module's whole tree — for an API route that is the
    // Next server stack — and every millisecond of it lands on the test's clock.
    //
    // Measured on an idle machine, one file, nothing else running:
    // `src/app/api/v1/arc/media/diagnose/route.test.ts` spent 5023ms in its
    // first test and timed out. Under a full 550-file run the same tests pass or
    // fail depending on how many workers happen to be transforming at once —
    // three consecutive clean-tree runs produced 1, 6 and 4 failures, a
    // different set each time, and a fourth run was green.
    //
    // Every one of those failures was `Test timed out in 5000ms`, never a wrong
    // value. The tests were right; the budget was measuring the bundler.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // server-only is a no-op guard; mock it out so tests can import server modules
      "server-only": path.resolve(__dirname, "./src/__mocks__/server-only.ts"),
    },
  },
});

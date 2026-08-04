import { defineConfig, devices } from "@playwright/test";

// Reuse the local dev/preview server (port 6001, see .claude/launch.json) when
// one is already running — Next only allows one `next dev` per project dir, so
// reusing it avoids that guard. In CI nothing is running, so Playwright starts
// its own. Override with E2E_PORT if needed.
// When E2E_BASE_URL is set (e.g. the staging site), test that deployed target
// directly and skip the local dev server. Otherwise default to local.
const EXTERNAL = process.env.E2E_BASE_URL?.replace(/\/+$/, "");
const PORT = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 6001;
const BASE_URL = EXTERNAL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Keep it light — these are smoke tests, one browser is enough.
  workers: process.env.CI ? 2 : undefined,
  // The JSON report is what gives the golden questions a per-question pass/fail
  // record that survives the run (BSR-507). A slow degradation in one capability
  // is invisible in a pass/fail total, and the log scrolls away.
  reporter: process.env.CI
    ? [["github"], ["list"], ["json", { outputFile: "playwright-report/results.json" }]]
    : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Only run a local dev server for local runs; against a deployed target
  // (E2E_BASE_URL) we hit the URL directly.
  webServer: EXTERNAL
    ? undefined
    : {
        // The gallery screens are static assets under public/, but we serve them
        // through the real Next app so the `/`→build-home rewrite is exercised too.
        command: `pnpm exec next dev --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});

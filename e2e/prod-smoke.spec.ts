import { test, expect } from "@playwright/test";

/**
 * PROD smoke — the unauthenticated checks that need no seeded data or
 * credentials, so they are safe to run against the live production site on a
 * schedule. This is deliberately narrow: it proves prod is up and the login
 * wall still holds. The full authenticated flow (sign in, tenant renders,
 * opportunity inbox, approval gate) lives in e2e/guardrails.spec.ts and runs
 * against staging (and prod too, once PROD_E2E_EMAIL / PROD_E2E_PASSWORD secrets
 * are set — see e2e-guardrails.yml).
 *
 * Point it at prod with E2E_BASE_URL:
 *   pnpm test:e2e:smoke:prod
 * or, for any other deployed target:
 *   E2E_BASE_URL=https://some-deploy.example pnpm exec playwright test e2e/prod-smoke.spec.ts
 */

test.describe("prod smoke", () => {
  // Only meaningful against a deployed target. In a default local run there is
  // no prod to hit, so skip.
  test.beforeEach(() => {
    test.skip(!process.env.E2E_BASE_URL, "set E2E_BASE_URL to smoke-test a deploy");
  });

  test("prod is reachable and the login screen renders", async ({ page }) => {
    const resp = await page.goto("/login", { waitUntil: "domcontentloaded" });
    expect(resp?.status(), "HTTP status for /login").toBeLessThan(400);
    await expect(page.locator("body")).toContainText(/sign in/i);
  });

  test("the login wall holds — an unauthenticated visit is bounced to /login", async ({ page }) => {
    await page.goto("/home", { waitUntil: "domcontentloaded" });
    expect(page.url(), "unauthenticated /home should redirect to /login").toContain("/login");
  });
});

import { test, expect, type BrowserContext } from "@playwright/test";

/**
 * End-to-end GUARDRAILS for the deployed app (target: prod — staging was retired
 * 2026-07-16 to cut Vercel cost). These assert the things that would be genuinely
 * scary if they silently broke:
 *   1. the login wall holds — the public can't see the app,
 *   2. a real operator can sign in and the tenant renders,
 *   3. the Opportunity inbox is populated,
 *   4. the campaign approval surface is present (the human gate exists).
 *
 * Every check is READ-ONLY — a sign-in plus three GETs. Nothing is sent,
 * approved, or written, which is what makes them safe to run against prod.
 *
 * Reliable by design: sign-in goes through the real API (no fragile form
 * selectors), and assertions match on visible text (not brittle CSS) — and on
 * shape rather than specific records, so they don't break when the workspace's
 * real data changes. Point it at any deploy with E2E_BASE_URL:
 *
 *   E2E_BASE_URL=https://arc-studio.ai pnpm exec playwright test e2e/guardrails.spec.ts
 */

const EMAIL = process.env.E2E_EMAIL || "owner@bsr.test";
// No fallback: this signs in to PRODUCTION, so the password comes from the
// PROD_E2E_PASSWORD secret or the authenticated checks skip (visibly) rather
// than a working prod credential living in the repo.
const PASSWORD = process.env.E2E_PASSWORD || "";

/**
 * Sign in through the real /api/auth/sign-in endpoint. The Supabase session
 * cookie lands in the shared browser-context cookie jar, so later page
 * navigations are authenticated. We confirm success by the presence of the
 * session cookie (a wrong password redirects the same way but sets no cookie).
 */
async function login(context: BrowserContext) {
  await context.request.post("/api/auth/sign-in", {
    form: { email: EMAIL, password: PASSWORD, rememberMe: "1", from: "/" },
    maxRedirects: 0,
  });
  const cookies = await context.cookies();
  const hasSession = cookies.some((c) => /^sb-.*-auth-token/.test(c.name));
  expect(hasSession, "sign-in should set a Supabase session cookie").toBe(true);
}

/** The authenticated guardrails need a real operator password. Without the
 *  PROD_E2E_PASSWORD secret they skip loudly (reported as skipped) instead of
 *  failing the run or, worse, quietly asserting nothing. */
function requireCredentials() {
  test.skip(!PASSWORD, "set the PROD_E2E_PASSWORD secret to run the authenticated guardrails");
}

test.describe("deployed app guardrails", () => {
  // Guardrails only run against a DEPLOYED target (E2E_BASE_URL). Skip them in a
  // default local run (e.g. CI's local screens job), which has no seeded data or
  // auth — `pnpm test:e2e:guardrails:prod` sets E2E_BASE_URL.
  test.beforeEach(() => {
    test.skip(!process.env.E2E_BASE_URL, "set E2E_BASE_URL to run guardrails against a deploy");
  });

  test("the login wall holds — an unauthenticated visit is bounced to /login", async ({ page }) => {
    await page.goto("/home", { waitUntil: "domcontentloaded" });
    expect(page.url(), "unauthenticated /home should redirect to /login").toContain("/login");
  });

  test("an operator can sign in and the tenant renders", async ({ page, context }) => {
    requireCredentials();
    await login(context);
    await page.goto("/home", { waitUntil: "domcontentloaded" });
    expect(page.url(), "should not be bounced back to login").not.toContain("/login");
    await expect(page.locator("body")).toContainText(/big shoulders/i);
  });

  test("the Opportunity inbox is populated", async ({ page, context }) => {
    requireCredentials();
    await login(context);
    await page.goto("/opportunities", { waitUntil: "domcontentloaded" });
    // Assert the inbox's own summary ("N open · …"), not any particular
    // opportunity: the workspace's real signals churn constantly, so matching
    // fixture titles would go red on a healthy app. A non-zero count is the
    // thing that actually matters — the empty state renders no such count.
    await expect(page.locator("body")).toContainText(/open opportunities/i);
    await expect(page.locator("body")).toContainText(/[1-9]\d*\s+open\b/i);
  });

  test("the campaign approval surface is present (the human gate exists)", async ({ page, context }) => {
    requireCredentials();
    await login(context);
    await page.goto("/campaigns", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/campaign/i);
    await expect(page.locator("body")).toContainText(/approv/i);

    // The two assertions above match STATIC chrome — "approval-gated" sits in the
    // board header and renders whether or not a single campaign loads. That is
    // why this guardrail stayed green twice a day for weeks while prod's board
    // showed zero campaigns for a workspace holding nineteen (BSR-542).
    //
    // The board now distinguishes "failed to load" from "genuinely empty", so
    // assert on that distinction rather than on chrome. Deliberately NOT a
    // non-zero count: a tenant with no campaigns yet is legitimately empty, and
    // a guardrail that reddens for that trains people to ignore it.
    await expect(
      page.locator("body"),
      "the campaigns board reported a failed load — the query is broken, not the workspace empty",
    ).not.toContainText(/couldn’t load campaigns|couldn't load campaigns/i);
  });
});

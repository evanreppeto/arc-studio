import { test, expect, type BrowserContext, type Page } from "@playwright/test";

import { assertExpectedTenant } from "./tenant";

/**
 * End-to-end GUARDRAILS for the deployed app (target: prod — staging was retired
 * 2026-07-16 to cut Vercel cost). These assert the things that would be genuinely
 * scary if they silently broke:
 *   1. the login wall holds — the public can't see the app,
 *   2. a real operator can sign in and the EXPECTED tenant renders,
 *   3. the Opportunity inbox is populated,
 *   4. the campaign approval surface is present (the human gate exists).
 *
 * Every check is READ-ONLY — a sign-in plus three GETs. Nothing is sent,
 * approved, or written, which is what makes them safe to run against prod, and
 * it is what makes it safe to point them at the LIVE tenant.
 *
 * WHICH TENANT — read `./tenant.ts` before changing the credentials.
 *
 * These guardrails answer "is the live product working", so they run against the
 * LIVE workspace (`big-shoulders-restoration-2`, 840470d3…), pinned by
 * E2E_EXPECTED_WORKSPACE_ID and asserted before any content assertion.
 *
 * They used to inherit the NIGHTLY SMOKE's credential (`owner@bsr.test`), whose
 * only membership is the archived seeded org (`big-shoulders-restoration`,
 * 0d2ddb28…). That org was drained on 2026-08-04, so check 3 went red on every
 * merge to main and stayed red — reported as "the Opportunity inbox is empty",
 * which sent people looking for a bug in the opportunity scanner. The inbox was
 * fine. The run was signed into a dead tenant, and because both orgs render the
 * workspace name "Big Shoulders Restoration" nothing on screen said so.
 *
 * The two suites therefore no longer share a credential. The nightly WRITES and
 * must stay on the seeded org; these guardrails only READ and belong on the live
 * one. Separate secrets keep one from silently becoming the other.
 *
 * Reliable by design: sign-in goes through the real API (no fragile form
 * selectors), and assertions match on visible text (not brittle CSS) — and on
 * shape rather than specific records, so they don't break when the workspace's
 * real data changes. Point it at any deploy with E2E_BASE_URL:
 *
 *   E2E_BASE_URL=https://arc-studio.ai \
 *   E2E_EXPECTED_WORKSPACE_ID=<workspace uuid> \
 *   E2E_EMAIL=… E2E_PASSWORD=… pnpm exec playwright test e2e/guardrails.spec.ts
 */

// No fallback. The old `|| "owner@bsr.test"` default is precisely what pointed
// this suite at the drained org: it looked like a convenience and behaved like a
// hidden tenant selector. Unset ⇒ the authenticated guardrails skip visibly.
const EMAIL = process.env.E2E_EMAIL || "";
// No fallback either: this signs in to PRODUCTION, so the password comes from a
// secret rather than a working prod credential living in the repo.
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

/** The authenticated guardrails need a real live-tenant operator credential.
 *  Without the PROD_GUARDRAIL_EMAIL / PROD_GUARDRAIL_PASSWORD secrets they skip
 *  loudly (reported as skipped, and the workflow raises a ::warning) instead of
 *  failing the run or, worse, quietly asserting nothing. */
function requireCredentials() {
  test.skip(
    !EMAIL || !PASSWORD,
    "set the PROD_GUARDRAIL_EMAIL / PROD_GUARDRAIL_PASSWORD secrets to run the authenticated guardrails",
  );
}

/**
 * Sign in, open a page, and prove it is the tenant this run was pointed at —
 * in that order, before the caller asserts anything about what the tenant holds.
 *
 * The ordering is the point. Every content assertion below is downstream of
 * "am I even in the right workspace?", so that question has to be answered
 * first or its answer gets reported as whatever the wrong workspace lacks.
 */
async function openAs(page: Page, context: BrowserContext, path: string, label: string) {
  await login(context);
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await assertExpectedTenant(page, label);
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

  test("an operator can sign in and the EXPECTED tenant renders", async ({ page, context }) => {
    requireCredentials();
    await openAs(page, context, "/home", "sign-in");

    // Deliberately NOT the only identity check, and no longer the meaningful one.
    // `/big shoulders/i` matched both of prod's orgs — it passed happily while
    // the run was signed into the drained one. It stays as a render check (the
    // shell painted something), with `assertExpectedTenant` above doing the
    // actual identifying.
    await expect(page.locator("body")).toContainText(/big shoulders/i);
  });

  test("the Opportunity inbox is populated", async ({ page, context }) => {
    requireCredentials();
    await openAs(page, context, "/opportunities", "opportunity inbox");
    // Assert the inbox's own summary ("N open · …"), not any particular
    // opportunity: the workspace's real signals churn constantly, so matching
    // fixture titles would go red on a healthy app. A non-zero count is the
    // thing that actually matters — the empty state renders no such count.
    await expect(page.locator("body")).toContainText(/open opportunities/i);
    await expect(
      page.locator("body"),
      "the Opportunity inbox rendered its empty state. The tenant assertion above already passed, so this is " +
        "the RIGHT workspace with nothing in its inbox — an opportunity-scan problem, not a credential one.",
    ).toContainText(/[1-9]\d*\s+open\b/i);
  });

  test("the campaign approval surface is present (the human gate exists)", async ({ page, context }) => {
    requireCredentials();
    await openAs(page, context, "/campaigns", "campaign approval surface");
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

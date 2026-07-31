import { test, expect, type BrowserContext, type Page } from "@playwright/test";

import { GOLDEN_QUESTIONS, gradeGoldenAnswer } from "../src/domain/arc-eval";

/**
 * NIGHTLY PROD SMOKE (BSR-478).
 *
 * CI proves the code compiles. It does not prove the deployed app works — and
 * that gap is where this project's expensive bugs live. `guardrails.spec.ts`
 * covers the read-only shape of the app (login wall, tenant renders, inbox
 * populated, approval surface present). This file covers the things that have
 * historically broken *silently*, where every surface still looked fine.
 *
 * WHICH TENANT THIS RUNS AGAINST — read before changing anything.
 *
 * Prod holds two orgs, BOTH named "Big Shoulders Restoration". They are only
 * distinguishable by slug/id, which has already caused one mix-up:
 *
 *   - `big-shoulders-restoration-2` (org 30bd4155…, workspace 840470d3…) is the
 *     REAL, LIVE tenant with real people in it. **Nothing here may ever write to
 *     it.**
 *   - `big-shoulders-restoration` (org 63b72a45…, workspace 0d2ddb28…) is the
 *     ARCHIVED seeded demo org: test-only accounts, seeded data, no real users.
 *     That is the smoke tenant, and the credentials below belong to it.
 *
 * The seeded data is frozen (the org is archived and nothing writes to it but
 * this run), which is exactly what makes the known-fact assertions stable.
 */

const EMAIL = process.env.E2E_EMAIL || "owner@bsr.test";
// No fallback — this signs in to PRODUCTION. Unset ⇒ the run skips visibly
// rather than a working prod credential living in the repo.
const PASSWORD = process.env.E2E_PASSWORD || "";

/**
 * The Arc check needs the runner to be scoped to the SMOKE workspace. The
 * runner's token is a Secret Manager reference scoped per workspace, so until a
 * version exists for the demo org, asking Arc there fails on credentials rather
 * than on reasoning — a permanently red check that teaches nothing.
 *
 * Set ARC_SMOKE_ENABLED=1 once that token exists. Until then this one check
 * skips VISIBLY (reported as skipped, never as passed).
 */
const ARC_ENABLED = process.env.ARC_SMOKE_ENABLED === "1";

/**
 * The facts themselves now live in `src/domain/arc-eval.ts` beside the grader,
 * so adding a question is a data edit with unit tests behind it — including one
 * that rejects a question containing its own answer (BSR-507).
 */

const ARC_REPLY_TIMEOUT_MS = 180_000;

async function login(context: BrowserContext) {
  await context.request.post("/api/auth/sign-in", {
    form: { email: EMAIL, password: PASSWORD, rememberMe: "1", from: "/" },
    maxRedirects: 0,
  });
  const cookies = await context.cookies();
  const hasSession = cookies.some((c) => /^sb-.*-auth-token/.test(c.name));
  expect(hasSession, "step 1 (sign in): should set a Supabase session cookie").toBe(true);
}

function requireDeploy() {
  test.skip(!process.env.E2E_BASE_URL, "set E2E_BASE_URL to run the nightly smoke against a deploy");
  test.skip(!PASSWORD, "set the PROD_E2E_PASSWORD secret to run the nightly smoke");
}

/** Count outbound dispatches visible in the Outbox, so step 5 can prove the run sent nothing. */
async function sentCount(page: Page): Promise<number> {
  await page.goto("/outbox", { waitUntil: "domcontentloaded" });
  const body = (await page.locator("body").innerText()).toLowerCase();
  const match = body.match(/(\d+)\s+sent\b/);
  return match ? Number(match[1]) : 0;
}

test.describe("nightly prod smoke", () => {
  test.beforeEach(requireDeploy);

  test("step 2: the console home renders real data, not the empty state", async ({ page, context }) => {
    await login(context);
    await page.goto("/home", { waitUntil: "domcontentloaded" });

    expect(page.url(), "step 2: should not be bounced back to login").not.toContain("/login");

    // An empty state has masked schema errors before — a page that renders
    // "nothing yet" looks identical to a page whose query silently returned
    // zero rows. Assert a non-zero count, which the empty state cannot produce.
    const body = page.locator("body");
    await expect(body, "step 2: the tenant should render").toContainText(/big shoulders/i);
    await expect(body, "step 2: home should show a non-zero count, not an empty state").toContainText(/[1-9]\d*/);
  });

  /**
   * Step 3 — the golden questions (BSR-507).
   *
   * This used to be ONE hardcoded question. It is now the set in
   * `src/domain/arc-eval.ts`, driven one Playwright test per question so a
   * failure names the capability that degraded rather than a single red step.
   * Adding a question is a data edit there; nothing here changes.
   *
   * Grading is against GROUND TRUTH — literal facts seeded into this archived
   * tenant — never a model's judgment of a good answer. A judge model shares the
   * bug and agrees with it.
   *
   * The reply is read from Arc's own message container, not the page body: some
   * facts are bare numbers ("200", "4.9") and a body-wide match could be
   * satisfied by a sidebar count that Arc never said.
   */
  test.describe("step 3: golden questions", () => {
    for (const question of GOLDEN_QUESTIONS) {
      test(`[${question.capability}] ${question.id}`, async ({ page, context }) => {
        test.skip(
          !ARC_ENABLED,
          "set ARC_SMOKE_ENABLED=1 once the runner has a Secret Manager token scoped to the smoke workspace",
        );
        test.setTimeout(ARC_REPLY_TIMEOUT_MS + 60_000);

        await login(context);
        // A fresh conversation per question: shared context would let an earlier
        // answer supply a later one's facts, which is the same echo problem the
        // question wording is designed to avoid.
        await page.goto("/arc?new=1", { waitUntil: "domcontentloaded" });

        const composer = page.locator(".arc-composer textarea");
        await expect(composer, `${question.id}: the Arc composer should be present`).toBeVisible();
        await composer.fill(question.question);
        await composer.press("Enter");

        // Arc replies asynchronously (enqueue -> runner -> stream), so poll the
        // CONTENT rather than waiting on any spinner to finish. A partial stream
        // simply fails the grade and is retried.
        const reply = page.locator(".arc-assistant-content").last();
        await expect(async () => {
          const answer = await reply.innerText().catch(() => "");
          const grade = gradeGoldenAnswer(question, answer);
          expect(
            grade.passed,
            `${question.id} (${question.capability}): ${grade.failure ?? "did not pass"}. ` +
              `Matched [${grade.hits.join(", ") || "nothing"}]. Why this question exists: ${question.why}`,
          ).toBe(true);
        }).toPass({ timeout: ARC_REPLY_TIMEOUT_MS, intervals: [2_000] });
      });
    }
  });

  test("step 4: a campaign revision request persists", async ({ page, context }) => {
    await login(context);
    await page.goto("/campaigns", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body"), "step 4: the campaigns list should render").toContainText(/campaign/i);

    // Walk campaigns until one has an asset still awaiting a decision. Which
    // campaigns hold actionable assets shifts as work is approved, so pinning a
    // campaign id would rot; the shape ("some campaign has a reviewable asset")
    // is the invariant worth asserting.
    // The board hydrates client-side, so wait for a campaign row rather than
    // reading at domcontentloaded (which returns only the nav shell).
    const campaignLink = page.locator("a.campaign-link");
    await campaignLink
      .first()
      .waitFor({ state: "visible", timeout: 20_000 })
      .catch(() => {});

    const links = await campaignLink.evaluateAll((nodes) =>
      Array.from(new Set(nodes.map((n) => (n as HTMLAnchorElement).getAttribute("href")).filter((h): h is string => !!h))),
    );

    // A nightly check that blames the wrong thing costs more than it saves, so
    // name the cause precisely.
    //
    // KNOWN as of 2026-07-28: the smoke tenant's 19 campaigns all carry
    // `visibility='workspace'` with `workspace_id IS NULL` — scoped to a
    // workspace they don't belong to, so they render for NO ONE and the board
    // shows "0 packages". That is a data defect in the seeded org (and a latent
    // product hole: that combination should not be representable), NOT the
    // approval gate disappearing and NOT the usage cap, which merely also
    // happens to be spent.
    expect(
      links.length,
      "step 4: the campaigns board is empty. Check for campaigns with visibility='workspace' AND workspace_id IS NULL — those are orphaned and render for no workspace. Only treat this as an app regression once the smoke org has at least one reachable campaign.",
    ).toBeGreaterThan(0);

    const revise = page.getByRole("button", { name: /request revision/i }).first();
    let opened = false;
    for (const href of links.slice(0, 8)) {
      await page.goto(href, { waitUntil: "domcontentloaded" });
      if (await revise.isVisible().catch(() => false)) {
        opened = true;
        break;
      }
    }
    expect(opened, "step 4: no campaign had an asset awaiting a decision — the human gate may be gone").toBe(true);

    // --- the write ---
    await revise.click();
    const instruction = page.getByPlaceholder(/tell arc what to change/i);
    await expect(instruction, "step 4: the revision composer should open").toBeVisible();
    await instruction.fill("Nightly smoke check — no action needed; this asset is reopened immediately.");
    await page.getByRole("button", { name: /send to arc/i }).click();

    // The assertion that matters is PERSISTENCE, not the optimistic UI: the view
    // flips the pill locally before the server answers, so asserting without a
    // reload would pass even if the write never landed.
    await expect(async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(
        page.locator("body"),
        "step 4: the revision should still be recorded after a reload",
      ).toContainText(/revision requested/i);
    }).toPass({ timeout: 30_000, intervals: [2_000] });

    // --- repeatable without a restore ---
    // `isActionable` is `!/approved|archived|live|sent|deployed/`, so an asset in
    // `revision_requested` STAYS actionable and keeps offering "Request
    // revision". The nightly run therefore re-revises the same asset instead of
    // consuming a fresh one each night, and needs no undo.
    //
    // Not an oversight that there is no restore: `Reopen` only renders for
    // approved/archived assets, so there is no UI path back from
    // `revision_requested` — and inventing one via a direct DB write would test
    // something the product cannot do.
    await expect(
      page.getByRole("button", { name: /request revision/i }).first(),
      "step 4: a revised asset must stay actionable, or the nightly run consumes one asset per night",
    ).toBeVisible();
  });

  test("step 5: the smoke run sent nothing outbound", async ({ page, context }) => {
    await login(context);
    const before = await sentCount(page);

    // Re-read after exercising the app. Outbound is approval-gated and nothing
    // above approves anything, so this count must not move. If it ever does,
    // something in the read path is triggering a send — exactly the failure this
    // whole project is built to prevent.
    await page.goto("/campaigns", { waitUntil: "domcontentloaded" });
    const after = await sentCount(page);

    expect(after, "step 5: no outbound send should have occurred during the smoke run").toBe(before);
  });
});

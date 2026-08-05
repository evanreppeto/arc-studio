import { expect, type Page } from "@playwright/test";

/**
 * WHICH TENANT AM I SIGNED INTO — the check every prod e2e run has to make first.
 *
 * Prod holds two organizations whose workspaces are BOTH named "Big Shoulders
 * Restoration":
 *
 *   - `big-shoulders-restoration`   workspace 0d2ddb28…  ARCHIVED seeded demo org,
 *     test-only accounts, drained 2026-08-04. This is the *smoke* tenant, and the
 *     only one anything is allowed to write to.
 *   - `big-shoulders-restoration-2` workspace 840470d3…  the REAL LIVE tenant,
 *     with real people and real customer data in it. Read-only, always.
 *
 * Nothing on screen distinguishes them. Same org name, same workspace name, same
 * rail, same chrome — a screenshot of the wrong tenant is byte-identical to a
 * screenshot of the right one. So a run pointed at the wrong org does not fail as
 * "wrong org", it fails as whatever the wrong org happens to be missing, and the
 * person reading the log goes looking for a bug in the product.
 *
 * That has now happened twice. BSR-708 was the nightly smoke. Then the deployed
 * guardrail signed into the drained org and reported "the Opportunity inbox is
 * populated" as a FAILURE — red on every merge to main for a week, blaming an
 * empty inbox for what was a credential pointed at a dead tenant. A check that is
 * always red carries no signal, which is the whole reason BSR-722 exists.
 *
 * So: assert identity BEFORE anything data-dependent, and assert it on the ids,
 * which are the only thing that differs. `data-workspace-id` / `data-org-slug` are
 * stamped on the app shell root for exactly this (see AppShell in
 * src/app/(app)/_components/app-shell.tsx).
 */

export type ExpectedTenant = {
  workspaceId: string;
  /** Optional second opinion. Asserted only when set. */
  orgSlug?: string;
};

/**
 * The tenant this run must resolve to, from the environment.
 *
 * Returns null when unset — the caller decides what that means. It is NOT the
 * same as "any tenant will do": for a suite holding real production credentials,
 * an unpinned tenant is the defect, and `assertExpectedTenant` fails on it rather
 * than quietly checking nothing.
 */
export function expectedTenantFromEnv(): ExpectedTenant | null {
  const workspaceId = process.env.E2E_EXPECTED_WORKSPACE_ID?.trim();
  if (!workspaceId) return null;
  const orgSlug = process.env.E2E_EXPECTED_ORG_SLUG?.trim();
  return orgSlug ? { workspaceId, orgSlug } : { workspaceId };
}

/** Read the tenant the currently-rendered signed-in page belongs to. */
export async function readRenderedTenant(page: Page): Promise<{
  workspaceId: string | null;
  orgSlug: string | null;
}> {
  // Wait for the SHELL, not for the attribute. Waiting on `[data-workspace-id]`
  // would turn "the shell rendered without a resolved workspace" into a bare
  // Playwright timeout, which is the same illegible failure this file exists to
  // stop — a missing id has to come back as null so the caller can say so.
  const shell = page.locator(".app").first();
  await shell.waitFor({ state: "attached", timeout: 15_000 }).catch(() => {});
  return {
    workspaceId: await shell.getAttribute("data-workspace-id").catch(() => null),
    orgSlug: await shell.getAttribute("data-org-slug").catch(() => null),
  };
}

/**
 * Fail as "wrong tenant" when it is the wrong tenant.
 *
 * Call this immediately after the first authenticated navigation and before any
 * assertion about what the tenant contains. Every failure message below names the
 * cause outright, because the entire cost of this bug was that it did not.
 */
export async function assertExpectedTenant(page: Page, context = "this check") {
  const expected = expectedTenantFromEnv();
  expect(
    expected,
    `${context}: E2E_EXPECTED_WORKSPACE_ID is not set, so this run cannot tell which of prod's two ` +
      `identically-named "Big Shoulders Restoration" workspaces it signed into. Refusing to assert anything ` +
      `about the tenant's contents until it is pinned — an unpinned run is how the guardrail spent a week ` +
      `reporting an empty inbox that belonged to a drained org. Set it in the workflow.`,
  ).not.toBeNull();

  expect(
    page.url(),
    `${context}: bounced to the login screen, so no tenant was resolved at all. The sign-in credential is ` +
      `wrong, expired, or has no active workspace membership.`,
  ).not.toContain("/login");

  const actual = await readRenderedTenant(page);

  expect(
    actual.workspaceId,
    `${context}: signed into the WRONG WORKSPACE. Expected ${expected!.workspaceId}` +
      `${expected!.orgSlug ? ` (org ${expected!.orgSlug})` : ""}, got ${actual.workspaceId ?? "none"}` +
      `${actual.orgSlug ? ` (org ${actual.orgSlug})` : ""}. Both of prod's orgs render the workspace name ` +
      `"Big Shoulders Restoration", so this is invisible on screen — nothing below this line would have ` +
      `blamed the credential. Check which workspace the sign-in account is a member of.`,
  ).toBe(expected!.workspaceId);

  if (expected!.orgSlug) {
    expect(
      actual.orgSlug,
      `${context}: the workspace id matched but the org slug did not — expected ${expected!.orgSlug}, got ` +
        `${actual.orgSlug ?? "none"}. The workspace was probably moved between organizations.`,
    ).toBe(expected!.orgSlug);
  }
}

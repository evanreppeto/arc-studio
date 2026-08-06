import { afterEach, describe, expect, it, vi } from "vitest";

import { isWaitingOnOperator, listApprovalCards } from "@/lib/approvals/read-model";
import { listOpenOpportunities } from "@/lib/opportunities/read-model";

import { getNavBadges, getWorkspaceSummary } from "./read-model";

const SUPABASE_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_MARKETING_SUPABASE_URL",
  "MARKETING_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MARKETING_SUPABASE_SERVICE_ROLE_KEY",
];

function unconfigureSupabase() {
  for (const key of SUPABASE_ENV) vi.stubEnv(key, "");
}

describe("workspace summary — nav badges", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("badges the rail with counts that match the screens they point at (demo mode)", async () => {
    unconfigureSupabase();
    vi.stubEnv("ARC_DEMO_DATA", "1");

    const badges = await getNavBadges("demo-org");
    const opportunities = await listOpenOpportunities();
    // The WHOLE queue, not a page of it — see the regression test below.
    const waiting = (await listApprovalCards({ limit: Number.MAX_SAFE_INTEGER })).filter((card) =>
      isWaitingOnOperator(card.status),
    );

    // The Opportunities badge must equal the "N open" the Opportunities screen
    // shows, and the Campaigns badge must equal the "waiting on you" queue.
    expect(badges["/opportunities"]).toBe(opportunities.length);
    expect(badges["/campaigns"]).toBe(waiting.length);
    expect(badges["/opportunities"]).toBeGreaterThan(0);
    expect(badges["/campaigns"]).toBeGreaterThan(0);
  });

  /**
   * The rail read "Campaigns 5" beside a Campaigns page headed "Arc wrote 6
   * assets for you to check", and this suite asserted the 5 was correct.
   *
   * That is the failure worth naming. `countApprovalsWaitingOnOperator` was
   * written precisely to stop a badge being "structurally incapable of
   * exceeding 5" — its own comment says so — but it only fixed the LIVE path.
   * Offline it resolved an admin client, threw, and every caller caught to
   * `null`, falling back to `approvalsNeedingYou.length`: a list fetched with
   * `limit: 5`. The old assertion compared the badge against that same capped
   * fetch, so the two agreed on a number neither had counted, and the bug shows
   * on the demo — the build most people actually look at.
   *
   * So this asserts the property, not the number: the badge must be able to
   * exceed the page size. The demo queue holds 6 waiting items against a page
   * of 5, which is exactly enough to catch a regression to the capped read.
   */
  it("counts the whole queue, not the first page of it", async () => {
    unconfigureSupabase();
    vi.stubEnv("ARC_DEMO_DATA", "1");

    const PAGE_SIZE = 5;
    const badges = await getNavBadges("demo-org");
    const pageOfQueue = await listApprovalCards({ limit: PAGE_SIZE });

    expect(pageOfQueue.length, "the fixture must fill a page for this to prove anything").toBe(PAGE_SIZE);
    expect(badges["/campaigns"], "the badge is capped at the page size again").toBeGreaterThan(PAGE_SIZE);
  });

  it("omits zero-count badges so the rail never shows an empty pill", async () => {
    unconfigureSupabase();
    vi.stubEnv("ARC_DEMO_DATA", "0");

    // No Supabase + demo off → every source is empty, so no badges at all.
    const badges = await getNavBadges("empty-org");
    expect(badges).toEqual({});
  });

  it("exposes a consistent summary snapshot the badges derive from", async () => {
    unconfigureSupabase();
    vi.stubEnv("ARC_DEMO_DATA", "1");

    const summary = await getWorkspaceSummary("demo-org-2");
    expect(summary.opportunities.length).toBeGreaterThan(0);
    expect(summary.approvals.length).toBeGreaterThan(0);
    expect(summary.campaignTotals.total).toBeGreaterThan(0);
    expect(summary.crm.leads).toBeGreaterThan(0);
  });
});

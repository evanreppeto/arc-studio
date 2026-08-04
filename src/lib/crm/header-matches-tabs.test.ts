import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { getCrmNavCounts, getCrmOverviewData } from "./read-model";

/**
 * The CRM header must describe the records in the table beneath it (BSR-656).
 *
 * It used to read `getAnalyticsOverview` — a 30-day marketing funnel belonging
 * to a different screen. On a live workspace that merely answered a different
 * question than the tabs did. In the offline preview the two came from two
 * independently authored fixture sets, and the header rendered
 *
 *     Leads  710          …directly above…      Leads  11
 *
 * a 65× disagreement about the same word, on one screen, in one viewport.
 *
 * Two halves, and it is worth being exact about which catches what, because a
 * check trusted for more than it covers is how this kind of thing returns:
 *
 *  - The behavioural half asks the two READ MODELS the questions the page asks
 *    and requires the answers to agree. It catches the header's own computation
 *    drifting away from the counts (a filter added to "Leads found", say). It
 *    does NOT see the page, so it cannot catch a re-point on its own.
 *  - The source half is what catches a re-point: the page must build its strip
 *    from the CRM's own overview, and must not read the analytics one.
 */

// File-scoped mocks, using the SAME alias specifiers the rest of the suite uses
// (`@/lib/...`). A relative specifier registers a different module identity than
// the alias other files mock, which is how an earlier version of this file broke
// eight unrelated tests.
vi.mock("@/lib/demo/demo-mode", () => ({ isDemoDataEnabled: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: () => false,
  getSupabaseAdminClient: () => {
    throw new Error("not configured in this test");
  },
}));

/** The header stat that answers the same question as each tab. */
const HEADER_STAT_FOR_TAB: Array<{ stat: string; tab: "leads" | "companies" | "jobs" }> = [
  { stat: "Leads found", tab: "leads" },
  { stat: "Companies", tab: "companies" },
  { stat: "Projects tracked", tab: "jobs" },
];

describe("the CRM header and its tabs count the same records", () => {
  it.each(HEADER_STAT_FOR_TAB)('"$stat" equals the $tab tab', async ({ stat, tab }) => {
    const [overview, navCounts] = await Promise.all([getCrmOverviewData(), getCrmNavCounts()]);
    expect(overview.status).toBe("live");
    expect(navCounts.status).toBe("live");
    if (overview.status !== "live" || navCounts.status !== "live") return;

    const cell = overview.stats.find((s) => s.label === stat);
    expect(cell, `the header no longer has a "${stat}" stat`).toBeDefined();

    expect(
      Number(cell!.value),
      `the header says ${cell!.value} ${stat} while the ${tab} tab says ${navCounts.counts[tab]}`,
    ).toBe(navCounts.counts[tab]);
  });

  /**
   * The specific regression: a header sourced from the analytics demo reported
   * 710 leads against a bundle holding 11. Nothing about the CRM's own data can
   * produce a number that large, so an implausible one means the strip has been
   * re-pointed at another dataset again.
   */
  it("reports a lead count the record store could actually hold", async () => {
    const [overview, navCounts] = await Promise.all([getCrmOverviewData(), getCrmNavCounts()]);
    if (overview.status !== "live" || navCounts.status !== "live") throw new Error("demo reads should be live");

    const leads = Number(overview.stats.find((s) => s.label === "Leads found")!.value);
    expect(leads).toBeLessThanOrEqual(navCounts.counts.leads);
    expect(leads).toBeGreaterThan(0);
  });
});

/** Strip comments so the note explaining the old source is not read as the old source. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the CRM page does not borrow another screen's dataset", () => {
  const page = withoutComments(readFileSync(new URL("../../app/(app)/crm/page.tsx", import.meta.url), "utf8"));

  it("builds its KPI strip from the CRM's own overview", () => {
    expect(page).toContain("getCrmOverviewData()");
    expect(page).toContain("overview.stats.map");
  });

  it("does not read the analytics overview", () => {
    expect(page).not.toContain("getAnalyticsOverview");
    expect(page).not.toContain("@/lib/analytics/overview");
  });
});

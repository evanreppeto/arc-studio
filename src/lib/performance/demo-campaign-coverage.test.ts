import { afterEach, describe, expect, it } from "vitest";

import { buildDemoCampaignWorkspaceList } from "@/lib/campaigns/read-model";

import { demoCampaignSeeds, getCampaignAnalyticsDemoDetail } from "./campaign-demo-detail";

/**
 * Every demo campaign has performance data, in every industry the demo serves.
 *
 * This is the invariant that was missing, and its absence hid a working feature
 * for months. The performance seeds were keyed to the six RESTORATION campaigns.
 * `demoCampaigns()` serves those only under `ARC_DEMO_INDUSTRY=restoration`, and
 * no launch config set it — so the default preview served four generic
 * campaigns, none of which had seeds:
 *
 *   - every campaign's Performance tab fell to the "measuring" empty state,
 *   - the analytics table rendered six rows whose ids matched no campaign, so
 *     every link went to "That page isn't here",
 *   - and the display names had been genericised while the ids had not, so the
 *     same campaign was "Pricing-Intent Fast Track 2026" in the table and
 *     "Emergency Water Response 2026" on its own page.
 *
 * Nothing failed. Every unit test passed, because the one test that touched this
 * data asked for `demo-emergency-water-response-2026` by name — an id that is
 * real, just unreachable from the preview anyone actually opened.
 *
 * The check has to run against BOTH branches. Pinning one industry is how the
 * gap opened: the covered set was tested, the served set was not.
 */

const INDUSTRIES = [
  { key: undefined, label: "default (generic)" },
  { key: "restoration", label: "restoration" },
];

const original = process.env.ARC_DEMO_INDUSTRY;
afterEach(() => {
  if (original === undefined) delete process.env.ARC_DEMO_INDUSTRY;
  else process.env.ARC_DEMO_INDUSTRY = original;
});

function withIndustry<T>(key: string | undefined, fn: () => T): T {
  if (key === undefined) delete process.env.ARC_DEMO_INDUSTRY;
  else process.env.ARC_DEMO_INDUSTRY = key;
  return fn();
}

/** The demo campaigns as ids+names, from the list the operator actually sees. */
function demoCampaignList(): Array<{ id: string; name: string }> {
  const result = buildDemoCampaignWorkspaceList("Arc");
  if (result.status !== "live") throw new Error(`demo campaign list is ${result.status}, not live`);
  return result.campaigns.map((c) => ({ id: c.id, name: c.name }));
}

describe("demo campaigns and their performance data agree", () => {
  for (const { key, label } of INDUSTRIES) {
    describe(label, () => {
      it("gives every campaign in the list a performance detail", () => {
        const { campaignIds, seedIds } = withIndustry(key, () => ({
          campaignIds: demoCampaignList().map((c) => c.id),
          seedIds: demoCampaignSeeds().map((s) => s.id),
        }));

        expect(campaignIds.length, "the demo should serve campaigns at all").toBeGreaterThan(0);
        const missing = campaignIds.filter((id) => !seedIds.includes(id));
        expect(
          missing,
          "these campaigns are reachable but have no performance seed — their Performance tab shows the empty state",
        ).toEqual([]);
      });

      it("has no performance seed for a campaign that does not exist", () => {
        // The other direction, and the one that produced the 404s: a seed with
        // no campaign becomes an analytics row linking to a missing page.
        const { campaignIds, seedIds } = withIndustry(key, () => ({
          campaignIds: demoCampaignList().map((c) => c.id),
          seedIds: demoCampaignSeeds().map((s) => s.id),
        }));

        const orphaned = seedIds.filter((id) => !campaignIds.includes(id));
        expect(
          orphaned,
          "these seeds render an analytics row whose link resolves to nothing",
        ).toEqual([]);
      });

      it("gives the detail view the same name the campaign list uses", () => {
        // One campaign, one name. The genericised-names-on-restoration-ids bug
        // was invisible precisely because each surface was self-consistent.
        const mismatches = withIndustry(key, () => {
          const byId = new Map(demoCampaignList().map((c) => [c.id, c.name]));
          return demoCampaignSeeds()
            .map((seed) => {
              const listName = byId.get(seed.id);
              return listName && listName !== seed.name ? `${seed.id}: list "${listName}" vs detail "${seed.name}"` : null;
            })
            .filter(Boolean);
        });
        expect(mismatches).toEqual([]);
      });

      it("actually builds a detail for each campaign, not just an id match", () => {
        // Guards the premise: an id list that agrees while the builder returns
        // null would pass everything above and still render nothing.
        const details = withIndustry(key, () =>
          demoCampaignSeeds().map((s) => getCampaignAnalyticsDemoDetail(s.id)),
        );
        expect(details.every((d) => d !== null)).toBe(true);
        for (const d of details) {
          expect(d!.kpis.length, "the panel's six KPIs").toBe(6);
          expect(d!.assets.length).toBeGreaterThan(0);
          expect(d!.channels.length).toBeGreaterThan(0);
        }
      });
    });
  }

  it("serves a different campaign set per industry, which is the thing that made this subtle", () => {
    // If these ever collapse to one set this whole file becomes a tautology.
    const generic = withIndustry(undefined, () => demoCampaignSeeds().map((s) => s.id));
    const restoration = withIndustry("restoration", () => demoCampaignSeeds().map((s) => s.id));
    expect(generic).not.toEqual(restoration);
    expect(generic.some((id) => restoration.includes(id))).toBe(false);
  });
});

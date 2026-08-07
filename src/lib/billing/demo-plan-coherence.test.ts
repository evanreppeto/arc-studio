import { describe, expect, it } from "vitest";

import { planCapCents, planForTier } from "@/domain";
import { DEMO_PLAN_TIER } from "@/lib/demo/demo-mode";
import { getSettingsUsageView } from "@/lib/ai-usage/settings-summary";
import { getSettingsBillingView } from "./settings-billing";

/**
 * Settings → Usage & billing shows the plan cap twice: once as the denominator
 * of the usage meter ("49% of your $100 Starter plan cap") and once on the plan
 * panel a few inches below ("$25/mo monthly cap"). Those came from two places
 * and disagreed — in the demo preview by $75, and on production by $248, where
 * a workspace $16 into a $250 negotiated cap was told it had a $2 one.
 *
 * A reader has no way to tell which number is real, and the reassuring one was
 * wrong both times. These tests hold the two sources to the same answer.
 */
describe("plan cap coherence (offline demo)", () => {
  const withDemo = async <T,>(fn: () => Promise<T>): Promise<T> => {
    const prev = process.env.ARC_DEMO_DATA;
    process.env.ARC_DEMO_DATA = "1";
    try {
      return await fn();
    } finally {
      if (prev === undefined) delete process.env.ARC_DEMO_DATA;
      else process.env.ARC_DEMO_DATA = prev;
    }
  };

  it("quotes one cap for one plan across both panels", async () => {
    const [usage, billing] = await withDemo(async () =>
      Promise.all([getSettingsUsageView(), getSettingsBillingView()]),
    );
    // The meter's denominator and the plan panel's cap describe the same money.
    expect(usage?.capLabel).toBe(billing.capLabel.replace("/mo", ""));
    expect(usage?.planLabel).toBe(billing.planLabel);
  });

  it("names the plan whose cap it is actually using", async () => {
    const usage = await withDemo(() => getSettingsUsageView());
    // The old fixture labelled a $100 cap "Starter". Starter's cap is $25.
    expect(usage?.planLabel).toBe(planForTier(DEMO_PLAN_TIER).label);
    expect(usage?.capLabel).toBe(`$${planCapCents(DEMO_PLAN_TIER) / 100}`);
  });

  it("derives the percentage rather than asserting it", async () => {
    const usage = await withDemo(() => getSettingsUsageView());
    // pctOfCap was a hand-written 49 that stayed 49 no matter what the cap was.
    const cents = Number((usage?.costLabel ?? "$0").replace(/[$,]/g, "")) * 100;
    const expected = Math.round((cents / planCapCents(DEMO_PLAN_TIER)) * 100);
    expect(usage?.pctOfCap).toBe(expected);
  });

  it("does not name a real tenant in its example rows", async () => {
    const usage = await withDemo(() => getSettingsUsageView());
    const actors = (usage?.recent ?? []).map((r) => r.actor).join(" ").toLowerCase();
    expect(actors).not.toContain("bigshoulders");
  });
});

import { describe, expect, it, vi } from "vitest";

const spend = vi.hoisted(() => ({ getConnectorSpendView: vi.fn() }));
vi.mock("@/lib/connectors/spend-summary", () => spend);

import { getMediaSpendMeter } from "./spend-meter";

function view(over: Record<string, unknown> = {}) {
  return {
    isDemo: false,
    configured: true,
    capCents: 5_000,
    capDollars: 50,
    capLabel: "$50.00",
    spentLabel: "$13.20",
    remainingLabel: "$36.80",
    pctOfCap: 26,
    isNearCap: false,
    isOverCap: false,
    periodLabel: "This month",
    rows: [
      { key: "gemini-media", label: "Media", costCents: 0, costLabel: "$0.00", units: 0, count: 0, disclosure: null },
      { key: "lead-enrichment", label: "Enrichment", costCents: 1_320, costLabel: "$13.20", units: 660, count: 3, disclosure: null },
    ],
    ...over,
  };
}

describe("getMediaSpendMeter", () => {
  // The bug this guards: the headline quoted MEDIA-only spend beside the SHARED
  // cap and remainder, so the strip read "$0.00 of $50.00 used" next to "$36.80
  // left" — arithmetic that visibly doesn't add up, and an implication that the
  // whole cap belonged to generation.
  it("reports total metered spend against the cap, so spent + remaining = cap", async () => {
    spend.getConnectorSpendView.mockResolvedValue(view());
    const m = await getMediaSpendMeter();

    expect(m.spentLabel).toBe("$13.20");
    expect(m.capLabel).toBe("$50.00");
    expect(m.remainingLabel).toBe("$36.80");
    // Generation's own share is reported separately, not as the headline.
    expect(m.mediaSpentLabel).toBe("$0.00");
    expect(m.mediaIsAllSpend).toBe(false);
  });

  it("suppresses the redundant share when generation is the only spend", async () => {
    spend.getConnectorSpendView.mockResolvedValue(
      view({
        rows: [
          { key: "gemini-media", label: "Media", costCents: 900, costLabel: "$9.00", units: 150, count: 12, disclosure: null },
        ],
      }),
    );
    const m = await getMediaSpendMeter();
    expect(m.mediaIsAllSpend).toBe(true);
    expect(m.spentLabel).toBe("$9.00");
  });

  it("quotes per-job cost in currency, not units or tokens", async () => {
    spend.getConnectorSpendView.mockResolvedValue(view());
    const m = await getMediaSpendMeter();
    expect(m.perJob).toEqual({ image: "$0.06", video: "$0.60" });
  });

  it("hides itself when there is no cap or no backend", async () => {
    spend.getConnectorSpendView.mockResolvedValue(view({ capCents: 0 }));
    expect((await getMediaSpendMeter()).show).toBe(false);

    spend.getConnectorSpendView.mockResolvedValue(view({ configured: false }));
    expect((await getMediaSpendMeter()).show).toBe(false);
  });

  // This renders above the Studio; a billing read must never take the page down.
  it("degrades to hidden rather than throwing", async () => {
    spend.getConnectorSpendView.mockRejectedValue(new Error("ledger unavailable"));
    await expect(getMediaSpendMeter()).resolves.toMatchObject({ show: false });
  });
});

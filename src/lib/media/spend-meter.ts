import { MEDIA_CONNECTOR, describeMediaJobCosts, formatCents } from "@/domain";
import { getConnectorSpendView } from "@/lib/connectors/spend-summary";

// Read-model for the Studio's spend meter.
//
// BSR-515 asks for the running total to be visible "in the Studio itself — not
// buried in Settings". Settings already renders the full metered-connector
// breakdown; this is the narrow, media-only slice shown where the money is
// actually spent, at the moment someone is about to spend it.

export type MediaSpendMeter = {
  /** False when there is nothing meaningful to show (no cap, offline, unpriced). */
  show: boolean;
  /**
   * Spend across ALL metered connectors — the figure the cap is actually
   * measured against, and therefore the one that decides whether the next
   * generate is refused.
   */
  spentLabel: string;
  /** Generation's own share of that spend, for context. */
  mediaSpentLabel: string;
  /** True when media is the only thing that has spent anything this period. */
  mediaIsAllSpend: boolean;
  capLabel: string;
  remainingLabel: string;
  pctOfCap: number;
  isNearCap: boolean;
  isOverCap: boolean;
  periodLabel: string;
  /** Per-job cost in currency, e.g. { image: "$0.06", video: "$0.60" }. */
  perJob: { image: string; video: string } | null;
};

const HIDDEN: MediaSpendMeter = {
  show: false,
  spentLabel: "",
  mediaSpentLabel: "",
  mediaIsAllSpend: false,
  capLabel: "",
  remainingLabel: "",
  pctOfCap: 0,
  isNearCap: false,
  isOverCap: false,
  periodLabel: "",
  perJob: null,
};

/**
 * The workspace's media spend for the current period.
 *
 * Reuses the connector spend view rather than re-querying, so the number in the
 * Studio and the number in Settings cannot disagree — but reports only the media
 * connector's own spend, since that is the figure a generate action moves.
 *
 * Degrades to hidden on any failure: this renders above the Studio, and a
 * billing read must never be able to take the page down.
 */
export async function getMediaSpendMeter(): Promise<MediaSpendMeter> {
  try {
    const view = await getConnectorSpendView();
    if (!view.configured || view.capCents <= 0) return HIDDEN;

    const mediaCents = view.rows.find((r) => r.key === MEDIA_CONNECTOR)?.costCents ?? 0;
    const totalCents = view.rows.reduce((sum, r) => sum + r.costCents, 0);

    return {
      show: true,
      // The cap is SHARED across every metered connector, so the headline has to
      // be total spend against it. Quoting media's own spend beside the shared
      // cap and remainder produced arithmetic that visibly didn't add up
      // ("$0.00 of $50.00 used" next to "$36.80 left") and implied the whole cap
      // belonged to generation.
      spentLabel: formatCents(totalCents),
      mediaSpentLabel: formatCents(mediaCents),
      mediaIsAllSpend: mediaCents >= totalCents,
      capLabel: view.capLabel,
      remainingLabel: view.remainingLabel,
      pctOfCap: view.pctOfCap,
      isNearCap: view.isNearCap,
      isOverCap: view.isOverCap,
      periodLabel: view.periodLabel,
      perJob: describeMediaJobCosts(),
    };
  } catch {
    return HIDDEN;
  }
}

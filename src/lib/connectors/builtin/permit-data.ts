import type { OpportunityCandidate } from "@/domain";

import { registerSignalSource, type SignalDetectContext, type SignalSourceConnector } from "../registry";

// ---------------------------------------------------------------------------
// Metered `signal_source` connector (BSR-372). This is the reference consumer of
// the cost-governance path: a PAID third-party data vendor. Read-only — it derives
// permit-backed opportunity candidates deterministically from its per-workspace
// config (the municipalities to watch) and makes NO write. A production build
// swaps detect() for a real permit/property API (BSR-368 enrichment); the shape
// stays identical.
//
// Cost model: each watched municipality is one billable lookup. The detection
// orchestrator authorises the run against the workspace spend cap and records the
// units it actually scanned — see estimateBillableUnits + src/lib/connectors/metering.ts.
// ---------------------------------------------------------------------------

function readMunicipalities(config: Record<string, unknown>): string[] {
  const raw = config.municipalities ?? config.locations;
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

/**
 * How many billable lookups a scan of this config will make. Used up-front to
 * price the run for the cap check, and again after to record actual usage. One
 * paid lookup per watched municipality.
 */
export function estimateBillableUnits(config: Record<string, unknown>): number {
  return readMunicipalities(config).length;
}

/**
 * No permit source exists yet, so there are no permit findings to report — [].
 *
 * This used to invent one. From a municipality NAME the operator typed, and nothing
 * else, it asserted `"Paid permit records flagged fresh renovation/restoration
 * filings in {municipality}"` at confidence 65 — and estimateBillableUnits charged a
 * metered lookup per municipality for the invention. The `evidence.note` said
 * "Stub", but the title and summary read as source-backed, and the inbox shows the
 * title. An operator cannot tell a fabricated finding from a real one by looking.
 *
 * That is strictly worse than proposing nothing: a connector that stays quiet costs
 * an operator nothing, while one that invents source-backed findings spends their
 * money and their trust. Same reasoning as the weather service-area default (#473)
 * and the filter that stopped Air Quality alerts being filed as storm damage (#499).
 *
 * When a real permit/property API lands (BSR-368), give this the shape its siblings
 * already have — reviews-signal and competitor-ads take injectable sources and
 * return [] when unconfigured, which is why neither of them ever invented anything.
 * The metering path around it (estimateBillableUnits + the cap check) is real and
 * stays: it prices what a scan WOULD cost, which is what the cost-governance work
 * needed a reference consumer for.
 */
export function detectPermitOpportunities(_ctx: Pick<SignalDetectContext, "config">): OpportunityCandidate[] {
  return [];
}

export const permitDataConnector: SignalSourceConnector = {
  key: "permit-data",
  detect: (ctx) => detectPermitOpportunities(ctx),
  // ZERO while `detect()` is a stub, not `estimateBillableUnits(config)`.
  //
  // `meterConnectorCall` records `estimatedUnits` as ACTUAL spend unless the
  // caller supplies `unitsFromResult`, and `runSignalSourceDetection` does not.
  // So pricing this at one lookup per municipality charged a metered call, on
  // every daily scan, for a detector that makes no request and returns [] —
  // billing an operator for nothing, indefinitely, with no finding to show for
  // it. Refusing to invent findings (above) but still charging for them would
  // have been the same broken promise wearing a different hat.
  //
  // `estimateBillableUnits` stays exported: it is the real pricing model for
  // when a permit source lands (BSR-368). Restore it here at the same time, so
  // the cost and the work can never disagree again.
  estimateUnits: () => 0,
};

registerSignalSource(permitDataConnector);

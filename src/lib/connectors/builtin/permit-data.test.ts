import { describe, expect, it } from "vitest";

import { estimateBillableUnits, permitDataConnector } from "./permit-data";

/**
 * permit-data has no permit source yet, so `detect()` returns [] — it makes no
 * request at all. It used to INVENT a source-backed-looking finding from a
 * municipality name; that was removed.
 *
 * The cost half outlived the fix. `meterConnectorCall` records `estimatedUnits`
 * as actual spend unless the caller passes `unitsFromResult`, and
 * `runSignalSourceDetection` does not — so pricing a scan at one lookup per
 * municipality billed an operator, on every daily scan, for a detector that
 * does nothing. Refusing to fabricate findings while still charging for them is
 * the same broken promise in a different form.
 */
describe("permit-data costs nothing while it can find nothing", () => {
  const config = { municipalities: ["Chicago", "Naperville", "Evanston"] };

  it("finds nothing — no source exists yet", () => {
    expect(permitDataConnector.detect({ config } as never)).toEqual([]);
  });

  it("charges zero units, however many municipalities are watched", () => {
    expect(permitDataConnector.estimateUnits?.(config)).toBe(0);
    expect(permitDataConnector.estimateUnits?.({ municipalities: Array(50).fill("x") })).toBe(0);
  });

  it("keeps the real pricing model for when a source lands (BSR-368)", () => {
    // estimateBillableUnits is still the per-municipality model; it is simply
    // not wired to the connector while detect() is a stub. Re-wire both together.
    expect(estimateBillableUnits(config)).toBe(3);
  });
});

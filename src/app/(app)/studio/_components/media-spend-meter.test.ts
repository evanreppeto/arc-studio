import { describe, expect, it } from "vitest";

import { spendStripTone } from "./media-spend-meter";

// BSR-703. The strip claimed to be "quiet by default" while rendering a
// full-width bordered banner at $0 spent — the first thing on Studio every
// visit, warning about nothing. An operator asked for it to be turned off; it
// had no off switch, and it had no quiet state either.
//
// It must not disappear: M6 requires the operator sees cost BEFORE generating.
// So the rule is volume, not visibility — and these lock the thresholds, since
// drifting back to always-loud is exactly the change nobody would notice.
describe("spendStripTone", () => {
  it("stays quiet below the near-cap threshold", () => {
    expect(spendStripTone({ isNearCap: false, isOverCap: false })).toBe("quiet");
  });

  it("raises its voice only once spend approaches the cap", () => {
    expect(spendStripTone({ isNearCap: true, isOverCap: false })).toBe("warn");
  });

  it("is loudest when generation is actually blocked", () => {
    expect(spendStripTone({ isNearCap: true, isOverCap: true })).toBe("blocked");
  });

  it("treats over-cap as blocked even if the near-cap flag disagrees", () => {
    // The two flags come from separate comparisons; being over the cap is the
    // stronger fact and must win rather than rendering a mere warning while
    // generation is refused.
    expect(spendStripTone({ isNearCap: false, isOverCap: true })).toBe("blocked");
  });
});

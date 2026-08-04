import { describe, expect, it } from "vitest";

import { ASSET_NOUN, CAMPAIGN_NOUN, countOf, DAY_NOUN } from "../vocabulary";

/**
 * The counted-noun half of the vocabulary module had no tests at all, which is
 * part of why "1 days" survived: `countOf` was already correct, and the
 * surfaces simply hard-coded "days" beside it instead of calling it (BSR-690).
 */
describe("countOf", () => {
  it("agrees in number at the boundary", () => {
    expect(countOf(1, DAY_NOUN)).toBe("1 day");
    expect(countOf(2, DAY_NOUN)).toBe("2 days");
    expect(countOf(1, ASSET_NOUN)).toBe("1 asset");
    expect(countOf(4, ASSET_NOUN)).toBe("4 assets");
    expect(countOf(1, CAMPAIGN_NOUN)).toBe("1 campaign");
  });

  it("keeps the plural at zero, as English does", () => {
    expect(countOf(0, DAY_NOUN)).toBe("0 days");
    expect(countOf(0, ASSET_NOUN)).toBe("0 assets");
  });

  it("does not treat a negative one as singular", () => {
    expect(countOf(-1, DAY_NOUN)).toBe("-1 days");
  });
});

import { describe, expect, it } from "vitest";

import { shortName } from "./short-name";

/**
 * BSR-732. The live inbox listed two weather cards both reading "Flood
 * Advisory" — the row name kept only the text before the em-dash, which for a
 * weather title is exactly the half every alert of that type shares.
 */
const WILL = "Flood Advisory — Cook, IL / Will, IL";
const DUPAGE = "Flood Advisory — Cook, IL / DuPage, IL +1 more";

describe("shortName", () => {
  it("keeps the qualifier when a sibling would otherwise read identically", () => {
    const a = shortName(WILL, [WILL, DUPAGE]);
    const b = shortName(DUPAGE, [WILL, DUPAGE]);

    expect(a).not.toBe(b);
    expect(a).toContain("Will");
    expect(b).toContain("DuPage");
  });

  it("still shortens to the head when nothing collides", () => {
    expect(shortName(WILL, [WILL, "Two idle background creatives — flood response"])).toBe("Flood Advisory");
  });

  it("shortens when given no siblings at all", () => {
    expect(shortName(WILL)).toBe("Flood Advisory");
  });

  it("does not treat a row as its own sibling", () => {
    expect(shortName(WILL, [WILL])).toBe("Flood Advisory");
  });

  it("truncates anything past the column width, with an ellipsis", () => {
    const long = `${"Flood Advisory".padEnd(80, "x")} — Cook, IL`;
    const out = shortName(long, []);

    expect(out.length).toBeLessThanOrEqual(46);
    expect(out.endsWith("…")).toBe(true);
  });

  it("truncates the FULL title when the qualifier is what disambiguates", () => {
    // The trade this fix makes: a long colliding title loses its tail rather
    // than its qualifier. Precision at the end beats no distinction at all.
    const out = shortName(DUPAGE, [WILL, DUPAGE]);
    expect(out.startsWith("Flood Advisory — Cook, IL / DuPage")).toBe(true);
  });

  it("falls back to the whole title when there is no dash to split on", () => {
    expect(shortName("Two idle background creatives", [])).toBe("Two idle background creatives");
  });
});

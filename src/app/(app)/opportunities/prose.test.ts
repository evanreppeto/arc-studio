import { describe, expect, it } from "vitest";

import { rowName, rowQualifier } from "./prose";

describe("rowName + rowQualifier", () => {
  it("tells two advisories apart, which the name alone cannot", () => {
    // Both were live in the inbox at once, and both rendered as "Flood Advisory".
    const a = "Flood Advisory — Cook, IL / DuPage, IL +1 more";
    const b = "Flood Advisory — Cook, IL / Will, IL";
    expect(rowName(a)).toBe("Flood Advisory");
    expect(rowName(b)).toBe("Flood Advisory");
    expect(rowQualifier(a)).toBe("Cook, IL / DuPage, IL +1 more");
    expect(rowQualifier(b)).toBe("Cook, IL / Will, IL");
    expect(rowQualifier(a)).not.toBe(rowQualifier(b));
  });

  it("has no qualifier when the title carries no dash", () => {
    expect(rowQualifier("A competitor launched a new comparison campaign")).toBeNull();
  });

  it("does not split on a hyphenated word", () => {
    expect(rowName("Flash-flood warning")).toBe("Flash-flood warning");
    expect(rowQualifier("Flash-flood warning")).toBeNull();
  });

  it("clips a lead too long to scan", () => {
    const name = rowName(
      "Two idle emergency-homeowner background creatives could seed a flood-response package",
    );
    expect(name.length).toBeLessThanOrEqual(46);
    expect(name.endsWith("…")).toBe(true);
  });
});

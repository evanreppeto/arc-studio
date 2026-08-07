import { describe, expect, it } from "vitest";

import { MAX_IMPORT_ROWS, planCustomImport } from "./import";

/**
 * Planning a CSV import for a tenant-defined record type.
 *
 * The plan is the half the operator sees before anything is written, and it is
 * pure — so it is where the decisions worth pinning live: which column names
 * the record, which columns become fields, and what gets skipped rather than
 * invented.
 */

describe("planCustomImport", () => {
  const csv = "Name,Serial number,Condition\nExtractor #3,X-1183,In service\nAir scrubber,A-9,Needs repair\n";

  it("takes the first column as the name and makes fields of the rest", () => {
    const res = planCustomImport(csv);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.plan.titleHeader).toBe("Name");
    expect(res.plan.fields.map((f) => f.label)).toEqual(["Serial number", "Condition"]);
    expect(res.plan.rowCount).toBe(2);
  });

  it("lets the operator choose a different name column", () => {
    const res = planCustomImport(csv, "Serial number");
    if (!res.ok) return expect.fail("expected a plan");

    expect(res.plan.titleHeader).toBe("Serial number");
    // The old name column becomes a field — nothing is dropped by re-choosing.
    expect(res.plan.fields.map((f) => f.label)).toContain("Name");
  });

  it("ignores a name column that isn't in the file", () => {
    // A stale choice left over from a previous file must not silently produce
    // an import where every row is unnamed and therefore skipped.
    const res = planCustomImport(csv, "Nonexistent");
    if (!res.ok) return expect.fail("expected a plan");
    expect(res.plan.titleHeader).toBe("Name");
  });

  /**
   * A row with no name cannot be named, and inventing one ("Untitled") is worse
   * than skipping: afterwards nobody can tell which records were real.
   */
  it("counts unnamed rows as skipped rather than inventing names", () => {
    const res = planCustomImport("Name,Serial\nExtractor,X-1\n,X-2\n  ,X-3\n");
    if (!res.ok) return expect.fail("expected a plan");

    expect(res.plan.rowCount).toBe(3);
    expect(res.plan.unnamedRows).toBe(2);
  });

  /**
   * Two headers can normalise to one field key. Taking the first keeps the
   * import deterministic — otherwise the later column silently overwrites the
   * earlier one's values, with nothing on screen to say so.
   */
  it("keeps one field when two headers collide on a key", () => {
    const res = planCustomImport("Name,Serial #,Serial number\nA,1,2\n");
    if (!res.ok) return expect.fail("expected a plan");

    const keys = res.plan.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("refuses an empty file, a header-only file, and one that is too big", () => {
    expect(planCustomImport("")).toMatchObject({ ok: false });
    expect(planCustomImport("Name,Serial\n")).toMatchObject({ ok: false });

    const huge = ["Name", ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Row ${i}`)].join("\n");
    const res = planCustomImport(huge);
    expect(res.ok).toBe(false);
    // Says the real number rather than truncating quietly.
    if (!res.ok) expect(res.error).toContain(String(MAX_IMPORT_ROWS + 1));
  });

  it("shows a few real rows so the mapping can be sanity-checked", () => {
    const res = planCustomImport(csv);
    if (!res.ok) return expect.fail("expected a plan");

    expect(res.plan.sample[0]).toMatchObject({
      title: "Extractor #3",
      values: { "Serial number": "X-1183", Condition: "In service" },
    });
  });

  /** Blank lines are file noise, not records. */
  it("does not count blank lines as rows", () => {
    const res = planCustomImport("Name,Serial\nA,1\n\n\nB,2\n");
    if (!res.ok) return expect.fail("expected a plan");
    expect(res.plan.rowCount).toBe(2);
  });
});

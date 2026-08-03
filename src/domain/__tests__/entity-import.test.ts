import { describe, expect, it } from "vitest";

import { parseEntityCsv, parseUsdToCents } from "../entity-import";

/**
 * BSR-644. "Bring in my CRM tabs and relationships" used to mean "bring in a flat
 * contact list". These cover the parsing half — reading the source system's own
 * ids out of each file, which is what lets the relationships between files
 * survive a re-import.
 */

describe("parseEntityCsv — companies", () => {
  it("reads the source id so later files can reference this company", () => {
    const csv = "Record ID,Company name,Website,Phone\n7431,Acme Restoration,acme.example,312-555-0100";
    const out = parseEntityCsv("companies", csv);

    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      externalId: "7431",
      values: { name: "Acme Restoration", website: "acme.example", phone: "312-555-0100" },
    });
  });

  it("skips a row with no name, and says which row and why", () => {
    const csv = "id,name\n1,Acme\n2,\n3,Beta";
    const out = parseEntityCsv("companies", csv);

    expect(out.rows).toHaveLength(2);
    // Row 3 of the file — header is row 1 — so the operator can find it.
    expect(out.skipped).toEqual([{ row: 3, reason: "no name" }]);
  });

  it("dedupes a repeated source id within one file", () => {
    const csv = "id,name\n1,Acme\n1,Acme again";
    expect(parseEntityCsv("companies", csv).rows).toHaveLength(1);
  });
});

describe("parseEntityCsv — deals", () => {
  it("keeps the company reference as an id, not a name", () => {
    // Names are not stable keys: two "Acme" companies, or a rename between
    // exports, and the deal attaches to the wrong record or to nothing.
    // The amount is quoted, as a real export emits it — an unquoted "$12,500.50"
    // is two cells, and the parser is right to read it that way.
    const csv = 'Deal ID,Deal Name,Associated Company ID,Amount,Close Date\nD-9,Roof rebuild,7431,"$12,500.50",2026-01-15';
    const out = parseEntityCsv("deals", csv);

    expect(out.rows[0]).toMatchObject({
      externalId: "D-9",
      values: { name: "Roof rebuild", companyExternalId: "7431", valueUsd: "$12,500.50", closedAt: "2026-01-15" },
    });
  });
});

describe("parseEntityCsv — notes", () => {
  it("reads whichever parent the export names", () => {
    const csv = "id,Note,Contact ID,Created At\nN-1,Left a voicemail,C-55,2026-02-02";
    const out = parseEntityCsv("notes", csv);

    expect(out.rows[0]?.values).toMatchObject({
      body: "Left a voicemail",
      contactExternalId: "C-55",
      createdAt: "2026-02-02",
    });
  });

  it("skips a note with no body — there is nothing to import", () => {
    const csv = "id,note,contact id\nN-1,,C-55";
    const out = parseEntityCsv("notes", csv);
    expect(out.rows).toHaveLength(0);
    expect(out.skipped[0]?.reason).toBe("no body");
  });
});

describe("column overrides behave as they do for contacts", () => {
  it("lets an explicit mapping take a field from the column detection claimed", () => {
    const csv = "id,Account,Legal Name\n1,Acme Trading,Acme Restoration LLC";
    // "Account" auto-detects as name; the operator prefers Legal Name.
    const out = parseEntityCsv("companies", csv, { "Legal Name": "name" });

    expect(out.rows[0]?.values.name).toBe("Acme Restoration LLC");
    expect(out.unmappedColumns).toContain("Account");
  });

  it("reports unmapped columns rather than dropping them silently", () => {
    const csv = "id,name,Industry,Owner\n1,Acme,Restoration,Dana";
    const out = parseEntityCsv("companies", csv);
    expect(out.unmappedColumns).toEqual(expect.arrayContaining(["Industry", "Owner"]));
  });
});

describe("parseUsdToCents", () => {
  it("handles the formats a spreadsheet actually emits", () => {
    expect(parseUsdToCents("$12,500.50")).toBe(1250050);
    expect(parseUsdToCents("1200")).toBe(120000);
    expect(parseUsdToCents(" 99.99 ")).toBe(9999);
  });

  it("returns null rather than 0 for something that is not a number", () => {
    // 0 would read as a real deal worth nothing, which is a different claim.
    expect(parseUsdToCents("TBD")).toBeNull();
    expect(parseUsdToCents("")).toBeNull();
    expect(parseUsdToCents(undefined)).toBeNull();
  });
});

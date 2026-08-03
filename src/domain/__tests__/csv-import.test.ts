import { describe, expect, it } from "vitest";

import {
  csvRowId,
  csvRowToContact,
  detectColumnMapping,
  parseCsvDate,
  mapCsvRow,
  parseCsv,
  parseCsvContacts,
} from "@/domain";

describe("parseCsv", () => {
  it("splits simple rows and drops blank lines", () => {
    expect(parseCsv("a,b,c\n1,2,3\n\n4,5,6")).toEqual([["a", "b", "c"], ["1", "2", "3"], ["4", "5", "6"]]);
  });

  it("handles quoted fields with commas and newlines inside", () => {
    const rows = parseCsv('name,note\n"Vega, Jordan","line one\nline two"');
    expect(rows[1]).toEqual(["Vega, Jordan", "line one\nline two"]);
  });

  it("handles escaped quotes and CRLF", () => {
    const rows = parseCsv('a\r\n"she said ""hi"""\r\n');
    expect(rows).toEqual([["a"], ['she said "hi"']]);
  });

  it("returns [] for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});

describe("detectColumnMapping", () => {
  it("maps common header aliases regardless of case/spacing", () => {
    const m = detectColumnMapping(["First Name", "Last_Name", "E-Mail", "Company Name", "Mobile"]);
    expect(m).toEqual({ 0: "firstName", 1: "lastName", 2: "email", 3: "company", 4: "phone" });
  });

  it("maps a single full-name column", () => {
    expect(detectColumnMapping(["Full Name", "email"])).toEqual({ 0: "name", 1: "email" });
  });

  it("first column wins a field — a later duplicate can't clobber it", () => {
    const m = detectColumnMapping(["email", "work email"]);
    expect(m).toEqual({ 0: "email" });
  });

  it("ignores unknown headers", () => {
    expect(detectColumnMapping(["email", "favorite color"])).toEqual({ 0: "email" });
  });
});

describe("mapCsvRow", () => {
  it("applies the mapping to a data row", () => {
    const m = { 0: "email" as const, 1: "company" as const };
    expect(mapCsvRow(["a@b.com", "Acme"], m)).toEqual({ email: "a@b.com", company: "Acme" });
  });

  it("splits a full-name column into first + last", () => {
    expect(mapCsvRow(["Jordan Vega Cruz"], { 0: "name" })).toEqual({ firstName: "Jordan", lastName: "Vega Cruz" });
  });

  it("does not overwrite an explicitly-mapped first/last with a name column split", () => {
    // firstName mapped separately, name column also present — keep the explicit one.
    const row = mapCsvRow(["Jo", "Jordan Vega"], { 0: "firstName", 1: "name" });
    expect(row.firstName).toBe("Jo");
    expect(row.lastName).toBe("Vega");
  });
});

describe("csvRowId — stable dedup key", () => {
  it("prefers email, case-insensitive", () => {
    expect(csvRowId({ email: "A@B.com" })).toBe("csv:a@b.com");
  });
  it("falls back to normalized phone, then a content hash", () => {
    expect(csvRowId({ phone: "(312) 555-1212" })).toBe("csv:3125551212");
    const a = csvRowId({ firstName: "Jordan", company: "Acme" });
    expect(a).toMatch(/^csv:h/);
    expect(csvRowId({ firstName: "Jordan", company: "Acme" })).toBe(a); // stable
  });
  it("is namespaced so it can't collide with a HubSpot object id", () => {
    expect(csvRowId({ email: "x@y.com" }).startsWith("csv:")).toBe(true);
  });
});

describe("csvRowToContact", () => {
  it("emits the engine's property keys (firstname/lastname/email/…)", () => {
    const c = csvRowToContact({ firstName: "Jordan", lastName: "Vega", email: "j@v.com", company: "Acme", city: "Chicago", state: "IL", zip: "60601" });
    expect(c?.properties).toEqual({ firstname: "Jordan", lastname: "Vega", email: "j@v.com", company: "Acme", city: "Chicago", state: "IL", zip: "60601" });
    expect(c?.id).toBe("csv:j@v.com");
  });
  it("returns null for a row with no name/email/phone", () => {
    expect(csvRowToContact({ company: "Acme", city: "Chicago" })).toBeNull();
  });
});

describe("parseCsvContacts — end to end", () => {
  const CSV = `First Name,Last Name,Email,Company,Phone,City,State
Jordan,Vega,jordan@acme.com,Acme Restoration,312-555-1000,Chicago,IL
Dana,Whitfield,dana@northshore.com,North Shore Group,,Evanston,IL
,,,,,,
,,,Ghost Co,,,`;

  it("maps rows to contacts, reports recognised columns, and counts skips", () => {
    const s = parseCsvContacts(CSV);
    expect(s.totalRows).toBe(3); // the all-blank line is dropped by parseCsv; 3 data rows remain
    expect(s.contacts.map((c) => c.id)).toEqual(["csv:jordan@acme.com", "csv:dana@northshore.com"]);
    expect(s.skipped).toBe(1); // "Ghost Co" has only a company — no name/email/phone
    expect(s.mappedColumns).toMatchObject({ firstName: "First Name", email: "Email", company: "Company" });
  });

  it("dedupes the same email appearing twice in one paste", () => {
    const dup = "email,company\na@b.com,One\na@b.com,Two";
    expect(parseCsvContacts(dup).contacts).toHaveLength(1);
  });

  it("returns nothing usable for a header-only or empty CSV", () => {
    expect(parseCsvContacts("name,email").contacts).toEqual([]);
    expect(parseCsvContacts("").contacts).toEqual([]);
  });
});

describe("parseCsvDate", () => {
  const NOW = new Date("2026-07-29T00:00:00.000Z");

  it("accepts ISO dates, with or without a time", () => {
    expect(parseCsvDate("2026-01-15", NOW)).toBe("2026-01-15T00:00:00.000Z");
    expect(parseCsvDate("2026-01-15T09:30:00Z", NOW)).toBe("2026-01-15T00:00:00.000Z");
  });

  it("accepts US M/D/YYYY, which is what most CRM exports emit", () => {
    expect(parseCsvDate("1/15/2026", NOW)).toBe("2026-01-15T00:00:00.000Z");
    expect(parseCsvDate("12/03/2025", NOW)).toBe("2025-12-03T00:00:00.000Z");
  });

  // A wrong date manufactures false urgency — "quiet 200 days" about someone
  // spoken to last week — inside an evidence-cited card the operator trusts.
  // No date is strictly better than a guessed one.
  it("refuses to guess ambiguous or malformed dates", () => {
    expect(parseCsvDate("15/01/2026", NOW)).toBeUndefined();
    expect(parseCsvDate("1/15/26", NOW)).toBeUndefined();
    expect(parseCsvDate("last tuesday", NOW)).toBeUndefined();
    expect(parseCsvDate("45231", NOW)).toBeUndefined();
    expect(parseCsvDate("", NOW)).toBeUndefined();
    expect(parseCsvDate(undefined, NOW)).toBeUndefined();
  });

  it("drops future dates and pre-2000 artefacts", () => {
    expect(parseCsvDate("2027-01-01", NOW)).toBeUndefined();
    expect(parseCsvDate("1899-12-30", NOW)).toBeUndefined();
  });
});

describe("last-contacted column", () => {
  // Without this the lead lands as received-today, reads as zero days cold, and
  // Arc finds nothing for 30 days right after telling the owner to import.
  it("detects common header spellings and carries the date as updatedAt", () => {
    const csv = ["email,Last Contacted", "a@b.com,2026-01-15"].join("\n");
    const { contacts, mappedColumns } = parseCsvContacts(csv);
    expect(mappedColumns.lastContactedAt).toBe("Last Contacted");
    expect(contacts[0].updatedAt).toBe("2026-01-15T00:00:00.000Z");
  });

  it("omits updatedAt entirely when the date is unusable", () => {
    const csv = ["email,last activity", "a@b.com,not a date"].join("\n");
    const { contacts } = parseCsvContacts(csv);
    expect(contacts[0].updatedAt).toBeUndefined();
  });

  it("imports fine when the column is absent", () => {
    const { contacts } = parseCsvContacts(["email", "a@b.com"].join("\n"));
    expect(contacts).toHaveLength(1);
    expect(contacts[0].updatedAt).toBeUndefined();
  });
});

// BSR-642. Auto-detection is a first guess; without a way to correct it, a column
// named something unusual is dropped and the operator never learns it existed.
describe("operator column overrides", () => {
  const csv = "Full Name,Work Email,Account,Notes\nAda Lovelace,ada@example.com,Analytical Ltd,ignore me";

  it("reports every header, including the ones nothing matched", () => {
    const out = parseCsvContacts(csv);
    expect(out.headers).toEqual(["Full Name", "Work Email", "Account", "Notes"]);
    // "Notes" has no alias — today it is silently dropped, which is exactly what
    // the operator needs to be told rather than left to discover.
    expect(out.unmappedColumns).toContain("Notes");
  });

  it("maps a column the detector missed", () => {
    const out = parseCsvContacts(csv, { Notes: "company" });
    expect(out.mappedColumns.company).toBe("Notes");
    expect(out.contacts[0]?.properties?.company).toBe("ignore me");
    expect(out.unmappedColumns).not.toContain("Notes");
  });

  it("drops a column the detector claimed", () => {
    const detected = parseCsvContacts(csv);
    expect(detected.mappedColumns.email).toBe("Work Email");

    const out = parseCsvContacts(csv, { "Work Email": null });
    expect(out.mappedColumns.email).toBeUndefined();
    expect(out.contacts[0]?.properties?.email).toBeUndefined();
  });

  it("targets by header name, not index, so a reordered re-upload still maps correctly", () => {
    // An index-based override would silently mis-target the moment the same file
    // is exported again with columns in a different order.
    const reordered = "Notes,Full Name,Work Email,Account\nignore me,Ada Lovelace,ada@example.com,Analytical Ltd";
    const out = parseCsvContacts(reordered, { Notes: "company" });
    expect(out.contacts[0]?.properties?.company).toBe("ignore me");
  });

  it("ignores an override naming a column the file does not have", () => {
    const out = parseCsvContacts(csv, { "Not A Column": "phone" });
    expect(out.mappedColumns.phone).toBeUndefined();
    expect(out.contacts).toHaveLength(1);
  });
});

describe("an explicit mapping wins over detection", () => {
  it("releases the field from whichever column the detector had claimed", () => {
    // "Account" auto-detects as company. Mapping "Notes" to company must take it
    // away from "Account" rather than leaving two columns fighting over one field
    // — which one won would otherwise depend on their order in the file.
    const csv = "Full Name,Account,Notes\nAda Lovelace,Analytical Ltd,Difference Engine Co";
    const out = parseCsvContacts(csv, { Notes: "company" });

    expect(out.mappedColumns.company).toBe("Notes");
    expect(out.contacts[0]?.properties?.company).toBe("Difference Engine Co");
    // And the column it was taken from is now honestly reported as not imported.
    expect(out.unmappedColumns).toContain("Account");
  });
});

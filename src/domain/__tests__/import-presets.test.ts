import { describe, expect, it } from "vitest";

import { parseCsvContacts } from "../csv-import";
import { IMPORT_PRESETS, detectPreset, presetOverrides, type ImportPresetKey } from "../import-presets";

/**
 * BSR-646. One fixture per source: its header row, what we detect from it, and
 * what a row parses into once the preset is applied.
 *
 * ⚠️ These header rows are the best-known column names for each product, not rows
 * copied from a verified export of every one. Replace them with real exported
 * headers as they become available — a preset that silently mis-maps is worse than
 * no preset, and only a real file proves it does not.
 */

type Fixture = { key: ImportPresetKey; header: string; row: string; expect: Record<string, string> };

const FIXTURES: Fixture[] = [
  {
    key: "hubspot",
    header: "Record ID,First Name,Last Name,Email,Phone Number,Associated Company,City,State/Region,Postal Code,Last Activity Date",
    row: "7431,Ada,Lovelace,ada@acme.com,312-555-0100,Acme Restoration,Chicago,IL,60601,2026-01-15",
    expect: { firstname: "Ada", lastname: "Lovelace", email: "ada@acme.com", company: "Acme Restoration", city: "Chicago" },
  },
  {
    key: "salesforce",
    header: "First Name,Last Name,Email,Phone,Account Name,Mailing City,Mailing State/Province,Mailing Zip/Postal Code,Last Activity",
    row: "Grace,Hopper,grace@navy.example,312-555-0111,Navy Yard Facilities,Chicago,IL,60602,2026-01-10",
    expect: { firstname: "Grace", lastname: "Hopper", company: "Navy Yard Facilities", city: "Chicago" },
  },
  {
    key: "pipedrive",
    header: "Person - ID,Person - Name,Person - Email,Person - Phone,Organization - Name,Person - Last activity date",
    row: "88,Jordan Vega,jordan@acme.com,312-555-0122,Acme Restoration,2026-01-12",
    // Pipedrive exports one "Person - Name" column; csvRowToContact splits a full
    // name into firstname/lastname, so that is what lands on the contact.
    expect: { firstname: "Jordan", lastname: "Vega", email: "jordan@acme.com", company: "Acme Restoration" },
  },
  {
    key: "jobber",
    header: "Client Name,First Name,Last Name,Email,Phone Number,Company Name,City,State,Zip",
    row: "Dana Cole,Dana,Cole,dana@cole.example,312-555-0133,Cole Plumbing,Evanston,IL,60201",
    expect: { firstname: "Dana", lastname: "Cole", company: "Cole Plumbing", city: "Evanston" },
  },
  {
    key: "google_contacts",
    header: "Given Name,Family Name,E-mail 1 - Value,Phone 1 - Value,Organization 1 - Name",
    row: "Sam,Rivera,sam@rivera.example,312-555-0144,Rivera Roofing",
    expect: { firstname: "Sam", lastname: "Rivera", email: "sam@rivera.example", company: "Rivera Roofing" },
  },
];

describe.each(FIXTURES)("preset: $key", (fixture) => {
  const headers = fixture.header.split(",");

  it("is detected from its header signature", () => {
    expect(detectPreset(headers)).toBe(fixture.key);
  });

  it("maps its columns onto the right fields", () => {
    const csv = `${fixture.header}\n${fixture.row}`;
    const out = parseCsvContacts(csv, presetOverrides(fixture.key, headers));
    const properties = out.contacts[0]?.properties ?? {};
    for (const [key, value] of Object.entries(fixture.expect)) {
      expect(properties[key]).toBe(value);
    }
  });
});

describe("detection is a suggestion, never a claim", () => {
  it("requires every header in a signature, so one coincidental column cannot claim a file", () => {
    // "Email" alone appears in every export on earth.
    expect(detectPreset(["Email", "Name"])).toBeNull();
    // "Record ID" alone is not enough for HubSpot either.
    expect(detectPreset(["Record ID", "Name"])).toBeNull();
  });

  it("returns null for a plain spreadsheet rather than guessing", () => {
    expect(detectPreset(["name", "email", "company"])).toBeNull();
  });
});

describe("presets extend the generic aliases rather than replacing them", () => {
  it("still imports a source we have no preset for", () => {
    // The fallback that means an unrecognised file is never a dead end.
    const csv = "Full Name,Work Email,Account\nAda Lovelace,ada@acme.com,Acme";
    const out = parseCsvContacts(csv, presetOverrides("generic", ["Full Name", "Work Email", "Account"]));
    expect(out.contacts).toHaveLength(1);
    expect(out.contacts[0]?.properties?.email).toBe("ada@acme.com");
  });

  it("leaves alone a column the preset does not mention", () => {
    // Generic detection still places "Email"; the preset says nothing about it.
    const headers = ["Person - Name", "Organization - Name", "Email"];
    const overrides = presetOverrides("pipedrive", headers);
    expect(overrides).not.toHaveProperty("Email");
    expect(overrides["Person - Name"]).toBe("name");
  });

  it("only emits overrides for headers the file actually has", () => {
    const overrides = presetOverrides("hubspot", ["First Name", "Email"]);
    expect(Object.keys(overrides).sort()).toEqual(["Email", "First Name"]);
  });
});

describe("the preset catalog itself", () => {
  it("gives every preset a signature and at least one mapped column", () => {
    for (const preset of IMPORT_PRESETS) {
      expect(preset.signature.length).toBeGreaterThan(0);
      expect(Object.keys(preset.columns).length).toBeGreaterThan(0);
    }
  });

  it("has a unique key per preset", () => {
    const keys = IMPORT_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

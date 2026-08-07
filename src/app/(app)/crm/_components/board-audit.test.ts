import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { headerLabel, IMPORTABLE_OBJECTS, rowsToCsv } from "./crm-board";
import type { Col, CrmRowVM } from "./crm-board";

const BOARD = readFileSync(new URL("./crm-board.tsx", import.meta.url), "utf8");
const WIZARD = readFileSync(new URL("../import/_components/import-wizard.tsx", import.meta.url), "utf8");
const READ_MODEL = readFileSync(new URL("../../../../lib/crm/read-model.ts", import.meta.url), "utf8");
const APP_CSS = readFileSync(new URL("../../arc-app.css", import.meta.url), "utf8");

/**
 * The board is the product's front door, and three of its controls quietly
 * described something other than what they did.
 */
describe("column headings speak the workspace's words", () => {
  const objects = [
    { key: "companies", nameHeader: "Organization" },
    { key: "contacts", nameHeader: "Person" },
  ];

  it("borrows the companies object's noun for the company column", () => {
    // The People table carried a hardcoded "Company" heading while that object
    // was called "Organizations" in the tab above it and in the KPI strip.
    const label = headerLabel({ k: "company", t: "Company" }, { nameHeader: "Person" }, objects);
    expect(label).toBe("Organization");
  });

  it("still names the primary column after the active object", () => {
    expect(headerLabel({ k: "primary", t: "Contact" }, { nameHeader: "Person" }, objects)).toBe("Person");
  });

  it("leaves attribute columns alone", () => {
    // "Status" and "Persona" describe a field, not another object — they are not
    // tenant vocabulary and must not be rewritten.
    expect(headerLabel({ k: "status", t: "Status" }, { nameHeader: "Person" }, objects)).toBe("Status");
  });

  it("falls back to the built-in noun when the companies object is absent", () => {
    expect(headerLabel({ k: "company", t: "Company" }, { nameHeader: "Person" }, [])).toBe("Company");
  });
});

describe("export writes what the table shows", () => {
  it("builds the CSV from the object's own columns, not a fixed set", () => {
    // Was a hardcoded 8-column header for every object, so Outcomes lost
    // Revenue, Jobs lost Est. value, Companies lost Tier, Leads lost Routing —
    // and every object lost the tenant's custom fields.
    expect(BOARD).toContain("function rowsToCsv(rows: CrmRowVM[], cols: Col[], headerFor: (c: Col) => string)");
    expect(BOARD).not.toContain('const header = ["Name", "Company", "Persona", "Status", "Owner"');
  });

  it("carries custom-field columns into the file", () => {
    expect(BOARD).toContain('if (col.k.startsWith("cf:")) return r.customFields?.[col.k.slice(3)] ?? "";');
  });

  it("carries the subtitle rendered under each name", () => {
    // The name cell shows a subtitle beneath the name. On the live workspace
    // that subtitle is the PHONE for all 243 contacts, every one of which has an
    // empty Company — so exporting the name alone handed back a contact list
    // with nothing to contact anyone by.
    expect(BOARD).toContain('header.splice(nameIdx + 1, 0, "Details")');
    expect(BOARD).toContain("row.splice(nameIdx + 1, 0, rows[i].detail)");
  });

  it("exports every column, not only the visible ones", () => {
    // Column visibility is a per-object display preference in localStorage.
    // Letting invisible state silently shape a file is the worse failure.
    expect(BOARD).toMatch(/rowsToCsv\(filteredAll, allCols,/);
  });

  it("covers every value-bearing column the tables define", () => {
    // A column added to COLS with no csvValue case exports as blank — silently.
    const declared = new Set([...BOARD.matchAll(/\{ k: "(\w+)"(?:, t: "[^"]*")? \}/g)].map((m) => m[1]));
    const handled = new Set([...BOARD.matchAll(/case "(\w+)": return r\./g)].map((m) => m[1]));
    const missing = [...declared].filter((k) => !["sel", "act"].includes(k) && !handled.has(k));
    expect(missing).toEqual([]);
  });
});

describe("import is offered only where it can work", () => {
  it("omits the objects the wizard has no kind for", () => {
    // The button rendered for every built-in object, so on Sites and Outcomes
    // it opened a wizard with no option that could accept them.
    expect(IMPORTABLE_OBJECTS.has("properties")).toBe(false);
    expect(IMPORTABLE_OBJECTS.has("outcomes")).toBe(false);
  });

  it("offers exactly the objects the wizard's kinds cover", () => {
    // KIND_FOR_OBJECT is what the wizard preselects from; the two lists are the
    // same claim made in two files, so hold them to each other.
    const mapped = new Set([...WIZARD.matchAll(/^\s{2}(\w+): "(?:contacts|companies|deals|notes)",$/gm)].map((m) => m[1]));
    expect(new Set(IMPORTABLE_OBJECTS)).toEqual(mapped);
  });

  it("tells the destination which object you came from", () => {
    expect(BOARD).toContain('href={`/crm/import?as=${active.key}`}');
    // The tooltip said "Import contacts from a CSV" on every tab.
    expect(BOARD).toContain("title={`Import ${active.noun} from a CSV`}");
  });
});

describe("selection is reachable without a mouse", () => {
  it("builds both select controls as real buttons", () => {
    // Bulk actions — add to campaign, assign persona, add task, archive — were
    // all mouse-only, because the only way to select a row was clicking a
    // `<span role="checkbox">` with no tabIndex and no key handler.
    //
    // #1062 fixed this across the app by making these real <button>s, which is
    // the better fix than the tabIndex + onKeyDown pair this branch originally
    // carried: a button is focusable and Space/Enter-activated for free, and
    // hand-rolling the key handler on top of one double-toggles. Assert the
    // element, not the workaround.
    //
    // Attribute lines only — the comments here quote the markup they describe.
    const lines = BOARD.split("\n");
    const checkboxAttrs = lines.filter((l) => l.includes('role="checkbox"') && !l.trim().startsWith("//"));
    expect(checkboxAttrs.length).toBe(2);
    for (const [i, line] of lines.entries()) {
      if (!line.includes('role="checkbox"') || line.trim().startsWith("//")) continue;
      // The opening tag sits a line or two above the role attribute.
      expect(lines.slice(Math.max(0, i - 3), i).join("\n")).toContain("<button");
    }
    // A key handler on a button is redundant and fires twice on Space.
    expect(BOARD).not.toMatch(/onKeyDown=[\s\S]{0,80}toggleRow/);
  });

  it("pads the select control out to the minimum target size", () => {
    // The cell is 40x20 around a 16x16 box, so most of the column that reads as
    // "the checkbox column" fell outside the control — and the row underneath
    // opens the record, so a near-miss cost a page load.
    expect(APP_CSS).toContain(".arc-app .arc-grid .ck::after");
    expect(APP_CSS).toMatch(/\.ck \{ position: relative;/);
  });
});

describe("the record page shows identifiers a person can read", () => {
  it("prints no raw foreign keys in the details grid", () => {
    // "Company id: demo-co-northside-plumbing" — a database identifier, shown to
    // an owner-operator, duplicating a row the Related section already resolved
    // to a name with an href.
    for (const label of ['"Company id"', '"Contact id"', '"Project id"']) {
      expect(READ_MODEL).not.toContain(`[${label},`);
    }
  });

  it("keeps the values the removed header strip uniquely carried", () => {
    expect(READ_MODEL).toContain('["Relationship stage", relationshipStageOf(contact)]');
    expect(READ_MODEL).toContain('["Received", lead.received_at ? formatDateOnly(lead.received_at) : null]');
  });
});

/**
 * The CSV itself, not the source that writes it.
 *
 * The row below is shaped like a real one from the live workspace: a name, the
 * phone rendered as its subtitle, an empty company (all 243 contacts there have
 * one), and a tenant-defined field. Every one of those was a way the old fixed
 * eight-column export lost data.
 */
describe("the exported CSV", () => {
  const COLS: Col[] = [
    { k: "sel" },
    { k: "primary", t: "Contact" },
    { k: "company", t: "Company" },
    { k: "persona", t: "Persona" },
    { k: "cf:referral", t: "Referral source" },
    { k: "act" },
  ];
  const row = {
    id: "c1",
    name: "Arturo Arredondo",
    detail: "(202) 823-7387",
    company: "",
    persona: "Property manager",
    owner: "Robby",
    customFields: { referral: "Repeat client" },
    statusLabel: "Active",
    updatedTime: "Aug 3",
    updatedRel: "4d ago",
    score: null,
    value: "",
    tier: "",
    routing: "",
    tasks: "",
  } as unknown as CrmRowVM;

  const csv = rowsToCsv([row], COLS, (c) => (c.k === "company" ? "Organization" : c.t ?? ""));
  const [header, first] = csv.split("\n");

  it("keeps the phone that the name cell renders", () => {
    expect(header).toBe("Contact,Details,Organization,Persona,Referral source,Owner");
    expect(first).toBe("Arturo Arredondo,(202) 823-7387,,Property manager,Repeat client,Robby");
  });

  it("includes the tenant's own field", () => {
    expect(header).toContain("Referral source");
    expect(first).toContain("Repeat client");
  });

  it("uses the workspace's noun for the company column", () => {
    expect(header).toContain("Organization");
    expect(header).not.toContain(",Company,");
  });

  it("drops the chrome columns", () => {
    expect(header).not.toMatch(/\bsel\b|\bact\b/);
  });

  it("quotes a value containing a comma", () => {
    const withComma = { ...row, name: "Arredondo, Arturo" } as unknown as CrmRowVM;
    expect(rowsToCsv([withComma], COLS, (c) => c.t ?? "").split("\n")[1]).toContain('"Arredondo, Arturo"');
  });
});

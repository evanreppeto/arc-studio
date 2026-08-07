import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LOCKED_COLUMNS, readStoredColumns, visibleColumns } from "./crm-board";
import { createStoredPreference } from "./stored-preference";

/**
 * BSR-749. "Column settings are coming soon" was the second of CRM's three
 * `data-soon` placeholders that needed no backend.
 *
 * Both <thead> and <tbody> map over one `cols` array, so filtering it is the
 * whole feature — which is exactly why the risk is in the EDGES: a stored value
 * a user can hand-edit, and a set of columns that must never be hideable.
 */

const CONTACTS = [
  { k: "sel" },
  { k: "primary", t: "Contact" },
  { k: "company", t: "Company" },
  { k: "persona", t: "Persona" },
  { k: "status", t: "Status" },
  { k: "last", t: "Last activity" },
  { k: "tasks", t: "Tasks" },
  { k: "act" },
];

describe("visibleColumns", () => {
  it("drops what the operator hid", () => {
    const out = visibleColumns(CONTACTS, ["company", "tasks"]).map((c) => c.k);
    expect(out).toEqual(["sel", "primary", "persona", "status", "last", "act"]);
  });

  it("returns the same array when nothing is hidden", () => {
    expect(visibleColumns(CONTACTS, [])).toBe(CONTACTS);
  });

  /**
   * The row is a checkbox, a name, and a chevron into the record. Hiding any of
   * those breaks it rather than simplifying it — the checkbox orphans bulk
   * select, and the name leaves a row with nothing to identify it by.
   */
  it("never drops a structural column, even if storage says to", () => {
    const out = visibleColumns(CONTACTS, ["sel", "primary", "act", "company"]).map((c) => c.k);
    // Only "company" is genuinely hidden; the three locked keys are ignored.
    expect(out).toEqual(["sel", "primary", "persona", "status", "last", "tasks", "act"]);
    for (const locked of LOCKED_COLUMNS) {
      expect(out, `${locked} must survive`).toContain(locked);
    }
  });

  it("keeps a tenant's custom column hideable like any other", () => {
    const withCustom = [...CONTACTS.slice(0, -1), { k: "cf:territory", t: "Territory" }, { k: "act" }];
    expect(visibleColumns(withCustom, ["cf:territory"]).map((c) => c.k)).not.toContain("cf:territory");
  });
});

describe("readStoredColumns", () => {
  it("reads what the menu writes", () => {
    expect(readStoredColumns('{"contacts":["company"],"leads":["routing"]}')).toEqual({
      contacts: ["company"],
      leads: ["routing"],
    });
  });

  /** localStorage is user-writable and survives deploys; none of this is hypothetical. */
  it("is total over anything that could be in storage", () => {
    for (const raw of [null, "", "not json", "[]", '"string"', "42", "null", '{"contacts":"company"}']) {
      expect(readStoredColumns(raw), JSON.stringify(raw)).toEqual({});
    }
  });

  it("strips a structural column rather than trusting it", () => {
    // Hand-edited storage must not be able to break the row.
    expect(readStoredColumns('{"contacts":["primary","sel","act","company"]}')).toEqual({ contacts: ["company"] });
  });

  it("drops non-string entries and empty objects", () => {
    expect(readStoredColumns('{"contacts":[1,null,{"k":"x"},"company"]}')).toEqual({ contacts: ["company"] });
    expect(readStoredColumns('{"contacts":[]}')).toEqual({});
  });

  it("stores the HIDDEN set, so a column added later is visible by default", () => {
    // The inverse — storing what to SHOW — would make every column added after
    // an operator first opened this menu invisible to them, forever.
    const stored = readStoredColumns('{"contacts":["company"]}');
    const laterCols = [...CONTACTS, { k: "owner", t: "Owner" }];
    expect(visibleColumns(laterCols, stored.contacts!).map((c) => c.k)).toContain("owner");
  });
});

describe("createStoredPreference", () => {
  it("returns a stable snapshot reference, or React re-renders forever", () => {
    // getSnapshot must be referentially stable between renders. Parsing per
    // call returns a new object each time and loops useSyncExternalStore.
    const pref = createStoredPreference<Record<string, string[]>>({
      key: "test.pref",
      fallback: {},
      parse: readStoredColumns,
    });
    expect(pref.getSnapshot()).toBe(pref.getSnapshot());
  });

  it("renders the fallback on the server, where there is no storage", () => {
    const pref = createStoredPreference<string>({ key: "test.k", fallback: "default", parse: (r) => r ?? "default" });
    expect(pref.getServerSnapshot()).toBe("default");
  });
});

describe("the control is wired, not decorative", () => {
  const SOURCE = readFileSync(join(new URL(".", import.meta.url).pathname, "crm-board.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("no longer marks columns as unbuilt", () => {
    expect(SOURCE).not.toMatch(/data-soon="[^"]*[Cc]olumn/);
  });

  it("filters the one array both the header and the body render", () => {
    expect(SOURCE).toMatch(/const cols = visibleColumns\(allCols, hiddenHere\)/);
  });

  it("offers the full column set in the menu, not the filtered one", () => {
    // Passing `cols` would make a hidden column vanish from its own menu —
    // unhideable, with no way back short of clearing localStorage.
    //
    // Matched over the whole element rather than as one line: this test used to
    // pin `<ColumnsMenu cols={allCols}` verbatim and failed the day the element
    // gained a prop and wrapped, which says nothing about the prop it guards.
    const menu = SOURCE.match(/<ColumnsMenu[\s\S]*?\/>/);
    expect(menu, "no <ColumnsMenu> is rendered").toBeTruthy();
    expect(menu![0]).toMatch(/cols=\{allCols\}/);
  });

  /**
   * The menu chooses which fields SHOW; it cannot add or remove one. It used to
   * name no way to — the field editor was reachable only from a record page, so
   * shaping the table meant leaving it. It now opens the editor in place; this
   * started as a link to Settings, which was still a round trip out of the
   * screen you are shaping.
   */
  it("can open the field editor from the columns menu", () => {
    const menu = SOURCE.match(/<ColumnsMenu[\s\S]*?\/>/);
    expect(menu![0]).toMatch(/onManageFields=\{\(\) => setFieldsOpen\(true\)\}/);
    // Rendered with the ACTIVE object's definitions, or it edits another
    // object's schema from this object's table.
    const modal = SOURCE.match(/<ManageFieldsModal[\s\S]*?\/>/);
    expect(modal, "no <ManageFieldsModal> rendered").toBeTruthy();
    // Plain `active.key`, no cast: a tenant-defined type's key is a per-org
    // string, and narrowing it to the six is what the `as` was papering over.
    expect(modal![0]).toMatch(/objectKey=\{active\.key\}/);
    expect(modal![0]).toMatch(/definitions=\{customFieldDefsByKey\[active\.key\] \?\? \[\]\}/);
  });
});

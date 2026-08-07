import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The WRITE half of a custom-object CSV import (BSR-787).
 *
 * `import.test.ts` next door covers `planCustomImport` — the pure planner that
 * decides which column is the name. Nothing covered anything below it, so when
 * `createFieldDefinition` refused every tenant-defined object key (#1082 → fixed
 * in #1088), this import provisioned ZERO fields, imported names only, and all
 * eight of those tests stayed green. The browser check passed too: the records
 * really did land. Only the columns silently didn't.
 *
 * So these drive `importCustomObjectCsv` itself and assert on what reached the
 * database. Only Postgres is faked — every layer of our own code between the CSV
 * and the write runs for real, because that composition is exactly where the bug
 * lived. Mocking `provisionCustomFields` here would reproduce the original
 * blind spot rather than close it.
 */

type Row = Record<string, unknown>;

/** Rows the fake database has been asked to store, by table. */
const db: Record<string, Row[]> = {};
let idSeq = 0;
/** Set to make an insert of a field definition with this key fail, as Postgres would. */
let failFieldInsert: string | null = null;

function reset() {
  failFieldInsert = null;
  for (const key of Object.keys(db)) delete db[key];
  db.custom_objects = [
    {
      id: "obj-1",
      org_id: "org-1",
      key: "service_vehicles",
      label_plural: "Service vehicles",
      label_singular: "Vehicle",
      description: null,
      sort_order: 0,
      active: true,
    },
  ];
  db.custom_field_definitions = [];
  db.custom_object_records = [];
  db.custom_field_values = [];
  idSeq = 0;
}

/**
 * A chainable stand-in for the PostgREST builder, backed by `db`.
 *
 * Deliberately dumb: it understands `.eq()` filtering and the terminal shapes
 * this code path uses, and nothing else. If a future change needs an operator
 * it doesn't implement, the test should fail loudly rather than quietly match
 * the wrong rows.
 */
function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  let staged: Row[] = [];

  const matches = () =>
    (db[table] ?? []).filter((row) => filters.every(([col, val]) => row[col] === val));

  const builder: Record<string, unknown> = {
    select: () => builder,
    order: () => builder,
    in: () => builder,
    eq: (col: string, val: unknown) => {
      filters.push([col, val]);
      return builder;
    },
    insert: (row: Row) => {
      if (table === "custom_field_definitions" && row.key === failFieldInsert) {
        // What a check-constraint violation or a dropped connection looks like
        // to this layer. Nothing is stored.
        return {
          select: () => ({ single: async () => ({ data: null, error: { message: "insert failed" } }) }),
        };
      }
      const stored = { id: `row-${++idSeq}`, ...row };
      (db[table] ??= []).push(stored);
      staged = [stored];
      return builder;
    },
    update: (patch: Row) => {
      staged = matches();
      for (const row of staged) Object.assign(row, patch);
      return builder;
    },
    upsert: (rows: Row[]) => {
      for (const row of rows) {
        const existing = (db[table] ??= []).find(
          (r) =>
            r.org_id === row.org_id && r.record_id === row.record_id && r.field_id === row.field_id,
        );
        if (existing) Object.assign(existing, row);
        else db[table].push({ id: `row-${++idSeq}`, ...row });
      }
      return Promise.resolve({ error: null });
    },
    maybeSingle: async () => ({ data: (staged[0] ?? matches()[0]) ?? null, error: null }),
    single: async () => ({ data: (staged[0] ?? matches()[0]) ?? null, error: null }),
    // Awaiting the builder directly is how the list reads resolve.
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: staged.length ? staged : matches(), error: null }).then(resolve),
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: () => true,
  getSupabaseAdminClient: () => ({ from: (table: string) => query(table) }),
}));
vi.mock("@/lib/demo/demo-mode", () => ({ isDemoDataEnabled: () => false }));

import { importCustomObjectCsv } from "./import";

const OBJECT = {
  id: "obj-1",
  key: "service_vehicles",
  labelPlural: "Service vehicles",
  labelSingular: "Vehicle",
  description: null,
  sortOrder: 0,
  active: true,
};

const CSV = [
  "Vehicle,Plate number,Mileage",
  "Ford Transit 350,IL-TRK-4417,82000",
  "Chevy Silverado 2500,IL-TRK-9902,140500",
].join("\n");

describe("importCustomObjectCsv", () => {
  beforeEach(reset);

  it("provisions the CSV's columns as fields on a tenant-defined record type", async () => {
    const result = await importCustomObjectCsv("org-1", OBJECT, CSV);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The regression: this was `[]` while `created` was still 2, so the import
    // reported success having dropped every column but the name.
    expect(result.fieldsCreated).toHaveLength(2);
    expect(db.custom_field_definitions.map((d) => d.key)).toEqual(["plate_number", "mileage"]);
    expect(db.custom_field_definitions.every((d) => d.object_key === "service_vehicles")).toBe(true);
  });

  /**
   * The modal prints this list straight to the operator. `provisioned.created`
   * is keyed by the MACHINE key, so it read "New fields: plate_number, mileage"
   * — the `needs_review`/"Needs review" leak this codebase has paid for twice.
   */
  it("names created fields by their spreadsheet heading, not the machine key", async () => {
    const result = await importCustomObjectCsv("org-1", OBJECT, CSV);

    expect(result.ok && result.fieldsCreated).toEqual(["Plate number", "Mileage"]);
  });

  it("writes each row's values against the fields it just provisioned", async () => {
    await importCustomObjectCsv("org-1", OBJECT, CSV);

    const byKey = new Map(db.custom_field_definitions.map((d) => [d.id, d.key]));
    const written = db.custom_field_values.map((v) => `${byKey.get(v.field_id as string)}=${v.value}`);

    // Two records × two fields. Values, not just definitions — provisioning the
    // schema and writing nothing into it is the same empty result to the operator.
    expect(written.sort()).toEqual(
      ["mileage=140500", "mileage=82000", "plate_number=IL-TRK-4417", "plate_number=IL-TRK-9902"],
    );
  });

  it("creates the records themselves", async () => {
    const result = await importCustomObjectCsv("org-1", OBJECT, CSV);

    expect(result.ok && result.created).toBe(2);
    expect(db.custom_object_records.map((r) => r.title)).toEqual([
      "Ford Transit 350",
      "Chevy Silverado 2500",
    ]);
  });

  /**
   * `provisionCustomFields` already collects the fields it could not create,
   * and `importCustomObjectCsv` already drops them from the write — but it did
   * not report them, so the operator saw "Added 2 vehicles." and nothing else.
   * That is what let a TOTAL failure read as a success.
   */
  it("reports the fields it could not create instead of dropping them silently", async () => {
    failFieldInsert = "mileage";

    const result = await importCustomObjectCsv("org-1", OBJECT, CSV);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Named by the spreadsheet heading, not the machine key — this reader does
    // not speak `mileage`.
    expect(result.fieldsFailed).toEqual([{ label: "Mileage", error: expect.stringContaining("insert failed") }]);
    // The rest of the import still lands: one bad column must not cost the rows.
    expect(result.created).toBe(2);
    expect(result.fieldsCreated).toEqual(["Plate number"]);
    // And nothing was written against the field that does not exist.
    expect(db.custom_field_values.every((v) => v.field_id !== "mileage")).toBe(true);
  });

  it("skips a row with no name rather than inventing one", async () => {
    const result = await importCustomObjectCsv(
      "org-1",
      OBJECT,
      "Vehicle,Plate number\nFord Transit 350,IL-TRK-4417\n,IL-TRK-0000",
    );

    expect(result.ok && result.created).toBe(1);
    expect(result.ok && result.skipped).toBe(1);
    expect(db.custom_object_records).toHaveLength(1);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: vi.fn(() => true),
  getSupabaseAdminClient: vi.fn(),
}));
vi.mock("./persistence", () => ({ recordImportedRecord: vi.fn(async () => undefined) }));

import { importEntityRows } from "./entity-import";

const TENANT = { orgId: "org-1", workspaceId: "ws-1" };

/**
 * A client that serves the identity map from a fixture and records every write.
 * `mappings` is keyed "<objectType>:<externalId>" → local id, standing in for the
 * `external_object_mappings` rows a previous import would have left behind.
 */
function client(mappings: Record<string, string>) {
  const writes: Array<{ table: string; op: string; values?: Record<string, unknown> }> = [];
  let inserted = 0;

  const build = (table: string) => {
    const state: { op: string; type?: string; ids?: string[]; values?: Record<string, unknown> } = { op: "select" };
    const chain: Record<string, unknown> = {
      select: () => chain,
      insert: (values: Record<string, unknown>) => { state.op = "insert"; state.values = values; return chain; },
      update: (values: Record<string, unknown>) => { state.op = "update"; state.values = values; return chain; },
      eq: (col: string, value: string) => { if (col === "external_object_type") state.type = value; return chain; },
      in: (_col: string, ids: string[]) => { state.ids = ids; return chain; },
      single: () => chain,
    };
    (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => {
      if (table === "external_object_mappings") {
        const rows = (state.ids ?? [])
          .filter((id) => mappings[`${state.type}:${id}`])
          .map((id) => ({ external_object_id: id, local_id: mappings[`${state.type}:${id}`] }));
        return resolve({ data: rows, error: null });
      }
      writes.push({ table, op: state.op, values: state.values });
      if (state.op === "insert") {
        inserted += 1;
        return resolve({ data: { id: `new-${inserted}` }, error: null });
      }
      return resolve({ data: null, error: null });
    };
    return chain;
  };

  return { from: (t: string) => build(t), writes } as never as { from: (t: string) => unknown; writes: typeof writes };
}

function row(externalId: string, values: Record<string, string>) {
  return { externalId, values };
}

describe("relationships resolve across files", () => {
  it("attaches a deal to the company a previous import created", async () => {
    // The whole point of keying on the source system's ids: the companies file was
    // imported at some earlier time, and this deals file still finds it.
    const db = client({ "companies:7431": "local-company-1" });

    const out = await importEntityRows({
      client: db as never,
      tenant: TENANT,
      kind: "deals",
      rows: [row("D-9", { name: "Roof rebuild", companyExternalId: "7431" })],
      externalSystemId: "sys-1",
      importRunId: "run-1",
    });

    expect(out).toMatchObject({ created: 1, skipped: 0, failed: 0 });
    const insert = db.writes.find((w) => w.table === "jobs" && w.op === "insert");
    expect(insert?.values?.company_id).toBe("local-company-1");
  });

  it("reports an unresolvable parent instead of silently orphaning the row", async () => {
    // A deal that vanishes without explanation is indistinguishable from data loss.
    const db = client({});

    const out = await importEntityRows({
      client: db as never,
      tenant: TENANT,
      kind: "deals",
      rows: [row("D-9", { name: "Roof rebuild", companyExternalId: "7431" })],
      externalSystemId: "sys-1",
      importRunId: "run-1",
    });

    expect(out.skipped).toBe(1);
    expect(out.created).toBe(0);
    expect(out.errors[0]?.message).toMatch(/company 7431 not found/);
    expect(db.writes.some((w) => w.table === "jobs")).toBe(false);
  });

  it("still imports a deal that names no company at all", async () => {
    // Only a NAMED but unresolvable reference is a problem. A file without a
    // company column is perfectly importable.
    const db = client({});
    const out = await importEntityRows({
      client: db as never,
      tenant: TENANT,
      kind: "deals",
      rows: [row("D-9", { name: "Roof rebuild" })],
      externalSystemId: "sys-1",
      importRunId: "run-1",
    });
    expect(out).toMatchObject({ created: 1, skipped: 0 });
  });

  it("attaches a note to the lead a contact reference resolves to", async () => {
    // The contacts importer records its source id against the LEAD, so that is
    // what a contact reference resolves through — and the note's entity_type has
    // to agree, or it points at an id of the wrong kind.
    const db = client({ "leads:C-55": "local-lead-1" });

    const out = await importEntityRows({
      client: db as never,
      tenant: TENANT,
      kind: "notes",
      rows: [row("N-1", { body: "Left a voicemail", contactExternalId: "C-55" })],
      externalSystemId: "sys-1",
      importRunId: "run-1",
    });

    expect(out.created).toBe(1);
    const insert = db.writes.find((w) => w.table === "crm_notes" && w.op === "insert");
    expect(insert?.values).toMatchObject({ entity_type: "lead", entity_id: "local-lead-1", body: "Left a voicemail" });
  });

  it("reports a note with nothing to attach to", async () => {
    const db = client({});
    const out = await importEntityRows({
      client: db as never,
      tenant: TENANT,
      kind: "notes",
      rows: [row("N-1", { body: "Orphan" })],
      externalSystemId: "sys-1",
      importRunId: "run-1",
    });
    expect(out.skipped).toBe(1);
    expect(out.errors[0]?.message).toMatch(/no company or contact/);
  });
});

describe("re-import updates in place", () => {
  it("updates the row a previous run created rather than inserting a second one", async () => {
    const db = client({ "companies:7431": "local-company-1" });

    const out = await importEntityRows({
      client: db as never,
      tenant: TENANT,
      kind: "companies",
      rows: [row("7431", { name: "Acme Restoration LLC" })],
      externalSystemId: "sys-1",
      importRunId: "run-1",
    });

    expect(out).toMatchObject({ created: 0, updated: 1 });
    expect(db.writes.filter((w) => w.table === "companies" && w.op === "insert")).toHaveLength(0);
    expect(db.writes.find((w) => w.table === "companies")?.op).toBe("update");
  });

  it("does not re-parent on re-import — one bad row never sinks the batch", async () => {
    const db = client({ "companies:1": "local-1" });

    const out = await importEntityRows({
      client: db as never,
      tenant: TENANT,
      kind: "companies",
      rows: [row("1", { name: "Acme" }), row("2", { name: "Beta" })],
      externalSystemId: "sys-1",
      importRunId: "run-1",
    });

    expect(out).toMatchObject({ created: 1, updated: 1, failed: 0 });
  });
});

describe("without an identity map", () => {
  it("cannot resolve anything, so every named reference is reported", async () => {
    // externalSystemId is null when provenance could not be started. Rows must not
    // be attached to arbitrary records just because the lookup was unavailable.
    const db = client({ "companies:7431": "local-company-1" });

    const out = await importEntityRows({
      client: db as never,
      tenant: TENANT,
      kind: "deals",
      rows: [row("D-9", { name: "Roof rebuild", companyExternalId: "7431" })],
      externalSystemId: null,
      importRunId: null,
    });

    expect(out.skipped).toBe(1);
    expect(db.writes.some((w) => w.table === "jobs")).toBe(false);
  });
});

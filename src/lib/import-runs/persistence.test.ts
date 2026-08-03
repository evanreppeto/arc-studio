import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: vi.fn(() => true),
  getSupabaseAdminClient: vi.fn(),
}));

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { finishImportRun, recordImportedRecord, resolveExternalSystemId, startImportRun } from "./persistence";

const TENANT = { orgId: "org-1", workspaceId: "ws-1" };

function insertsFor(supabase: { calls: Array<[string, ...unknown[]]> }, table: string, method = "insert") {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < supabase.calls.length; i++) {
    const [call, arg] = supabase.calls[i];
    if (call === "from" && arg === table && supabase.calls[i + 1]?.[0] === method) {
      out.push(supabase.calls[i + 1][1] as Record<string, unknown>);
    }
  }
  return out;
}

describe("startImportRun", () => {
  it("opens a run stamped with the workspace that triggered it", async () => {
    // The whole point of the run record. The connector is configured per workspace
    // but the CRM rows it writes are org-owned, so this is the only place that can
    // answer "where did these contacts come from" once a company has two workspaces.
    const supabase = createSupabaseQueryMock({ import_runs: { data: { id: "run-1" }, error: null } });

    const runId = await startImportRun({ ...TENANT, source: "csv", operator: "evan@test", client: supabase });

    expect(runId).toBe("run-1");
    expect(insertsFor(supabase, "import_runs")[0]).toMatchObject({
      org_id: "org-1",
      workspace_id: "ws-1",
      source: "csv",
      status: "running",
      operator: "evan@test",
    });
  });

  it("returns null instead of throwing when the run cannot be recorded", async () => {
    // Provenance is bookkeeping around the import, not part of it. Refusing to
    // import a customer's data because a log row would not write is the wrong
    // trade every time, so the caller gets a null id and carries on unrecorded.
    const supabase = createSupabaseQueryMock({ import_runs: { data: null, error: { message: "boom" } } });

    await expect(startImportRun({ ...TENANT, source: "csv", client: supabase })).resolves.toBeNull();
  });
});

describe("finishImportRun", () => {
  it("closes the run with its counts and errors", async () => {
    const supabase = createSupabaseQueryMock({ import_runs: { data: null, error: null } });

    await finishImportRun(
      "run-1",
      {
        status: "completed",
        counts: {
          imported: 12,
          updated: 3,
          skipped: 1,
          failed: 0,
          enriched: 2,
          pages: 1,
          errors: [{ externalId: "x1", message: "no usable name/email/phone" }],
        },
      },
      supabase,
    );

    const update = insertsFor(supabase, "import_runs", "update")[0];
    expect(update).toMatchObject({ status: "completed", imported: 12, updated: 3, skipped: 1, enriched: 2 });
    // The per-record errors the engine collects and used to throw away after one
    // line of status text.
    expect(update.errors).toEqual([{ externalId: "x1", message: "no usable name/email/phone" }]);
  });

  it("does nothing when there is no run to close", async () => {
    const supabase = createSupabaseQueryMock({ import_runs: { data: null, error: null } });
    await finishImportRun(null, { status: "completed" }, supabase);
    expect(insertsFor(supabase, "import_runs", "update")).toHaveLength(0);
  });
});

describe("recordImportedRecord", () => {
  it("records created vs updated, which is what an undo depends on", async () => {
    // A blanket delete on undo would remove rows that existed before the run and
    // were merely updated by it. This distinction is the only thing preventing that.
    const supabase = createSupabaseQueryMock({
      import_run_records: { data: null, error: null },
      external_object_mappings: { data: null, error: null },
    });

    await recordImportedRecord(
      TENANT,
      { importRunId: "run-1", localTable: "leads", localId: "lead-1", externalId: "hs-9", action: "updated" },
      "sys-1",
      supabase,
    );

    expect(insertsFor(supabase, "import_run_records")[0]).toMatchObject({
      import_run_id: "run-1",
      org_id: "org-1",
      workspace_id: "ws-1",
      local_table: "leads",
      local_id: "lead-1",
      external_id: "hs-9",
      action: "updated",
    });
  });

  it("never stores a previous snapshot for a created row", async () => {
    // There is nothing to restore a created row to — an undo deletes it. Carrying
    // a snapshot would imply a restore path that does not exist.
    const supabase = createSupabaseQueryMock({
      import_run_records: { data: null, error: null },
      external_object_mappings: { data: null, error: null },
    });

    await recordImportedRecord(
      TENANT,
      {
        importRunId: "run-1",
        localTable: "leads",
        localId: "lead-2",
        externalId: "hs-10",
        action: "created",
        previous: { name: "should be ignored" },
      },
      "sys-1",
      supabase,
    );

    expect(insertsFor(supabase, "import_run_records")[0].previous).toEqual({});
  });

  it("upserts the identity map so a re-import points at the same row", async () => {
    const supabase = createSupabaseQueryMock({
      import_run_records: { data: null, error: null },
      external_object_mappings: { data: null, error: null },
    });

    await recordImportedRecord(
      TENANT,
      { importRunId: "run-1", localTable: "leads", localId: "lead-1", externalId: "hs-9", action: "created" },
      "sys-1",
      supabase,
    );

    expect(insertsFor(supabase, "external_object_mappings", "upsert")[0]).toMatchObject({
      workspace_id: "ws-1",
      external_system_id: "sys-1",
      external_object_id: "hs-9",
      local_table: "leads",
      local_id: "lead-1",
    });
  });

  it("skips the identity map when there is no external system or id to key it on", async () => {
    const supabase = createSupabaseQueryMock({
      import_run_records: { data: null, error: null },
      external_object_mappings: { data: null, error: null },
    });

    await recordImportedRecord(
      TENANT,
      { importRunId: "run-1", localTable: "leads", localId: "lead-1", externalId: "hs-9", action: "created" },
      null,
      supabase,
    );

    expect(insertsFor(supabase, "import_run_records")).toHaveLength(1);
    expect(insertsFor(supabase, "external_object_mappings", "upsert")).toHaveLength(0);
  });
});

describe("resolveExternalSystemId", () => {
  it("uses the real external_system_kind enum labels, not invented ones", async () => {
    // `crm` and `active` are NOT members of external_system_kind / integration_status.
    // A mocked test cannot see an enum violation, so this pins the mapping that the
    // chain job then exercises against real Postgres.
    const supabase = createSupabaseQueryMock({ external_systems: { data: null, error: null } });

    await resolveExternalSystemId(TENANT, "mailchimp", supabase);

    expect(insertsFor(supabase, "external_systems")[0]).toMatchObject({
      workspace_id: "ws-1",
      system_key: "mailchimp",
      system_kind: "email_platform",
      status: "connected",
    });
  });
});

describe("provenance never fails the import it is recording", () => {
  // Found by an existing CSV test rather than by design: a client that does not
  // implement .from() made startImportRun THROW, which killed runCsvImport
  // outright. Checking the returned `error` is not enough — the throw is the
  // failure mode that turns bookkeeping into an outage. These pin the contract.
  const brokenClient = {} as never;

  it("returns null rather than throwing when the client cannot be used", async () => {
    await expect(startImportRun({ ...TENANT, source: "csv", client: brokenClient })).resolves.toBeNull();
    await expect(resolveExternalSystemId(TENANT, "csv", brokenClient)).resolves.toBeNull();
  });

  it("swallows a throw when closing a run or recording a record", async () => {
    await expect(finishImportRun("run-1", { status: "completed" }, brokenClient)).resolves.toBeUndefined();
    await expect(
      recordImportedRecord(
        TENANT,
        { importRunId: "run-1", localTable: "leads", localId: "lead-1", action: "created" },
        "sys-1",
        brokenClient,
      ),
    ).resolves.toBeUndefined();
  });
});

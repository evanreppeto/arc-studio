import { type SupabaseClient } from "@supabase/supabase-js";

import { parseEntityCsv, type CsvColumnOverrides, type ImportEntityKind } from "@/domain";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { importEntityRows, type EntityImportResult } from "./entity-import";
import { finishImportRun, resolveExternalSystemId, startImportRun } from "./persistence";

/**
 * Orchestrates one entity file: open a run, parse, import, close the run
 * (BSR-644). The contacts equivalent is `runCsvImport`; this is deliberately a
 * sibling rather than a branch inside it, because the two write completely
 * different tables through completely different paths.
 */

export type RunEntityImportInput = {
  orgId: string;
  workspaceId: string;
  kind: ImportEntityKind;
  csvText: string;
  columnOverrides?: CsvColumnOverrides;
  defaultPersona?: string;
  operator?: string | null;
  client?: SupabaseClient;
  /** Resolve and report without writing. */
  dryRun?: boolean;
};

export type RunEntityImportResult =
  | {
      ok: true;
      result: EntityImportResult;
      parse: { totalRows: number; headers: string[]; mappedColumns: Record<string, string>; unmappedColumns: string[] };
    }
  | { ok: false; error: string };

export async function runEntityImport(input: RunEntityImportInput): Promise<RunEntityImportResult> {
  if (!input.client && !isSupabaseAdminConfigured()) return { ok: false, error: "not_configured" };
  const client = input.client ?? getSupabaseAdminClient();
  const tenant = { orgId: input.orgId, workspaceId: input.workspaceId };

  const parsed = parseEntityCsv(input.kind, input.csvText, input.columnOverrides);
  if (parsed.rows.length === 0) return { ok: false, error: "no_rows" };

  const parse = {
    totalRows: parsed.totalRows,
    headers: parsed.headers,
    mappedColumns: parsed.mappedColumns,
    unmappedColumns: parsed.unmappedColumns,
  };

  // A dry run needs the identity map to answer "would this attach?", but must open
  // no run and write nothing. Resolving without an importRunId does exactly that:
  // importEntityRows only records provenance when it has a run to record against.
  if (input.dryRun) {
    const externalSystemId = await resolveExternalSystemId(tenant, "csv", client);
    const preview = await previewEntityRows({ ...input, client, tenant, externalSystemId, parsedRows: parsed.rows });
    return { ok: true, result: preview, parse };
  }

  const runId = await startImportRun({
    ...tenant,
    source: "csv",
    operator: input.operator ?? null,
    options: { entity: input.kind, mappedColumns: parsed.mappedColumns, totalRows: parsed.totalRows },
    client,
  });
  const externalSystemId = runId ? await resolveExternalSystemId(tenant, "csv", client) : null;

  try {
    const result = await importEntityRows({
      client,
      tenant,
      kind: input.kind,
      rows: parsed.rows,
      externalSystemId,
      importRunId: runId,
      defaultPersona: input.defaultPersona,
    });

    // Rows the PARSER dropped are skips too — they never reached the engine, and
    // an operator counting rows would otherwise find some simply missing.
    result.skipped += parsed.skipped.length;
    for (const s of parsed.skipped) result.errors.push({ externalId: `row ${s.row}`, message: s.reason });

    await finishImportRun(
      runId,
      {
        status: "completed",
        counts: {
          imported: result.created,
          updated: result.updated,
          skipped: result.skipped,
          failed: result.failed,
          enriched: 0,
          pages: 1,
          errors: result.errors,
        },
      },
      client,
    );
    return { ok: true, result, parse };
  } catch (error) {
    await finishImportRun(runId, { status: "failed" }, client);
    throw error;
  }
}

/**
 * The dry-run half: resolve parents and classify each row without writing. Shares
 * `importEntityRows`' resolution by calling it with no run id and a client whose
 * writes are never reached — the classification lives in one place so the preview
 * cannot drift from the import.
 */
async function previewEntityRows(args: {
  client: SupabaseClient;
  tenant: { orgId: string; workspaceId: string };
  kind: ImportEntityKind;
  externalSystemId: string | null;
  parsedRows: Awaited<ReturnType<typeof parseEntityCsv>>["rows"];
  defaultPersona?: string;
}): Promise<EntityImportResult> {
  const { resolveExternalIds } = await import("./entity-import");
  const table = { companies: "companies", deals: "jobs", notes: "crm_notes" }[args.kind];

  const [selfIds, companyParents, contactParents] = await Promise.all([
    resolveExternalIds(args.client, args.tenant, args.externalSystemId, table, args.parsedRows.map((r) => r.externalId)),
    resolveExternalIds(args.client, args.tenant, args.externalSystemId, "companies", args.parsedRows.map((r) => r.values.companyExternalId ?? "")),
    resolveExternalIds(args.client, args.tenant, args.externalSystemId, "leads", args.parsedRows.map((r) => r.values.contactExternalId ?? "")),
  ]);

  const result: EntityImportResult = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  for (const row of args.parsedRows) {
    const companyRef = row.values.companyExternalId;
    const contactRef = row.values.contactExternalId;
    const company = companyRef ? companyParents.get(companyRef) : undefined;
    const contact = contactRef ? contactParents.get(contactRef) : undefined;

    if (args.kind === "deals" && companyRef && !company) {
      result.skipped += 1;
      result.errors.push({ externalId: row.externalId || "(no id)", message: `company ${companyRef} not found — import the companies file first` });
      continue;
    }
    if (args.kind === "notes" && !contact && !company) {
      const named = contactRef ?? companyRef;
      result.skipped += 1;
      result.errors.push({
        externalId: row.externalId || "(no id)",
        message: named ? `${contactRef ? "contact" : "company"} ${named} not found — import that file first` : "no company or contact to attach this note to",
      });
      continue;
    }

    if (row.externalId && selfIds.has(row.externalId)) result.updated += 1;
    else result.created += 1;
  }
  return result;
}

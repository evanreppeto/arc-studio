"use server";

import { revalidatePath } from "next/cache";

import { type CsvColumnOverrides } from "@/domain";
import { requireOperator } from "@/lib/auth/operator";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { runCsvImport } from "@/lib/connectors/import";
import { getOrgPersonaKeys } from "@/lib/personas/read-model";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { type ImportPreview } from "./_components/types";

/**
 * The import surface's two actions (BSR-642). Both go through the same
 * `runCsvImport` path — the only difference is `dryRun`, so a preview cannot drift
 * from what a commit will actually do. That is the entire point of building the
 * preview on the engine rather than on a second parser.
 */

type PreviewResult = { ok: true; preview: ImportPreview } | { ok: false; error: string };
type CommitResult = { ok: true; message: string } | { ok: false; error: string };

const NOT_CONNECTED =
  "Set a default persona for imported leads in Settings → Connections → CSV Import, then come back.";

function messageFor(error: string): string {
  if (error === "csv_import_not_connected") return NOT_CONNECTED;
  if (error === "missing_default_persona") return NOT_CONNECTED;
  if (error === "no_rows") return "No usable rows in that file — check it has a header row and at least one contact.";
  if (error === "not_configured") return "Connect this workspace to a database before importing.";
  return "That import could not run.";
}

async function tenant() {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.workspaceId || !ctx.orgId) return null;
  return { workspaceId: ctx.workspaceId, orgId: ctx.orgId };
}

/**
 * Resolve the file and report what an import WOULD do. Writes nothing, opens no
 * import run, and spends nothing on enrichment.
 */
export async function previewCsvImportAction(input: {
  csvText: string;
  columnOverrides?: CsvColumnOverrides;
}): Promise<PreviewResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect this workspace to a database before importing." };
  if (!input.csvText?.trim()) return { ok: false, error: "Add a file or paste some CSV first." };

  const scope = await tenant();
  if (!scope) return { ok: false, error: "No active workspace." };

  try {
    const outcome = await runCsvImport({
      ...scope,
      csvText: input.csvText,
      columnOverrides: input.columnOverrides,
      allowedPersonaKeys: await getOrgPersonaKeys(scope.orgId),
      dryRun: true,
    });
    if (!outcome.ok) return { ok: false, error: messageFor(outcome.error) };

    return {
      ok: true,
      preview: {
        willCreate: outcome.result.imported,
        willUpdate: outcome.result.updated,
        willSkip: outcome.result.skipped,
        totalRows: outcome.parse.totalRows,
        mappedColumns: outcome.parse.mappedColumns,
        unmappedColumns: outcome.parse.unmappedColumns,
        headers: outcome.parse.headers,
        sample: outcome.result.sample ?? [],
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "That preview could not run." };
  }
}

/** Commit the import the operator just previewed. */
export async function commitCsvImportAction(input: {
  csvText: string;
  columnOverrides?: CsvColumnOverrides;
}): Promise<CommitResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect this workspace to a database before importing." };
  if (!input.csvText?.trim()) return { ok: false, error: "Add a file or paste some CSV first." };

  const scope = await tenant();
  if (!scope) return { ok: false, error: "No active workspace." };

  try {
    const outcome = await runCsvImport({
      ...scope,
      csvText: input.csvText,
      columnOverrides: input.columnOverrides,
      allowedPersonaKeys: await getOrgPersonaKeys(scope.orgId),
    });
    if (!outcome.ok) return { ok: false, error: messageFor(outcome.error) };

    const r = outcome.result;
    revalidatePath("/crm");
    return {
      ok: true,
      message: `Imported ${r.imported} new and updated ${r.updated} of ${outcome.parse.totalRows} rows${
        r.skipped ? `, skipping ${r.skipped}` : ""
      }.`,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "That import could not run." };
  }
}

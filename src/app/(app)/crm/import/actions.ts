"use server";

import { revalidatePath } from "next/cache";

import { inferCustomField, type CsvColumnOverrides, type ImportEntityKind, type InferredField } from "@/domain";
import { requireOperator } from "@/lib/auth/operator";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { runCsvImport } from "@/lib/connectors/import";
import { provisionCustomFields, type AcceptedCustomField } from "@/lib/import-runs/custom-fields";
import { reverseImportRun } from "@/lib/import-runs/reverse";
import { runEntityImport } from "@/lib/import-runs/run-entity-import";
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
        suggestedFields: outcome.parse.unmappedColumns.map((header) =>
          inferCustomField(header, outcome.parse.unmappedValues[header] ?? []),
        ),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "That preview could not run." };
  }
}

/**
 * Undo a past import (BSR-643). Re-checks reversibility inside
 * `reverseImportRun` rather than trusting the page that rendered the button — a
 * run can stop being reversible between render and click.
 */
export async function reverseImportRunAction(input: { importRunId: string }): Promise<CommitResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect this workspace to a database first." };

  const scope = await tenant();
  if (!scope) return { ok: false, error: "No active workspace." };

  const outcome = await reverseImportRun(scope, input.importRunId);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath("/crm/import");
  revalidatePath("/crm");
  return {
    ok: true,
    message:
      `Undone: removed ${outcome.deleted} record${outcome.deleted === 1 ? "" : "s"} it created` +
      (outcome.restored ? `, restored ${outcome.restored} it had changed` : "") +
      (outcome.skipped ? `. ${outcome.skipped} could not be restored — no saved snapshot.` : "."),
  };
}

/** Commit the import the operator just previewed. */
export async function commitCsvImportAction(input: {
  csvText: string;
  columnOverrides?: CsvColumnOverrides;
  /** Unmapped columns the operator chose to keep (BSR-645). */
  customFields?: AcceptedCustomField[];
}): Promise<CommitResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect this workspace to a database before importing." };
  if (!input.csvText?.trim()) return { ok: false, error: "Add a file or paste some CSV first." };

  const scope = await tenant();
  if (!scope) return { ok: false, error: "No active workspace." };

  try {
    // Definitions first: the import writes values against them, so a field that
    // could not be provisioned must be dropped from the set BEFORE the run rather
    // than failing per record afterwards.
    const requested = input.customFields ?? [];
    const provisioned = requested.length ? await provisionCustomFields(scope.orgId, requested, undefined) : null;
    const usable = provisioned
      ? requested.filter((f) => !provisioned.failed.some((x) => x.key === f.key))
      : [];

    const outcome = await runCsvImport({
      ...scope,
      csvText: input.csvText,
      columnOverrides: input.columnOverrides,
      customFields: usable,
      allowedPersonaKeys: await getOrgPersonaKeys(scope.orgId),
    });
    if (!outcome.ok) return { ok: false, error: messageFor(outcome.error) };

    const r = outcome.result;
    revalidatePath("/crm");
    return {
      ok: true,
      message:
        `Imported ${r.imported} new and updated ${r.updated} of ${outcome.parse.totalRows} rows${
          r.skipped ? `, skipping ${r.skipped}` : ""
        }.` +
        (provisioned && provisioned.created.length
          ? ` Added ${provisioned.created.length} new field${provisioned.created.length === 1 ? "" : "s"}.`
          : "") +
        (provisioned && provisioned.failed.length
          ? ` ${provisioned.failed.length} column${provisioned.failed.length === 1 ? "" : "s"} could not be added and were not imported.`
          : ""),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "That import could not run." };
  }
}

/**
 * Companies, deals and notes (BSR-644). A sibling of the contacts actions rather
 * than a branch inside them: these write different tables through a different
 * engine, and the only thing they share is the surface.
 */
export async function importEntityAction(input: {
  kind: ImportEntityKind;
  csvText: string;
  columnOverrides?: CsvColumnOverrides;
  dryRun?: boolean;
}): Promise<PreviewResult | CommitResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect this workspace to a database before importing." };
  if (!input.csvText?.trim()) return { ok: false, error: "Add a file or paste some CSV first." };

  const scope = await tenant();
  if (!scope) return { ok: false, error: "No active workspace." };

  const personas = await getOrgPersonaKeys(scope.orgId);
  const outcome = await runEntityImport({
    ...scope,
    kind: input.kind,
    csvText: input.csvText,
    columnOverrides: input.columnOverrides,
    // Companies and jobs carry a NOT NULL persona with a DB default, so this is a
    // nicety rather than a gate — unlike leads, which reject unassigned_persona.
    defaultPersona: personas[0],
    dryRun: input.dryRun,
  });
  if (!outcome.ok) return { ok: false, error: messageFor(outcome.error) };

  const r = outcome.result;
  if (input.dryRun) {
    return {
      ok: true,
      preview: {
        willCreate: r.created,
        willUpdate: r.updated,
        willSkip: r.skipped,
        totalRows: outcome.parse.totalRows,
        mappedColumns: outcome.parse.mappedColumns as never,
        unmappedColumns: outcome.parse.unmappedColumns,
        headers: outcome.parse.headers,
        // The entity engine reports per-row reasons rather than resolved records:
        // for a deal or a note, "which company did this attach to" is the thing
        // worth checking, and an unresolved parent is the only interesting row.
        // Companies/deals/notes do not offer custom fields yet — their columns
        // land on different tables with different definitions. Empty rather than
        // absent, so the shape stays honest.
        suggestedFields: [] as InferredField[],
        sample: r.errors.slice(0, 25).map((e) => ({
          externalId: e.externalId,
          action: "skip" as const,
          name: null, email: null, phone: null, company: null, persona: null, lastContactedAt: null,
          reason: e.message,
        })),
      },
    };
  }

  revalidatePath("/crm");
  revalidatePath("/crm/import");
  return {
    ok: true,
    message:
      `Imported ${r.created} new and updated ${r.updated}` +
      (r.skipped ? `, skipping ${r.skipped} that could not be matched` : "") +
      ".",
  };
}

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { ArcClient } from "../arc-client";
import { runTool, type StepFn } from "./helpers";

/**
 * Custom field values — what a workspace tracks that the built-in columns don't.
 *
 * `/api/v1/arc/crm/custom-fields` has existed since 2026-07-28 with NO tool
 * calling it, so Arc has never been able to read or write these on any object.
 * On a contact that meant missing a column. On a tenant-defined record type it
 * means missing the record: those carry a name and their custom fields, so
 * without this a custom object is a list of titles.
 *
 * Works for the six built-ins AND for tenant-defined types — the route resolves
 * either, because which keys are valid is per-workspace.
 */

const objectArg = z
  .string()
  .describe(
    'Which record type: a built-in ("companies", "contacts", "properties", "leads", "jobs", "outcomes") or a key from list_record_types.',
  );

export function customFieldReadTools(client: ArcClient, step: StepFn) {
  const readCustomFields = tool(
    "read_custom_fields",
    "Read the custom fields a workspace defined for a record type, and optionally one record's values for them. " +
      "Without record_id you get the field definitions (what is tracked, and the allowed choices); with record_id you also get that record's values. " +
      "Call this before claiming a record lacks information — the built-in columns are not everything a workspace tracks, and on a tenant-defined record type the custom fields ARE the record.",
    {
      object: objectArg,
      record_id: z.string().optional().describe("A specific record's id, to read its values as well as the definitions."),
    },
    async (args) =>
      runTool(step, `Reading custom fields on ${args.object}`, () =>
        client.apiGet("/api/v1/arc/crm/custom-fields", { object: args.object, record_id: args.record_id }),
      ),
  );

  return [readCustomFields];
}

export function customFieldWriteTools(client: ArcClient, step: StepFn) {
  const saveCustomFields = tool(
    "save_custom_fields",
    "Set custom field values on one record. Internal only — this never reaches a customer. " +
      "Pass `values` keyed by FIELD KEY (from read_custom_fields), not by label. Only the keys you send are written; the rest are left alone, so this is safe to call with a partial update. " +
      "A choice field takes one of its defined values. Read first: overwriting a value the operator set, with something you inferred, is worse than leaving it empty.",
    {
      object: objectArg,
      record_id: z.string().describe("The record to update."),
      values: z
        .record(z.string(), z.unknown())
        .describe('Field key -> value, e.g. { "serial_number": "X-1183", "condition": "in_service" }.'),
    },
    async (args) =>
      runTool(step, `Saving custom fields on ${args.object}`, () =>
        client.apiPost("/api/v1/arc/crm/custom-fields", {
          object: args.object,
          record_id: args.record_id,
          values: args.values,
        }),
      ),
  );

  return [saveCustomFields];
}

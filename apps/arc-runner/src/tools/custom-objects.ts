import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { ArcClient } from "../arc-client";
import { runTool, type StepFn } from "./helpers";

/**
 * The workspace's OWN record types.
 *
 * The six built-ins are tables with dedicated tools above. These are rows in
 * custom_objects: a tenant can define "Equipment", "Subcontractors", "Permits",
 * and Arc has no way to know they exist. Before this, a workspace could build a
 * record type, fill it, and Arc would confidently report the CRM as six objects
 * — not wrong about what it could see, just blind to a third of what was there.
 *
 * Discovery first, always. There is no fixed list of keys to hardcode against,
 * because the keys are per-workspace.
 */
export function customObjectReadTools(client: ArcClient, step: StepFn) {
  const listRecordTypes = tool(
    "list_record_types",
    "List the record types this workspace defined for itself, beyond the six built-in CRM objects (companies, contacts, properties, leads, jobs, outcomes). " +
      "Returns each type's key, its name, how many records it holds, and the fields it tracks — the fields ARE the shape of these records, so this is what tells you whether a type is worth reading. " +
      "Call this before answering any question about what the workspace tracks: the six built-ins are not the whole CRM, and the keys here are per-workspace so they cannot be guessed.",
    {},
    async () =>
      runTool(step, "Checking this workspace's own record types", () =>
        client.apiGet("/api/v1/arc/crm/object-types"),
      ),
  );

  const searchRecords = tool(
    "search_custom_records",
    "Search records of one tenant-defined record type. Get `key` from list_record_types first — the keys are per-workspace and a guess will 404. " +
      "Each row carries its custom field values inline, so one call gives you the whole record rather than a bare name. " +
      "Returns { records, total, returned, has_more }: `total` is the EXACT count of matching rows, so answer counting questions from it rather than counting rows, and pass limit=0 to count with no rows at all.",
    {
      key: z.string().describe("Record type key from list_record_types, e.g. \"equipment\"."),
      q: z.string().optional().describe("Match against the record's name and the line under it."),
      limit: z.number().optional().describe("Page size. Default 25, max 100. Use 0 to get `total` with no rows."),
      archived: z
        .boolean()
        .optional()
        .describe("Show archived records instead of live ones. Archived means the operator removed it — it is out of their lists, so do not treat it as current."),
    },
    async (args) =>
      runTool(step, `Searching ${args.key}`, () =>
        client.apiGet(`/api/v1/arc/crm/objects/${encodeURIComponent(args.key)}`, {
          q: args.q,
          limit: args.limit,
          archived: args.archived ? "true" : undefined,
        }),
      ),
  );

  return [listRecordTypes, searchRecords];
}

/**
 * Creating a record is a WRITE, and lives apart from the reads above for that
 * reason alone: registered together it rode into ask mode — which is meant to be
 * read-only — and src/tools/index.test.ts caught it by pinning the exact tool
 * list per mode. Internal either way; nothing here reaches a customer.
 */
export function customObjectWriteTools(client: ArcClient, step: StepFn) {
  const createRecord = tool(
    "create_custom_record",
    "Add a record to a tenant-defined record type. Internal only — this never reaches a customer, the same footing as create_lead. " +
      "Search first with search_custom_records: adding a second row for something already tracked is worse than not adding it. " +
      "Only `title` is structural; everything else the type tracks is a custom field, set afterwards with save_custom_fields using the id this returns.",
    {
      key: z.string().describe("Record type key from list_record_types."),
      title: z.string().describe("What this record is called — the name shown in the operator's list."),
      subtitle: z.string().optional().describe("Optional line under the name, e.g. a status or location."),
    },
    async (args) =>
      runTool(step, `Adding to ${args.key}`, () =>
        client.apiPost(`/api/v1/arc/crm/objects/${encodeURIComponent(args.key)}`, {
          title: args.title,
          subtitle: args.subtitle,
        }),
      ),
  );

  return [createRecord];
}

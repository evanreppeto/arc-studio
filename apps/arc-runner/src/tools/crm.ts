import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { ArcClient, QueryParams } from "../arc-client";
import { runTool, type StepFn } from "./helpers";
import { enforce, expectListEnvelope, expectRecord } from "./expectations";

/**
 * What every CRM list tool hands back, spelled out for the model. `total` is the
 * whole point: without it a capped page is indistinguishable from a complete
 * table, which is how Arc read a truncated 10-row fragment as the entire CRM and
 * answered "at least 64 leads" against 200 — then burned a turn's budget
 * re-querying per status to make up the difference.
 */
function listContract(key: string): string {
  return (
    `Returns { ${key}, total, returned, has_more }. \`total\` is the EXACT count of all matching rows, ` +
    `independent of the page size — answer counting questions from \`total\`, never by counting the rows ` +
    `returned. Rows are a capped page (default 25, max 100). Pass limit=0 to get \`total\` with no rows, ` +
    `which is the cheapest way to count. A \`_truncated\` marker means rows were dropped to fit the tool ` +
    `budget: the list is partial, but \`total\` is still exact.`
  );
}

type ListEnvelope = Record<string, unknown> & { total?: number; returned?: number; has_more?: boolean };

/**
 * Fetch one CRM list page and return the WHOLE envelope. These tools used to
 * return the bare row array (`r.leads ?? []`), which discarded `total` before
 * the model could ever see it.
 */
async function listPage(
  client: ArcClient,
  path: string,
  key: string,
  args: QueryParams,
): Promise<Record<string, unknown>> {
  const r = await client.apiGet<ListEnvelope>(path, args);
  // Validate the RAW response: the `?? []` this replaced is precisely what made
  // a malformed 200 indistinguishable from an empty CRM (BSR-508).
  enforce(r, expectListEnvelope(key));
  return { [key]: r[key], total: r.total, returned: r.returned, has_more: r.has_more };
}

const limitArg = z
  .number()
  .optional()
  .describe("Page size. Default 25, max 100. Use 0 to get `total` with no rows.");

/**
 * Read-only CRM tools. Each maps to a GET /api/v1/arc/crm/* endpoint and reports
 * a running -> done step. All filters optional; results are real CRM rows.
 */
export function crmReadTools(client: ArcClient, step: StepFn) {
  const searchCompanies = tool(
    "search_companies",
    `Search CRM companies (accounts/partners). Filters optional. Use for partner/account questions. ${listContract("companies")}`,
    {
      status: z.string().optional(),
      persona: z.string().optional(),
      partner_tier: z.string().optional(),
      q: z.string().optional().describe("Free-text search"),
      limit: limitArg,
    },
    async (args) =>
      runTool(step, "Searching CRM companies", () =>
        listPage(client, "/api/v1/arc/crm/companies", "companies", args),
      ),
  );

  const searchContacts = tool(
    "search_contacts",
    `Search CRM contacts (people). Filters optional. ${listContract("contacts")}`,
    {
      status: z.string().optional(),
      persona: z.string().optional(),
      company_id: z.string().optional(),
      q: z.string().optional(),
      limit: limitArg,
    },
    async (args) =>
      runTool(step, "Searching CRM contacts", () =>
        listPage(client, "/api/v1/arc/crm/contacts", "contacts", args),
      ),
  );

  const searchLeads = tool(
    "search_leads",
    `Search CRM leads/opportunities. Use when the operator asks about leads, opportunities, or who to target. Filters optional. ${listContract("leads")} ` +
      `Each row is a COMPACT SUMMARY — id, persona, status, routing_recommendation, source, loss_summary, lead_score, received_at, and resolved company/contact names. ` +
      `It deliberately omits metadata, the loss/keyword signals, and the linked record ids: call get_lead with the id for a lead's full detail.`,
    {
      status: z.string().optional(),
      persona: z.string().optional(),
      source: z.string().optional(),
      q: z.string().optional(),
      min_score: z.number().optional(),
      max_score: z.number().optional(),
      limit: limitArg,
    },
    async (args) =>
      runTool(step, "Searching CRM leads", () => listPage(client, "/api/v1/arc/crm/leads", "leads", args)),
  );

  const getLead = tool(
    "get_lead",
    "Fetch a single CRM lead by id, with full detail.",
    { id: z.string().describe("The lead id") },
    async (args) =>
      runTool(step, "Loading lead", async () => {
        const r = await client.apiGet<{ lead: unknown }>(`/api/v1/arc/crm/leads/${args.id}`);
        // `lead: null` is a real answer — that id isn't here. A MISSING `lead`
        // field is not, and must not read as "no such lead".
        return enforce(r, expectRecord("lead")).lead ?? null;
      }),
  );

  const searchJobs = tool(
    "search_jobs",
    `Search CRM jobs (restoration jobs/projects). Filters optional. ${listContract("jobs")}`,
    {
      status: z.string().optional(),
      persona: z.string().optional(),
      company_id: z.string().optional(),
      limit: limitArg,
    },
    async (args) =>
      runTool(step, "Searching CRM jobs", () => listPage(client, "/api/v1/arc/crm/jobs", "jobs", args)),
  );

  const searchOutcomes = tool(
    "search_outcomes",
    `Search CRM outcomes (closed results / attribution). Filters optional. ${listContract("outcomes")}`,
    {
      status: z.string().optional(),
      persona: z.string().optional(),
      company_id: z.string().optional(),
      limit: limitArg,
    },
    async (args) =>
      runTool(step, "Searching CRM outcomes", () =>
        listPage(client, "/api/v1/arc/crm/outcomes", "outcomes", args),
      ),
  );

  const searchProperties = tool(
    "search_properties",
    `Search CRM properties (locations/sites). Filters optional. ${listContract("properties")}`,
    {
      persona: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postal_code: z.string().optional(),
      property_type: z.string().optional(),
      company_id: z.string().optional(),
      q: z.string().optional(),
      limit: limitArg,
    },
    async (args) =>
      runTool(step, "Searching CRM properties", () =>
        listPage(client, "/api/v1/arc/crm/properties", "properties", args),
      ),
  );

  const searchCrm = tool(
    "search_crm",
    "Search existing CRM records (companies, contacts, leads) by name, email, phone, or domain BEFORE creating anything. Always call this first when you might add a lead/company/contact, and prefer update_record on a match instead of create_lead.",
    {
      q: z.string().describe("Name, email, phone, or domain to look up (min 2 chars)"),
      type: z.enum(["all", "company", "contact", "lead"]).optional(),
    },
    async (args) =>
      runTool(step, `Searching CRM for ${args.q}`, async () =>
        client.apiGet(`/api/v1/arc/crm/search`, { q: args.q, type: args.type }),
      ),
  );

  return [searchCompanies, searchContacts, searchLeads, getLead, searchJobs, searchOutcomes, searchProperties, searchCrm];
}

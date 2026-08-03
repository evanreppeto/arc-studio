import { type SupabaseClient } from "@supabase/supabase-js";

import { type EnrichmentFields, CSV_PERSONA_PROPERTY, parseCsvContacts, type CsvParseSummary } from "@/domain";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import {
  asAllowedPersona,
  importContactsFromSource,
  type ImportRunResult,
} from "@/lib/integrations/crm/import-run";
import { hubspotCrmImportSource } from "@/lib/integrations/crm/hubspot";
import { mailchimpImportSource } from "@/lib/integrations/crm/mailchimp";
import { fixtureCrmImportSourceFromContacts } from "@/lib/integrations/crm/source";
import { type EnrichmentLookupKeys, type EnrichmentProvider } from "@/lib/integrations/enrichment/provider";
import { vendorEnrichmentProvider } from "@/lib/integrations/enrichment/vendor";

import {
  finishImportRun,
  recordImportedRecord,
  resolveExternalSystemId,
  startImportRun,
  type ImportSource,
} from "@/lib/import-runs/persistence";

import { getConnectorConfig } from "./config";
import { readConnectorCredential } from "./credentials";
import { resolveHubspotAccessToken } from "./hubspot-oauth";
import { meterConnectorCall } from "./metering";
import { listWorkspaceConnectors, resolveConnectorCredentialRef } from "./read-model";

// ---------------------------------------------------------------------------
// CRM import orchestrator (BSR-368). Import is modeled as the new `import_source`
// connector kind: read-IN, writes ONLY CRM rows through the gated ingest path, and
// runs as an EXPLICIT operator action — NOT on the automatic signal-detection loop
// (runSignalSourceDetection). That separation is deliberate: signal sources stay
// read-only (they only ever write `opportunities`), while a CRM import mutates CRM
// records and therefore must be operator-triggered.
//
// This module resolves the enabled `hubspot-import` connector (credential + config),
// builds the live HubSpot source, optionally layers the metered `lead-enrichment`
// provider (each lookup guarded by the spend cap), and runs the provider-agnostic
// import engine. No outbound, ever.
// ---------------------------------------------------------------------------

export const HUBSPOT_IMPORT_CONNECTOR_KEY = "hubspot-import";
export const LEAD_ENRICHMENT_CONNECTOR_KEY = "lead-enrichment";
export const CSV_IMPORT_CONNECTOR_KEY = "csv-import";
export const MAILCHIMP_IMPORT_CONNECTOR_KEY = "mailchimp-import";

/**
 * Open an import run and build the per-record provenance recorder for it (BSR-640).
 *
 * Returns a null runId when provenance could not be started — the import then runs
 * exactly as it did before. That degradation is deliberate: a customer's data
 * import must not fail because a bookkeeping row would not write.
 *
 * The workspace is the point. The connector is configured per workspace but the
 * CRM rows it writes are org-owned, so without recording it here "where did these
 * 400 contacts come from" has no answer at all once a company has two workspaces.
 */
async function beginRun(
  client: SupabaseClient,
  tenant: { orgId: string; workspaceId: string },
  source: ImportSource,
  options: Record<string, unknown>,
) {
  const runId = await startImportRun({ ...tenant, source, options, client });
  const externalSystemId = runId ? await resolveExternalSystemId(tenant, source, client) : null;

  const recordProvenance = runId
    ? async (record: { externalId: string; leadId: string; action: "created" | "updated" }) => {
        await recordImportedRecord(
          tenant,
          {
            importRunId: runId,
            localTable: "leads",
            localId: record.leadId,
            externalId: record.externalId,
            action: record.action,
            // BSR-643 owns restoring overwritten values and will populate this from
            // the pre-update row. Recording the action now is what lets it tell a
            // created row (delete on undo) from an updated one (restore), which is
            // the distinction a blanket delete would destroy.
            previous: null,
          },
          externalSystemId,
          client,
        );
      }
    : undefined;

  return { runId, recordProvenance };
}

export type RunCrmImportInput = {
  workspaceId: string;
  orgId: string;
  client?: SupabaseClient;
  now?: string;
  maxPages?: number;
  /** Per-org allowed persona keys; defaults to the official set inside the engine. */
  allowedPersonaKeys?: readonly string[];
};

export type RunCrmImportResult =
  | { ok: true; result: ImportRunResult; enrichmentEnabled: boolean }
  | { ok: false; error: string };

/**
 * Wrap an enrichment provider in the metered cost guard: every lookup is authorized
 * against the workspace spend cap BEFORE it runs and its usage recorded after. A
 * lookup that would breach the cap is refused — the provider returns null (no
 * firmographics, no spend) and the import continues. `lead-enrichment` is a metered
 * connector, so this is the ONLY way its provider should be called in production.
 */
export function meteredEnrichmentProvider(
  base: EnrichmentProvider,
  ctx: { client: SupabaseClient; orgId: string; workspaceId: string; connectorKey?: string },
): EnrichmentProvider {
  const connectorKey = ctx.connectorKey ?? LEAD_ENRICHMENT_CONNECTOR_KEY;
  return {
    async enrich(keys: EnrichmentLookupKeys): Promise<EnrichmentFields | null> {
      const outcome = await meterConnectorCall<EnrichmentFields | null>(
        ctx.client,
        {
          orgId: ctx.orgId,
          workspaceId: ctx.workspaceId,
          connectorKey,
          estimatedUnits: 1,
          context: { source: "crm_import_enrichment" },
        },
        () => base.enrich(keys),
      );
      return outcome.ok ? outcome.result : null;
    },
  };
}

/**
 * Build the metered enrichment provider for a workspace when `lead-enrichment` is
 * enabled + credentialed + has an endpoint configured; otherwise null (import runs
 * without firmographics). Kept separate so the enrichment wiring is testable.
 */
async function resolveEnrichmentProvider(
  client: SupabaseClient,
  workspaceId: string,
  orgId: string,
): Promise<EnrichmentProvider | null> {
  const ref = await resolveConnectorCredentialRef(client, workspaceId, LEAD_ENRICHMENT_CONNECTOR_KEY);
  const apiKey = await readConnectorCredential(client, ref);
  if (!apiKey) return null;
  const config = await getConnectorConfig(client, workspaceId, LEAD_ENRICHMENT_CONNECTOR_KEY);
  const endpoint = typeof config.endpoint === "string" && config.endpoint.trim() ? config.endpoint.trim() : null;
  if (!endpoint) return null;
  const base = vendorEnrichmentProvider(apiKey, { endpoint });
  return meteredEnrichmentProvider(base, { client, orgId, workspaceId });
}

/**
 * Run a CRM import for the workspace's enabled HubSpot connector. Resolves the
 * OAuth token + config, builds the live source, layers metered enrichment if
 * enabled, and imports idempotently. Returns a structured error (never throws for
 * an expected "not connected" / "misconfigured" case) so a caller can surface it.
 */
export async function runCrmImport(input: RunCrmImportInput): Promise<RunCrmImportResult> {
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "not_configured" };
  const client = input.client ?? getSupabaseAdminClient();

  const views = await listWorkspaceConnectors(client, input.workspaceId);
  const importView = views.find((v) => v.key === HUBSPOT_IMPORT_CONNECTOR_KEY);
  if (!importView || importView.status !== "connected") {
    return { ok: false, error: "hubspot_import_not_connected" };
  }

  const ref = await resolveConnectorCredentialRef(client, input.workspaceId, HUBSPOT_IMPORT_CONNECTOR_KEY);
  const rawCredential = await readConnectorCredential(client, ref);
  if (!rawCredential) return { ok: false, error: "missing_credential" };
  // The stored credential is either an OAuth bundle (refreshed here) or a pasted
  // private-app token (used as-is) — resolveHubspotAccessToken hides the difference.
  const resolved = await resolveHubspotAccessToken(client, ref, rawCredential);
  if (!resolved.ok) return { ok: false, error: "hubspot_auth_failed" };
  const token = resolved.accessToken;

  const config = await getConnectorConfig(client, input.workspaceId, HUBSPOT_IMPORT_CONNECTOR_KEY);
  const defaultPersona = asAllowedPersona(config.defaultPersona, input.allowedPersonaKeys);
  if (!defaultPersona) return { ok: false, error: "missing_default_persona" };

  const source = hubspotCrmImportSource(token, {
    pageSize: typeof config.pageSize === "number" ? config.pageSize : undefined,
    updatedAfter: typeof config.updatedAfter === "string" ? config.updatedAfter : undefined,
  });

  const enrichment = await resolveEnrichmentProvider(client, input.workspaceId, input.orgId);

  const tenant = { orgId: input.orgId, workspaceId: input.workspaceId };
  const { runId, recordProvenance } = await beginRun(client, tenant, "hubspot", { defaultPersona });

  try {
    const result = await importContactsFromSource({
      client,
      orgId: input.orgId,
      source,
      options: {
        defaultPersona,
        personaProperty: typeof config.personaProperty === "string" ? config.personaProperty : undefined,
        source: typeof config.source === "string" ? config.source : "hubspot",
      },
      now: input.now,
      enrichment: enrichment ?? undefined,
      allowedPersonaKeys: input.allowedPersonaKeys,
      maxPages: input.maxPages,
      recordProvenance,
    });

    await finishImportRun(runId, { status: "completed", counts: result }, client);
    return { ok: true, result, enrichmentEnabled: Boolean(enrichment) };
  } catch (error) {
    await finishImportRun(runId, { status: "failed" }, client);
    throw error;
  }
}

/**
 * Run a Mailchimp audience import for the workspace's enabled connector. Resolves the
 * API key + audience id + default persona, builds the live Mailchimp source, and runs
 * the same provider-agnostic import engine as HubSpot. Structured errors, never throws
 * for an expected "not connected" / "misconfigured" case.
 */
export async function runMailchimpImport(input: RunCrmImportInput): Promise<RunCrmImportResult> {
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "not_configured" };
  const client = input.client ?? getSupabaseAdminClient();

  const views = await listWorkspaceConnectors(client, input.workspaceId);
  const view = views.find((v) => v.key === MAILCHIMP_IMPORT_CONNECTOR_KEY);
  if (!view || view.status !== "connected") return { ok: false, error: "mailchimp_import_not_connected" };

  const ref = await resolveConnectorCredentialRef(client, input.workspaceId, MAILCHIMP_IMPORT_CONNECTOR_KEY);
  const apiKey = await readConnectorCredential(client, ref);
  if (!apiKey) return { ok: false, error: "missing_credential" };

  const config = await getConnectorConfig(client, input.workspaceId, MAILCHIMP_IMPORT_CONNECTOR_KEY);
  const audienceId = typeof config.audienceId === "string" && config.audienceId.trim() ? config.audienceId.trim() : null;
  if (!audienceId) return { ok: false, error: "missing_audience" };
  const defaultPersona = asAllowedPersona(config.defaultPersona, input.allowedPersonaKeys);
  if (!defaultPersona) return { ok: false, error: "missing_default_persona" };

  const tenant = { orgId: input.orgId, workspaceId: input.workspaceId };
  const { runId, recordProvenance } = await beginRun(client, tenant, "mailchimp", { defaultPersona, audienceId });

  try {
    const result = await importContactsFromSource({
      client,
      orgId: input.orgId,
      source: mailchimpImportSource(apiKey, audienceId),
      options: { defaultPersona, source: "mailchimp" },
      now: input.now,
      allowedPersonaKeys: input.allowedPersonaKeys,
      maxPages: input.maxPages,
      recordProvenance,
    });

    await finishImportRun(runId, { status: "completed", counts: result }, client);
    return { ok: true, result, enrichmentEnabled: false };
  } catch (error) {
    await finishImportRun(runId, { status: "failed" }, client);
    throw error;
  }
}

export type RunCsvImportInput = {
  workspaceId: string;
  orgId: string;
  /** The pasted / uploaded CSV, provided at action time (never stored as config). */
  csvText: string;
  client?: SupabaseClient;
  now?: string;
  allowedPersonaKeys?: readonly string[];
};

export type RunCsvImportResult =
  | { ok: true; result: ImportRunResult; parse: Omit<CsvParseSummary, "contacts"> }
  | { ok: false; error: string };

/**
 * Import leads from a pasted CSV. Unlike the HubSpot import, the data arrives at
 * action time rather than from a stored credential — but everything downstream is
 * identical: parseCsvContacts maps rows to the engine's contact shape, and
 * importContactsFromSource runs the same map → validate → dedup → persist pipeline,
 * so an emailed CSV re-import updates leads instead of duplicating them. No outbound.
 *
 * The connector must be enabled with a default persona configured (leads carry a
 * NOT NULL persona); a `persona` column, when present, overrides it per row.
 */
export async function runCsvImport(input: RunCsvImportInput): Promise<RunCsvImportResult> {
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "not_configured" };
  const client = input.client ?? getSupabaseAdminClient();

  const views = await listWorkspaceConnectors(client, input.workspaceId);
  const view = views.find((v) => v.key === CSV_IMPORT_CONNECTOR_KEY);
  if (!view || view.status !== "connected") return { ok: false, error: "csv_import_not_connected" };

  const config = await getConnectorConfig(client, input.workspaceId, CSV_IMPORT_CONNECTOR_KEY);
  const defaultPersona = asAllowedPersona(config.defaultPersona, input.allowedPersonaKeys);
  if (!defaultPersona) return { ok: false, error: "missing_default_persona" };

  const { contacts, ...parse } = parseCsvContacts(input.csvText);
  if (contacts.length === 0) return { ok: false, error: "no_rows" };

  const tenant = { orgId: input.orgId, workspaceId: input.workspaceId };
  const { runId, recordProvenance } = await beginRun(client, tenant, "csv", {
    defaultPersona,
    // The parse summary, not the CSV itself — a run record must not become a
    // second copy of the customer's contact list. mappedColumns is the useful
    // half: it is what BSR-642's mapping step will replay to explain a past run.
    mappedColumns: parse.mappedColumns,
    totalRows: parse.totalRows,
  });

  try {
    const result = await importContactsFromSource({
      client,
      orgId: input.orgId,
      source: fixtureCrmImportSourceFromContacts(contacts),
      options: {
        defaultPersona,
        // A `persona` column (when the CSV has one) overrides the default per row.
        personaProperty: CSV_PERSONA_PROPERTY,
        source: "csv",
      },
      now: input.now,
      allowedPersonaKeys: input.allowedPersonaKeys,
      recordProvenance,
    });

    await finishImportRun(runId, { status: "completed", counts: result }, client);
    return { ok: true, result, parse };
  } catch (error) {
    await finishImportRun(runId, { status: "failed" }, client);
    throw error;
  }
}

import { type SupabaseClient } from "@supabase/supabase-js";

import {
  applyEnrichmentToLead,
  mapHubspotContactToLead,
  parseLeadIngestionPayload,
  type HubspotContact,
  type HubspotImportOptions,
  type LeadIngestionInput,
  type OfficialPersonaMapping,
  OFFICIAL_PERSONA_MAPPINGS,
} from "@/domain";
import { findExistingLeadByExternalId, snapshotLeadRow, type ExistingLeadRefs } from "@/lib/lead-ingestion/idempotency";
import { persistLeadIngestion, type LeadProvenance } from "@/lib/lead-ingestion/persistence";

import { type EnrichmentProvider } from "../enrichment/provider";
import { type CrmImportSource } from "./source";

/**
 * The two persistence seams the engine depends on, injectable so the engine's
 * idempotency + best-effort + counting logic can be unit-tested in isolation
 * without a live Supabase client. Default to the real implementations.
 */
export type ImportPersistDeps = {
  persist?: typeof persistLeadIngestion;
  findExisting?: typeof findExistingLeadByExternalId;
  /** Reads the row an update is about to overwrite, so a reversal can restore it. */
  snapshot?: typeof snapshotLeadRow;
};

/**
 * Called once per successfully persisted record so the caller can write batch
 * provenance (BSR-640). Injected rather than imported so the engine stays
 * network-free in unit tests, and OPTIONAL so an import without a run still works.
 *
 * Best-effort by contract: the engine swallows anything this throws. Failing a
 * customer's data import because a bookkeeping row would not write is the wrong
 * trade every time.
 */
export type ImportProvenanceRecorder = (record: {
  externalId: string;
  leadId: string;
  action: "created" | "updated";
  /** Pre-existing row refs when this was an update, so a reversal can restore. */
  existing: ExistingLeadRefs | null;
  /** The row as it stood BEFORE this run overwrote it. Null for a create. */
  previous: Record<string, unknown> | null;
}) => Promise<void>;

// ---------------------------------------------------------------------------
// The provider-agnostic CRM import engine (BSR-368). It pages a `CrmImportSource`,
// maps each contact onto the lead-ingestion contract, optionally augments it with
// firmographic enrichment, then writes it through the EXISTING gated persist path —
// idempotently, keyed on the source system's external id, and org-scoped. It is the
// unit-tested core: it takes an injected source + client, so it never touches the
// network. Read-IN only — the only writes are CRM rows via persistLeadIngestion;
// nothing here contacts anyone.
//
// Best-effort per record: a single bad contact is counted and skipped/failed, it
// never sinks the batch. Idempotent: a re-import of the same external id UPDATES the
// existing lead (and reuses its company/contact/property) instead of inserting a
// duplicate — proven by findExistingLeadByExternalId.
// ---------------------------------------------------------------------------

/** Default hard cap on pages pulled in one run — a safety valve against a runaway cursor. */
export const DEFAULT_MAX_IMPORT_PAGES = 100;

export type ImportRunError = { externalId: string; message: string };

/**
 * A resolved record as the engine would write it, for the preview (BSR-641). Kept
 * to what an operator can actually check by eye — the point is to confirm the
 * column mapping worked before committing, not to render the whole payload.
 */
export type ImportSampleRecord = {
  externalId: string;
  action: "create" | "update" | "skip";
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  persona: string | null;
  /** Resolved last-contacted date, so "would every lead land as new?" is answerable. */
  lastContactedAt: string | null;
  /** Why it would be skipped. Null for create/update. */
  reason: string | null;
};

/** How many resolved records a dry run carries back. Enough to spot a mis-mapped
 *  column, few enough that the result stays a summary rather than a second copy
 *  of the customer's file. */
export const DRY_RUN_SAMPLE_SIZE = 25;

export type ImportRunResult = {
  /** New leads inserted. */
  imported: number;
  /** Existing leads updated in place (idempotent re-import). */
  updated: number;
  /** Contacts skipped (unusable record or persona/contract rejection). */
  skipped: number;
  /** Contacts that threw during persistence. */
  failed: number;
  /** Contacts enriched with firmographics this run. */
  enriched: number;
  /** Pages pulled from the source. */
  pages: number;
  /** Best-effort per-record errors (skips with a reason + failures). */
  errors: ImportRunError[];
  /** Resolved sample records. Only populated on a dry run. */
  sample?: ImportSampleRecord[];
};

export type ImportContactsInput = {
  client: SupabaseClient;
  orgId: string;
  source: CrmImportSource;
  options: HubspotImportOptions;
  /** ISO "now" for deterministic scoring; defaults to the current time. */
  now?: string;
  /** Optional firmographic enrichment applied per contact before persistence. */
  enrichment?: EnrichmentProvider;
  /** Per-org allowed persona keys; defaults to the official set. */
  allowedPersonaKeys?: readonly string[];
  /** Provenance stamp for the written rows; defaults to agent-origin + active. */
  provenance?: LeadProvenance;
  /** Page cap; defaults to DEFAULT_MAX_IMPORT_PAGES. */
  maxPages?: number;
  /** Injectable persistence seams (tests); default to the real functions. */
  deps?: ImportPersistDeps;
  /** Optional per-record provenance sink (BSR-640). Absent = import without a run. */
  recordProvenance?: ImportProvenanceRecorder;
  /**
   * Resolve everything and write NOTHING (BSR-641). Same counts, same skip
   * reasons, plus a sample of resolved records — so an operator can see what an
   * import would do before it does it. Today the only way to find that out is to
   * run it, which is the scariest moment in onboarding for someone uploading five
   * years of customer data into a product they met twenty minutes ago.
   */
  dryRun?: boolean;
};

function emptyResult(): ImportRunResult {
  return { imported: 0, updated: 0, skipped: 0, failed: 0, enriched: 0, pages: 0, errors: [] };
}

/**
 * Collect a resolved record for the dry-run preview. No-op on a real import, so
 * the live path carries no extra cost and cannot leak sample data into a result
 * the UI would then render as a preview of something already committed.
 */
function addSample(
  input: ImportContactsInput,
  result: ImportRunResult,
  entry: { externalId: string; action: ImportSampleRecord["action"]; reason: string | null; lead?: LeadIngestionInput },
): void {
  if (!input.dryRun) return;
  result.sample ??= [];
  if (result.sample.length >= DRY_RUN_SAMPLE_SIZE) return;

  const lead = entry.lead;
  const first = lead?.contact?.firstName?.trim() ?? "";
  const last = lead?.contact?.lastName?.trim() ?? "";
  const name = `${first} ${last}`.trim();

  result.sample.push({
    externalId: entry.externalId,
    action: entry.action,
    name: name || null,
    email: lead?.contact?.email ?? null,
    phone: lead?.contact?.phone ?? null,
    company: lead?.company?.name ?? null,
    persona: typeof lead?.persona === "string" ? lead.persona : null,
    // The column that decides whether anything is ever cold. Surfacing it here is
    // what lets an operator notice their date column did not parse BEFORE every
    // imported lead lands as "received today".
    lastContactedAt: lead?.receivedAt ?? null,
    reason: entry.reason,
  });
}

async function importOneContact(
  contact: HubspotContact,
  input: ImportContactsInput,
  result: ImportRunResult,
): Promise<void> {
  const externalId = contact.id;
  // Thread the workspace's allowed personas into the per-record resolution so a
  // mapped override in the org's own taxonomy is honored (not just official ones).
  let lead: LeadIngestionInput | null = mapHubspotContactToLead(contact, {
    ...input.options,
    allowedPersonaKeys: input.options.allowedPersonaKeys ?? input.allowedPersonaKeys,
  });

  // An import carries history: a contact last touched eight months ago must land
  // as an eight-month-old lead, not a brand-new one, or nothing is ever cold.
  if (lead && contact.updatedAt) {
    lead = { ...lead, receivedAt: contact.updatedAt };
  }
  if (!lead) {
    result.skipped += 1;
    result.errors.push({ externalId, message: "no usable name/email/phone" });
    addSample(input, result, { externalId, action: "skip", reason: "no usable name/email/phone" });
    return;
  }

  // Enrichment is METERED — meterConnectorCall authorizes each lookup against the
  // workspace spend cap and records usage after. A preview that silently spends
  // money is a worse bug than no preview, so a dry run reports what WOULD be
  // enriched and spends nothing.
  if (input.enrichment && input.dryRun) {
    result.enriched += 1;
  } else if (input.enrichment) {
    const fields = await input.enrichment.enrich({
      email: lead.contact?.email,
      companyName: lead.company?.name,
    });
    if (fields) {
      lead = applyEnrichmentToLead(lead, fields);
      result.enriched += 1;
    }
  }

  const parsed = parseLeadIngestionPayload(lead, input.now, input.allowedPersonaKeys ?? OFFICIAL_PERSONA_MAPPINGS);
  if (!parsed.ok) {
    const message = parsed.errors.map((e) => e.message).join("; ") || "rejected";
    result.skipped += 1;
    result.errors.push({ externalId, message });
    addSample(input, result, { externalId, action: "skip", reason: message, lead });
    return;
  }

  const findExisting = input.deps?.findExisting ?? findExistingLeadByExternalId;
  const persist = input.deps?.persist ?? persistLeadIngestion;
  const snapshot = input.deps?.snapshot ?? snapshotLeadRow;
  const existing = await findExisting(input.client, input.orgId, lead.externalLeadId);

  // Capture BEFORE the write, and only when someone is recording and there is
  // something to overwrite. An undo that can only delete what a run created, and
  // not put back what it changed, is half an undo.
  const previous =
    input.recordProvenance && !input.dryRun && existing?.leadId
      ? await snapshot(input.client, input.orgId, existing.leadId)
      : null;

  // The whole dry run: everything above has resolved — mapping, enrichment,
  // validation, and the create-vs-update decision, which findExisting has just
  // made. Stop before the only line that writes.
  if (input.dryRun) {
    if (existing?.leadId) result.updated += 1;
    else result.imported += 1;
    addSample(input, result, { externalId, action: existing?.leadId ? "update" : "create", reason: null, lead });
    return;
  }

  const persisted = await persist({
    input: parsed.normalizedInput,
    result: parsed,
    supabase: input.client,
    orgId: input.orgId,
    provenance: input.provenance ?? { origin: "agent", reviewStatus: "active" },
    existing: existing
      ? { companyId: existing.companyId, contactId: existing.contactId, propertyId: existing.propertyId, leadId: existing.leadId }
      : undefined,
  });
  if (persisted.leadCreated) result.imported += 1;
  else result.updated += 1;

  // Provenance is bookkeeping AROUND the import, not part of it. A failure here
  // must not turn a persisted record into a counted failure, so it is caught and
  // dropped rather than allowed to reach the per-record catch in the page loop —
  // which would report a row that actually landed as failed.
  if (input.recordProvenance && persisted.leadId) {
    await input
      .recordProvenance({
        externalId,
        leadId: persisted.leadId,
        action: persisted.leadCreated ? "created" : "updated",
        existing,
        previous,
      })
      .catch(() => undefined);
  }
}

/**
 * Import contacts from `source` into CRM leads, idempotently + org-scoped.
 * Paginates until the source runs out (or maxPages), best-effort per record.
 */
export async function importContactsFromSource(input: ImportContactsInput): Promise<ImportRunResult> {
  const result = emptyResult();
  const maxPages = Math.max(1, input.maxPages ?? DEFAULT_MAX_IMPORT_PAGES);
  let cursor: string | undefined;

  while (result.pages < maxPages) {
    const page = await input.source.listContacts(cursor);
    result.pages += 1;

    for (const contact of page.contacts) {
      if (!contact?.id) {
        result.skipped += 1;
        continue;
      }
      try {
        await importOneContact(contact, input, result);
      } catch (error) {
        result.failed += 1;
        result.errors.push({ externalId: contact.id, message: error instanceof Error ? error.message : "persist failed" });
      }
    }

    cursor = page.nextCursor ?? undefined;
    if (!cursor) break;
  }

  return result;
}

/** Narrow + validate a config-supplied persona string to an official persona, or null. */
export function asOfficialPersona(value: unknown): OfficialPersonaMapping | null {
  return typeof value === "string" && (OFFICIAL_PERSONA_MAPPINGS as readonly string[]).includes(value)
    ? (value as OfficialPersonaMapping)
    : null;
}

/**
 * Validate a config-supplied default persona against the workspace's own taxonomy
 * (`allowedKeys`), or the official set when no taxonomy is provided (back-compat /
 * offline). Returns the key when allowed, else null so the caller can report a
 * clean "missing/invalid default persona" rather than a late ingest rejection.
 */
export function asAllowedPersona(value: unknown, allowedKeys?: readonly string[]): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  if (allowedKeys && allowedKeys.length > 0) return allowedKeys.includes(value) ? value : null;
  return asOfficialPersona(value);
}

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
import { findExistingLeadByExternalId, type ExistingLeadRefs } from "@/lib/lead-ingestion/idempotency";
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
};

function emptyResult(): ImportRunResult {
  return { imported: 0, updated: 0, skipped: 0, failed: 0, enriched: 0, pages: 0, errors: [] };
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
    return;
  }

  if (input.enrichment) {
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
    result.skipped += 1;
    result.errors.push({ externalId, message: parsed.errors.map((e) => e.message).join("; ") || "rejected" });
    return;
  }

  const findExisting = input.deps?.findExisting ?? findExistingLeadByExternalId;
  const persist = input.deps?.persist ?? persistLeadIngestion;
  const existing = await findExisting(input.client, input.orgId, lead.externalLeadId);
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

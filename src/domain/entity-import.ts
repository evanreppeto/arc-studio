import { parseCsv, parseCsvDate, type CsvColumnOverrides } from "./csv-import";

/**
 * Entity-per-file import (BSR-644).
 *
 * The contacts engine imports one flat contact sheet. A real CRM export is
 * several files — companies, contacts, deals, notes — and the relationships
 * BETWEEN them are most of what makes the data worth migrating. This module
 * parses the other three.
 *
 * The load-bearing idea is the **external id**. Every row carries the source
 * system's own id, and rows reference each other by those ids rather than by
 * name. That is what lets a deals file uploaded a week after the companies file
 * still attach to the right company, and what stops a re-import re-parenting
 * anything. Resolution happens in the import engine against
 * `external_object_mappings`; this module only reads the ids out of the file.
 *
 * Pure — no I/O, so the whole mapping surface is unit-testable.
 */

export type ImportEntityKind = "companies" | "deals" | "notes";

/** Fields each entity kind can map a column onto. */
export type CompanyField = "externalId" | "name" | "website" | "phone" | "email" | "city" | "state";
export type DealField =
  | "externalId"
  | "name"
  | "companyExternalId"
  | "status"
  | "valueUsd"
  | "closedAt"
  | "scheduledAt";
export type NoteField = "externalId" | "body" | "companyExternalId" | "contactExternalId" | "author" | "createdAt";

type AliasMap = Record<string, string>;

/** Shared id aliases. A CRM export names its own key a dozen ways. */
const ID_ALIASES = ["id", "recordid", "objectid", "externalid", "hubspotid", "salesforceid", "crmid"];

const COMPANY_ALIASES: AliasMap = {
  ...Object.fromEntries(ID_ALIASES.map((a) => [a, "externalId"])),
  companyid: "externalId",
  name: "name", companyname: "name", account: "name", accountname: "name", organization: "name", business: "name",
  website: "website", url: "website", domain: "website", websiteurl: "website",
  phone: "phone", phonenumber: "phone", mainphone: "phone",
  email: "email", emailaddress: "email",
  city: "city", town: "city",
  state: "state", province: "state", region: "state",
};

const DEAL_ALIASES: AliasMap = {
  ...Object.fromEntries(ID_ALIASES.map((a) => [a, "externalId"])),
  dealid: "externalId", jobid: "externalId", opportunityid: "externalId",
  name: "name", dealname: "name", jobname: "name", title: "name", subject: "name", opportunityname: "name",
  companyid: "companyExternalId", accountid: "companyExternalId", company: "companyExternalId",
  account: "companyExternalId", associatedcompany: "companyExternalId", associatedcompanyid: "companyExternalId",
  status: "status", stage: "status", dealstage: "status", jobstatus: "status",
  amount: "valueUsd", value: "valueUsd", dealvalue: "valueUsd", revenue: "valueUsd", estimatedvalue: "valueUsd",
  closedate: "closedAt", closedat: "closedAt", wondate: "closedAt", completedat: "closedAt",
  scheduledat: "scheduledAt", scheduleddate: "scheduledAt", startdate: "scheduledAt",
};

const NOTE_ALIASES: AliasMap = {
  ...Object.fromEntries(ID_ALIASES.map((a) => [a, "externalId"])),
  noteid: "externalId", activityid: "externalId",
  body: "body", note: "body", notes: "body", content: "body", comment: "body", description: "body", details: "body",
  companyid: "companyExternalId", accountid: "companyExternalId", associatedcompany: "companyExternalId",
  contactid: "contactExternalId", associatedcontact: "contactExternalId", relatedcontact: "contactExternalId",
  author: "author", owner: "author", createdby: "author", notedby: "author",
  createdat: "createdAt", date: "createdAt", createddate: "createdAt", timestamp: "createdAt", notedat: "createdAt",
};

const ALIASES: Record<ImportEntityKind, AliasMap> = {
  companies: COMPANY_ALIASES,
  deals: DEAL_ALIASES,
  notes: NOTE_ALIASES,
};

/** Same normalization as the contacts mapper: lowercase, strip non-alphanumerics. */
function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type ParsedEntityRow = {
  /** The source system's id for this row. Blank when the file has no id column. */
  externalId: string;
  values: Record<string, string>;
};

export type EntityParseSummary = {
  kind: ImportEntityKind;
  rows: ParsedEntityRow[];
  headers: string[];
  mappedColumns: Record<string, string>;
  unmappedColumns: string[];
  totalRows: number;
  /** Rows dropped for having nothing usable, with why. */
  skipped: Array<{ row: number; reason: string }>;
};

/** The one field each kind cannot do without. */
const REQUIRED_FIELD: Record<ImportEntityKind, string> = {
  companies: "name",
  deals: "name",
  notes: "body",
};

/**
 * Parse an entity CSV. `overrides` corrects the detected mapping by header name,
 * exactly as the contacts importer does — and, as there, an explicit choice
 * releases the field from whichever column detection had claimed it, so the
 * result cannot depend on column order.
 */
export function parseEntityCsv(
  kind: ImportEntityKind,
  text: string,
  overrides?: CsvColumnOverrides,
): EntityParseSummary {
  const csvRows = parseCsv(text);
  const empty: EntityParseSummary = {
    kind, rows: [], headers: [], mappedColumns: {}, unmappedColumns: [], totalRows: 0, skipped: [],
  };
  if (csvRows.length === 0) return empty;

  const [header, ...dataRows] = csvRows;
  const aliases = ALIASES[kind];

  const mapping: Record<number, string> = {};
  header.forEach((name, index) => {
    const field = aliases[normalizeHeader(name)];
    if (field) mapping[index] = field;
  });

  if (overrides) {
    for (const [name, field] of Object.entries(overrides)) {
      const index = header.findIndex((h) => h.trim() === name.trim());
      if (index < 0) continue;
      if (field === null) {
        delete mapping[index];
        continue;
      }
      for (const [otherIndex, otherField] of Object.entries(mapping)) {
        if (otherField === field && Number(otherIndex) !== index) delete mapping[Number(otherIndex)];
      }
      mapping[index] = field;
    }
  }

  const mappedColumns: Record<string, string> = {};
  for (const [indexStr, field] of Object.entries(mapping)) mappedColumns[field] = header[Number(indexStr)];

  const required = REQUIRED_FIELD[kind];
  const rows: ParsedEntityRow[] = [];
  const skipped: EntityParseSummary["skipped"] = [];
  const seen = new Set<string>();

  dataRows.forEach((cells, i) => {
    const values: Record<string, string> = {};
    for (const [indexStr, field] of Object.entries(mapping)) {
      const value = (cells[Number(indexStr)] ?? "").trim();
      if (value) values[field] = value;
    }

    if (!values[required]) {
      skipped.push({ row: i + 2, reason: `no ${required}` });
      return;
    }

    const externalId = values.externalId ?? "";
    // In-file dedup on the source id. A single export occasionally repeats a row;
    // importing it twice would create two records the source considers one.
    if (externalId && seen.has(externalId)) return;
    if (externalId) seen.add(externalId);

    rows.push({ externalId, values });
  });

  return {
    kind,
    rows,
    headers: header.map((h) => h.trim()),
    mappedColumns,
    unmappedColumns: header.filter((_, i) => !(i in mapping)).map((h) => h.trim()).filter(Boolean),
    totalRows: dataRows.length,
    skipped,
  };
}

/** Dollars (or "$1,200.50") to integer cents. Null when it isn't a number. */
export function parseUsdToCents(value: string | undefined): number | null {
  const raw = value?.replace(/[$,\s]/g, "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

/** Re-exported so the engine parses dates the same conservative way everywhere. */
export { parseCsvDate };

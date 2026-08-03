import type { HubspotContact } from "./crm-import";

/**
 * Pure logic for the `csv-import` connector: parse a pasted CSV and map its rows to
 * the contact shape the existing CRM import engine already knows how to ingest.
 *
 * No I/O. Deliberately produces `HubspotContact` objects — despite the name that's
 * just the engine's generic `{ id, properties }` contact — so a CSV row flows through
 * the exact same map → validate → dedup → persist pipeline as a HubSpot pull. The
 * only thing new here is reading a CSV and deciding which column is which.
 */

// --- CSV parsing (RFC-4180-ish) ----------------------------------------------

/**
 * Parse CSV text into rows of cells. Handles quoted fields, commas and newlines
 * inside quotes, and escaped quotes (`""`). Accepts CRLF or LF. A field-count
 * mismatch on a row is tolerated (short rows pad, long rows keep extras) — real
 * exports are messy and dropping a row loses a lead.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text ?? "";

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue; // fold CRLF -> LF
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  // Flush the trailing field/row unless the input ended on a clean newline.
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  // Drop wholly-empty rows (a blank line between records).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// --- Column mapping ----------------------------------------------------------

/** The lead fields a CSV column can feed. `name` is a full name split downstream. */
export type CsvField = "firstName" | "lastName" | "name" | "email" | "phone" | "company" | "city" | "state" | "zip" | "persona" | "lastContactedAt";

/** Header aliases → canonical field. Lowercased, non-alphanumerics stripped, so
 *  "First Name", "first_name" and "GivenName" all collapse to the same key. */
const HEADER_ALIASES: Record<string, CsvField> = {
  firstname: "firstName", first: "firstName", fname: "firstName", givenname: "firstName",
  lastname: "lastName", last: "lastName", lname: "lastName", surname: "lastName", familyname: "lastName",
  name: "name", fullname: "name", contactname: "name", contact: "name",
  email: "email", emailaddress: "email", mail: "email", workemail: "email",
  phone: "phone", phonenumber: "phone", mobile: "phone", cell: "phone", tel: "phone", telephone: "phone",
  company: "company", companyname: "company", organization: "company", organisation: "company", account: "company", business: "company",
  city: "city", town: "city",
  state: "state", province: "state", region: "state",
  zip: "zip", zipcode: "zip", postalcode: "zip", postcode: "zip",
  persona: "persona", segment: "persona", personakey: "persona",
  // When someone was last contacted is the single most valuable column in a
  // typical CRM export: without it every imported lead is "received" today, so
  // cold-lead detection can't fire for 30 days and a new workspace sees an empty
  // Opportunities screen right after being told to import records.
  lastcontacted: "lastContactedAt", lastcontact: "lastContactedAt", lastcontacteddate: "lastContactedAt",
  lastactivity: "lastContactedAt", lastactivitydate: "lastContactedAt", lasttouched: "lastContactedAt",
  lastemailed: "lastContactedAt", lastinteraction: "lastContactedAt", lastengaged: "lastContactedAt",
  lastseen: "lastContactedAt", lastcontactedon: "lastContactedAt",
};

/**
 * Parse a spreadsheet date to an ISO timestamp — conservatively.
 *
 * A wrong date here is worse than none: it manufactures false urgency ("quiet
 * 200 days") on a lead someone spoke to last week, and that lands in an
 * evidence-cited opportunity card the operator is meant to trust. So only
 * unambiguous forms are accepted, and anything in the future or absurdly old is
 * dropped rather than guessed at.
 *
 * Accepts ISO (2026-01-15, with or without a time) and US M/D/YYYY, which is
 * what HubSpot, Salesforce and Excel exports emit. Ambiguous 2-digit years and
 * D/M/Y are deliberately NOT guessed.
 */
export function parseCsvDate(value: string | undefined, now = new Date()): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  let parsed: Date | null = null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(raw);
  if (iso) {
    parsed = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`);
  } else {
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
    if (us) {
      const [, m, d, y] = us;
      // Reject a "month" over 12 rather than silently reading it as D/M/Y — a
      // file in that format would misdate every row, so no date beats wrong ones.
      if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
        parsed = new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00.000Z`);
      }
    }
  }

  if (!parsed || Number.isNaN(parsed.getTime())) return undefined;
  // A future date can't be a last contact, and a pre-2000 one is almost always a
  // parsing artefact (Excel serial numbers, empty-cell placeholders).
  if (parsed.getTime() > now.getTime()) return undefined;
  if (parsed.getUTCFullYear() < 2000) return undefined;
  return parsed.toISOString();
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Map of column index → the field it feeds, auto-detected from the header row. */
export type ColumnMapping = Record<number, CsvField>;

export function detectColumnMapping(header: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<CsvField>();
  header.forEach((h, i) => {
    const field = HEADER_ALIASES[normalizeHeader(h)];
    // First column wins a field, so a later "email2" can't clobber "email".
    if (field && !used.has(field)) { mapping[i] = field; used.add(field); }
  });
  return mapping;
}

export type CsvContactRow = { firstName?: string; lastName?: string; email?: string; phone?: string; company?: string; city?: string; state?: string; zip?: string; persona?: string; lastContactedAt?: string };

const cell = (row: string[], i: number): string | undefined => {
  const v = row[i]?.trim();
  return v ? v : undefined;
};

/** Apply the column mapping to one data row → a flat contact record. */
export function mapCsvRow(row: string[], mapping: ColumnMapping): CsvContactRow {
  const out: CsvContactRow = {};
  for (const [idxStr, field] of Object.entries(mapping)) {
    const value = cell(row, Number(idxStr));
    if (!value) continue;
    if (field === "name") {
      // Split a full-name column only if first/last weren't mapped separately.
      const [first, ...rest] = value.split(/\s+/);
      if (!out.firstName) out.firstName = first;
      if (!out.lastName && rest.length) out.lastName = rest.join(" ");
    } else {
      (out as Record<string, string>)[field] = value;
    }
  }
  return out;
}

// --- Row -> engine contact ---------------------------------------------------

/** A stable dedup id for a row: prefer email, then phone, else a content hash — so
 *  re-importing the same CSV updates the lead instead of duplicating it. Namespaced
 *  `csv:` so it can never collide with a HubSpot object id. */
export function csvRowId(c: CsvContactRow): string {
  const key =
    c.email?.toLowerCase() ??
    c.phone?.replace(/[^0-9+]/g, "") ??
    // content hash: last resort when there's no natural key (name-only rows)
    `h${hashString([c.firstName, c.lastName, c.company].filter(Boolean).join("|").toLowerCase())}`;
  return `csv:${key}`;
}

function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** True when a row has at least one field that makes it a real contact. */
export function rowHasContact(c: CsvContactRow): boolean {
  return Boolean(c.firstName || c.lastName || c.email || c.phone);
}

/**
 * Turn a mapped row into the engine's contact shape. `properties` uses the exact
 * keys mapHubspotContactToLead reads (firstname/lastname/email/phone/company/city/
 * state/zip), plus the persona column under a stable key the caller wires to
 * `personaProperty`. Returns null for a row with no usable contact field.
 */
export function csvRowToContact(c: CsvContactRow): HubspotContact | null {
  if (!rowHasContact(c)) return null;
  const properties: Record<string, unknown> = {};
  if (c.firstName) properties.firstname = c.firstName;
  if (c.lastName) properties.lastname = c.lastName;
  if (c.email) properties.email = c.email;
  if (c.phone) properties.phone = c.phone;
  if (c.company) properties.company = c.company;
  if (c.city) properties.city = c.city;
  if (c.state) properties.state = c.state;
  if (c.zip) properties.zip = c.zip;
  if (c.persona) properties.persona = c.persona;
  // Rides on `updatedAt`, which the import run threads to the lead's received_at
  // so the lead arrives with its real recency instead of today's date.
  const lastContactedAt = parseCsvDate(c.lastContactedAt);
  return { id: csvRowId(c), properties, ...(lastContactedAt ? { updatedAt: lastContactedAt } : {}) };
}

export type CsvParseSummary = {
  contacts: HubspotContact[];
  /** Header names the mapper recognised, for the operator to sanity-check. */
  mappedColumns: Partial<Record<CsvField, string>>;
  totalRows: number;
  /** Rows dropped for having no name/email/phone. */
  skipped: number;
  /** Every header in the file, in order — including the ones nothing matched. */
  headers: string[];
  /**
   * Headers the detector did not recognise. These are silently dropped today
   * (BSR-645 turns them into custom fields); listing them is the difference
   * between the operator choosing to drop a column and never learning it existed.
   */
  unmappedColumns: string[];
};

/**
 * An operator's corrections to the detected mapping: header name → field, or
 * `null` to drop a column the detector claimed. Auto-detection is a first guess;
 * without a way to override it, a column named something unusual is dropped with
 * no way to say otherwise.
 */
export type CsvColumnOverrides = Record<string, CsvField | null>;

/** The persona column key contacts carry, wired to the engine's personaProperty. */
export const CSV_PERSONA_PROPERTY = "persona";

/**
 * Parse a whole CSV into engine contacts. First non-empty row is the header. Reports
 * which columns it recognised and how many rows it dropped, so the import UI can show
 * the operator what it understood before anything is written.
 */
export function parseCsvContacts(text: string, overrides?: CsvColumnOverrides): CsvParseSummary {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return { contacts: [], mappedColumns: {}, totalRows: 0, skipped: 0, headers: [], unmappedColumns: [] };
  }
  const [header, ...dataRows] = rows;
  const mapping = detectColumnMapping(header);

  // Apply the operator's corrections on top of detection, by header NAME rather
  // than index — the UI shows names, and an index would silently mis-target the
  // moment the same file is re-uploaded with a column reordered.
  if (overrides) {
    for (const [name, field] of Object.entries(overrides)) {
      const index = header.findIndex((h) => h.trim() === name.trim());
      if (index < 0) continue;
      if (field === null) {
        delete mapping[index];
        continue;
      }
      // An explicit choice is authoritative: release the field from any OTHER
      // column detection had claimed it for. Without this, mapping "Notes" to
      // company while "Account" is also detected as company leaves two columns
      // fighting over one field, and which one wins depends on their order in the
      // file — so the same override would behave differently on a re-export.
      for (const [otherIndex, otherField] of Object.entries(mapping)) {
        if (otherField === field && Number(otherIndex) !== index) delete mapping[Number(otherIndex)];
      }
      mapping[index] = field;
    }
  }

  const mappedColumns: Partial<Record<CsvField, string>> = {};
  for (const [idxStr, field] of Object.entries(mapping)) mappedColumns[field] = header[Number(idxStr)];
  const unmappedColumns = header.filter((_, index) => !(index in mapping)).map((h) => h.trim()).filter(Boolean);

  const contacts: HubspotContact[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const row of dataRows) {
    const contact = csvRowToContact(mapCsvRow(row, mapping));
    if (!contact) { skipped++; continue; }
    if (seen.has(contact.id)) continue; // in-file dedup (same email twice in one paste)
    seen.add(contact.id);
    contacts.push(contact);
  }
  return {
    contacts,
    mappedColumns,
    totalRows: dataRows.length,
    skipped,
    headers: header.map((h) => h.trim()),
    unmappedColumns,
  };
}

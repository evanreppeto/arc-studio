import { type CsvColumnOverrides, type CsvField } from "./csv-import";

/**
 * Per-source column presets (BSR-646).
 *
 * The mapping step is the friction point in any import, and it is avoidable
 * friction for the handful of systems people actually leave. We know what a
 * HubSpot contacts export calls its columns; the user should not have to tell us.
 *
 * A preset is DATA, not code: a source key and a header → field map. Adding a
 * source is an entry here plus a fixture test, never a new code path.
 *
 * Presets EXTEND the generic aliases in `csv-import.ts` rather than replacing
 * them. Detection still runs first; a preset only supplies the columns the
 * generic aliases could not place, or corrects one they placed differently. So a
 * source we have never seen still imports, and a preset that is slightly wrong
 * degrades to the generic behaviour rather than to nothing.
 *
 * ⚠️ HEADER ACCURACY. The signatures below are the best-known column names for
 * each product, not headers copied from a verified export of every one. They are
 * good enough to be useful and are all safety-netted by the two rules above, but
 * the fixtures should be replaced with real exported header rows as they become
 * available — a preset that silently mis-maps is worse than no preset, and only a
 * real file proves it does not.
 */

export type ImportPresetKey =
  | "generic"
  | "hubspot"
  | "salesforce"
  | "pipedrive"
  | "jobber"
  | "google_contacts";

export type ImportPreset = {
  key: ImportPresetKey;
  label: string;
  /** Headers that, taken together, identify this source. Used only to SUGGEST. */
  signature: string[];
  /** Header (as exported) → the field it maps to. */
  columns: Record<string, CsvField>;
};

/** Normalized comparison: lowercase, non-alphanumerics stripped. */
function norm(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const IMPORT_PRESETS: ImportPreset[] = [
  {
    key: "hubspot",
    label: "HubSpot",
    signature: ["Record ID", "Associated Company"],
    columns: {
      "First Name": "firstName",
      "Last Name": "lastName",
      "Email": "email",
      "Phone Number": "phone",
      "Company Name": "company",
      "Associated Company": "company",
      "City": "city",
      "State/Region": "state",
      "Postal Code": "zip",
      "Last Activity Date": "lastContactedAt",
    },
  },
  {
    key: "salesforce",
    label: "Salesforce",
    signature: ["Account Name", "Mailing City"],
    columns: {
      "First Name": "firstName",
      "Last Name": "lastName",
      "Email": "email",
      "Phone": "phone",
      "Account Name": "company",
      "Mailing City": "city",
      "Mailing State/Province": "state",
      "Mailing Zip/Postal Code": "zip",
      "Last Activity": "lastContactedAt",
    },
  },
  {
    key: "pipedrive",
    label: "Pipedrive",
    // Pipedrive prefixes every column with its object, which is a strong signal.
    signature: ["Person - Name", "Organization - Name"],
    columns: {
      "Person - Name": "name",
      "Person - Email": "email",
      "Person - Phone": "phone",
      "Organization - Name": "company",
      "Person - Last activity date": "lastContactedAt",
    },
  },
  {
    key: "jobber",
    label: "Jobber",
    signature: ["Client Name", "Company Name"],
    columns: {
      "First Name": "firstName",
      "Last Name": "lastName",
      "Client Name": "name",
      "Email": "email",
      "Phone Number": "phone",
      "Company Name": "company",
      "City": "city",
      "State": "state",
      "Zip": "zip",
    },
  },
  {
    key: "google_contacts",
    label: "Google Contacts",
    // The "no CRM at all" case, which is a large share of the ICP.
    signature: ["E-mail 1 - Value", "Given Name"],
    columns: {
      "Given Name": "firstName",
      "Family Name": "lastName",
      "First Name": "firstName",
      "Last Name": "lastName",
      "E-mail 1 - Value": "email",
      "Phone 1 - Value": "phone",
      "Organization Name": "company",
      "Organization 1 - Name": "company",
    },
  },
];

export function presetFor(key: ImportPresetKey | undefined): ImportPreset | null {
  if (!key || key === "generic") return null;
  return IMPORT_PRESETS.find((p) => p.key === key) ?? null;
}

/**
 * Best guess at which product produced this file, from its header row.
 *
 * A SUGGESTION only — the caller confirms. Silently applying a guessed preset is
 * how a file gets mis-mapped with nobody able to see why, which is exactly the
 * failure the mapping step exists to prevent.
 *
 * Requires every header in a signature to be present, so a single coincidental
 * column name cannot claim a file.
 */
export function detectPreset(headers: string[]): ImportPresetKey | null {
  const present = new Set(headers.map(norm));
  for (const preset of IMPORT_PRESETS) {
    if (preset.signature.every((h) => present.has(norm(h)))) return preset.key;
  }
  return null;
}

/**
 * The preset's mapping as column overrides, for the headers this file actually
 * has.
 *
 * Returned as overrides rather than applied directly so a preset flows through
 * exactly the same path as an operator's manual correction — including the rule
 * that an explicit mapping releases the field from whichever column detection had
 * claimed it. One precedence rule, not two.
 */
export function presetOverrides(key: ImportPresetKey | undefined, headers: string[]): CsvColumnOverrides {
  const preset = presetFor(key);
  if (!preset) return {};

  const byNorm = new Map(Object.entries(preset.columns).map(([header, field]) => [norm(header), field]));
  const overrides: CsvColumnOverrides = {};
  for (const header of headers) {
    const field = byNorm.get(norm(header));
    if (field) overrides[header] = field;
  }
  return overrides;
}

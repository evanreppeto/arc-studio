import { type CsvField, type InferredField } from "@/domain";
import { type ImportSampleRecord } from "@/lib/integrations/crm/import-run";

/** What the preview step renders. Mirrors the engine's dry-run result. */
export type ImportPreview = {
  willCreate: number;
  willUpdate: number;
  willSkip: number;
  totalRows: number;
  mappedColumns: Partial<Record<CsvField, string>>;
  /** Headers nothing matched — dropped today, custom fields in BSR-645. */
  unmappedColumns: string[];
  headers: string[];
  sample: ImportSampleRecord[];
  /**
   * Unmapped columns with a suggested field type (BSR-645). Offering them is what
   * turns "dropped silently" into a choice the operator made.
   */
  suggestedFields: InferredField[];
};

/** The fields an operator can map a column onto, with what each one is for. */
export const MAPPABLE_FIELDS: Array<{ field: CsvField; label: string; hint?: string }> = [
  { field: "name", label: "Full name" },
  { field: "firstName", label: "First name" },
  { field: "lastName", label: "Last name" },
  { field: "email", label: "Email" },
  { field: "phone", label: "Phone" },
  { field: "company", label: "Company" },
  { field: "city", label: "City" },
  { field: "state", label: "State" },
  { field: "zip", label: "ZIP" },
  { field: "persona", label: "Persona", hint: "Overrides the default per row" },
  {
    field: "lastContactedAt",
    label: "Last contacted",
    hint: "Without it every lead lands as new and nothing looks cold for 30 days",
  },
];

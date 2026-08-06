import { z } from "zod";

export const OUTCOME_STATUSES = ["pending", "won", "lost", "paid", "written_off"] as const;
export const OutcomeStatusSchema = z.enum(OUTCOME_STATUSES);
export type OutcomeStatus = z.infer<typeof OutcomeStatusSchema>;

export const OutcomeRowSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid().nullable(),
  lead_id: z.string().uuid().nullable(),
  company_id: z.string().uuid().nullable(),
  contact_id: z.string().uuid().nullable(),
  property_id: z.string().uuid().nullable(),
  // Non-empty string, not z.enum of the twelve OFFICIAL_PERSONA_MAPPINGS: personas
  // have been per-org since migration 20260713120000, and this column is `text`,
  // not the persona_mapping enum. Enumerating BSR's twelve here meant a tenant's
  // OWN persona threw on read: every row-returning read 502'd while count-only
  // reads passed, because nothing was parsed. Same fix as LeadRowSchema.
  persona: z.string().trim().min(1),
  status: OutcomeStatusSchema,
  gross_revenue_cents: z.number().int().nullable(),
  gross_margin_cents: z.number().int().nullable(),
  closed_at: z.string().datetime({ offset: true }).nullable(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const OutcomeSchema = OutcomeRowSchema.transform((row) => ({
  id: row.id,
  jobId: row.job_id,
  leadId: row.lead_id,
  companyId: row.company_id,
  contactId: row.contact_id,
  propertyId: row.property_id,
  persona: row.persona,
  status: row.status,
  grossRevenueCents: row.gross_revenue_cents,
  grossMarginCents: row.gross_margin_cents,
  closedAt: row.closed_at,
  metadata: row.metadata,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
}));

export type OutcomeRow = z.infer<typeof OutcomeRowSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;

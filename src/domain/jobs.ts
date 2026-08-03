import { z } from "zod";

export const JOB_STATUSES = ["pending", "scheduled", "in_progress", "completed", "canceled"] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobRowSchema = z.object({
  id: z.string().uuid(),
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
  status: JobStatusSchema,
  job_number: z.string().nullable(),
  scheduled_at: z.string().datetime({ offset: true }).nullable(),
  completed_at: z.string().datetime({ offset: true }).nullable(),
  estimated_revenue_cents: z.number().int().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const JobSchema = JobRowSchema.transform((row) => ({
  id: row.id,
  leadId: row.lead_id,
  companyId: row.company_id,
  contactId: row.contact_id,
  propertyId: row.property_id,
  persona: row.persona,
  status: row.status,
  jobNumber: row.job_number,
  scheduledAt: row.scheduled_at,
  completedAt: row.completed_at,
  estimatedRevenueCents: row.estimated_revenue_cents,
  metadata: row.metadata,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
}));

export type JobRow = z.infer<typeof JobRowSchema>;
export type Job = z.infer<typeof JobSchema>;

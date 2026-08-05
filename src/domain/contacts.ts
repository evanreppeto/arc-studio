import { z } from "zod";

export const CONTACT_STATUSES = ["active", "inactive", "do_not_contact", "archived"] as const;
export const ContactStatusSchema = z.enum(CONTACT_STATUSES);
export type ContactStatus = z.infer<typeof ContactStatusSchema>;

export const ContactRowSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid().nullable(),
  // Non-empty string, not z.enum of the twelve OFFICIAL_PERSONA_MAPPINGS: personas
  // have been per-org since migration 20260713120000, and this column is `text`,
  // not the persona_mapping enum. Enumerating BSR's twelve here meant a tenant's
  // OWN persona threw on read: every row-returning read 502'd while count-only
  // reads passed, because nothing was parsed. Same fix as LeadRowSchema.
  persona: z.string().trim().min(1),
  status: ContactStatusSchema,
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  full_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  title: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  // Optional so callers that select a narrower projection still parse. It is
  // carried on the parsed Contact because the audience resolver filters on it —
  // the schema dropping this column is what let unsubscribed contacts through
  // every preview and every external-send export (BSR-482).
  email_unsubscribed_at: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const ContactSchema = ContactRowSchema.transform((row) => ({
  id: row.id,
  companyId: row.company_id,
  persona: row.persona,
  status: row.status,
  firstName: row.first_name,
  lastName: row.last_name,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
  title: row.title,
  metadata: row.metadata,
  emailUnsubscribedAt: row.email_unsubscribed_at ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
}));

export type ContactRow = z.infer<typeof ContactRowSchema>;
export type Contact = z.infer<typeof ContactSchema>;

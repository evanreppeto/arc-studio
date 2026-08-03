import { z } from "zod";

export const PropertyRowSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid().nullable(),
  contact_id: z.string().uuid().nullable(),
  // Non-empty string, not z.enum of the twelve OFFICIAL_PERSONA_MAPPINGS: personas
  // have been per-org since migration 20260713120000, and this column is `text`,
  // not the persona_mapping enum. Enumerating BSR's twelve here meant a tenant's
  // OWN persona threw on read: every row-returning read 502'd while count-only
  // reads passed, because nothing was parsed. Same fix as LeadRowSchema.
  persona: z.string().trim().min(1),
  street_line_1: z.string(),
  street_line_2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  postal_code: z.string(),
  property_type: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const PropertySchema = PropertyRowSchema.transform((row) => ({
  id: row.id,
  companyId: row.company_id,
  contactId: row.contact_id,
  persona: row.persona,
  streetLine1: row.street_line_1,
  streetLine2: row.street_line_2,
  city: row.city,
  state: row.state,
  postalCode: row.postal_code,
  propertyType: row.property_type,
  metadata: row.metadata,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
}));

export type PropertyRow = z.infer<typeof PropertyRowSchema>;
export type Property = z.infer<typeof PropertySchema>;

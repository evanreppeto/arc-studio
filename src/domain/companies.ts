import { z } from "zod";

export const COMPANY_STATUSES = ["active", "inactive", "archived"] as const;
export const CompanyStatusSchema = z.enum(COMPANY_STATUSES);
export type CompanyStatus = z.infer<typeof CompanyStatusSchema>;

export const CompanyRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  // Non-empty string, not z.enum of the twelve OFFICIAL_PERSONA_MAPPINGS: personas
  // have been per-org since migration 20260713120000, and this column is `text`,
  // not the persona_mapping enum. Enumerating BSR's twelve here meant a tenant's
  // OWN persona threw on read: every row-returning read 502'd while count-only
  // reads passed, because nothing was parsed. Same fix as LeadRowSchema.
  persona: z.string().trim().min(1),
  status: CompanyStatusSchema,
  website_url: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  partner_tier: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const CompanySchema = CompanyRowSchema.transform((row) => ({
  id: row.id,
  name: row.name,
  persona: row.persona,
  status: row.status,
  websiteUrl: row.website_url,
  phone: row.phone,
  email: row.email,
  partnerTier: row.partner_tier,
  metadata: row.metadata,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
}));

export type CompanyRow = z.infer<typeof CompanyRowSchema>;
export type Company = z.infer<typeof CompanySchema>;

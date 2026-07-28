import { z } from "zod";

const optionalText = z.string().trim().min(1).optional();

export const arcPartnerCampaignRequestSchema = z.object({
  workflow: z.literal("partner_campaign").default("partner_campaign"),
  objective: z
    .string()
    .trim()
    .min(1)
    .default("Create a referral partner campaign draft and submit it for human approval."),
  // Persona is free text at the schema layer so any workspace's own taxonomy is
  // accepted; the /api/v1/arc/runs route validates it against the org's active
  // personas (getOrgPersonaKeys) and 400s an unknown one. The BSR default is kept
  // for back-compat — a non-BSR caller passes its own persona key.
  persona: z.string().trim().min(1).default("persona_plumbing_partner"),
  channel: z.enum(["email", "sms", "call_script", "one_pager"]).default("email"),
  /** Industry-neutral campaign theme (what the campaign is about) — free text. */
  campaignTheme: optionalText,
  /** Legacy restoration focus. No longer enum-constrained, and deliberately has
   *  NO default: it used to default to "water_backup", which silently stamped a
   *  restoration term onto every campaign run by a law firm, dental practice, or
   *  agency that never mentioned water. Omitting it now yields a neutral theme
   *  instead of a wrong one. It still seeds `campaignTheme` when supplied. */
  restorationFocus: optionalText,
  company: z
    .object({
      name: z.string().trim().min(1).default("Arc Plumbing Partner"),
      websiteUrl: optionalText,
      phone: optionalText,
      email: z.string().trim().email().optional(),
      partnerTier: z.enum(["A", "B", "C"]).default("A"),
      serviceAreaZips: z.array(z.string().trim().min(1)).default(["60618", "60625", "60647"]),
    })
    .default({
      name: "Arc Plumbing Partner",
      partnerTier: "A",
      serviceAreaZips: ["60618", "60625", "60647"],
    }),
  contact: z
    .object({
      firstName: z.string().trim().min(1).default("Jordan"),
      lastName: z.string().trim().min(1).default("Partner"),
      title: z.string().trim().min(1).default("Operations Manager"),
      email: z.string().trim().email().optional(),
      phone: optionalText,
    })
    .default({
      firstName: "Jordan",
      lastName: "Partner",
      title: "Operations Manager",
    }),
  lead: z
    .object({
      source: z.string().trim().min(1).default("arc_agent"),
      lossSummary: z
        .string()
        .trim()
        .min(1)
        .default("Partner candidate has source-stop water-loss referral potential in priority Chicago ZIPs."),
      lossSignals: z.array(z.string().trim().min(1)).default(["water_backup", "burst_pipe", "emergency_service"]),
      matchedTargetKeywords: z.array(z.string().trim().min(1)).default(["plumber", "water damage", "emergency repair"]),
      evidenceUrls: z.array(z.string().trim().url()).default(["https://example-plumbing.local"]),
      leadScore: z.number().int().min(0).max(100).default(88),
      partnerScore: z.number().int().min(0).max(100).default(80),
    })
    .default({
      source: "arc_agent",
      lossSummary: "Partner candidate has source-stop water-loss referral potential in priority Chicago ZIPs.",
      lossSignals: ["water_backup", "burst_pipe", "emergency_service"],
      matchedTargetKeywords: ["plumber", "water damage", "emergency repair"],
      evidenceUrls: ["https://example-plumbing.local"],
      leadScore: 88,
      partnerScore: 80,
    }),
  campaign: z
    .object({
      name: optionalText,
      audienceSummary: optionalText,
      offerSummary: optionalText,
      cta: z.string().trim().min(1).default("Set up a simple referral handoff process"),
      tone: z.string().trim().min(1).default("professional, direct, partner-protective"),
    })
    .default({
      cta: "Set up a simple referral handoff process",
      tone: "professional, direct, partner-protective",
    }),
  creativeAssets: z
    .array(
      z.object({
        type: z.enum(["image", "video", "ad", "postcard", "file", "link"]).default("image"),
        url: z.string().trim().url(),
        title: optionalText,
        description: optionalText,
        thumbnailUrl: z.string().trim().url().optional(),
      }),
    )
    .default([]),
  operator: z.string().trim().min(1).default("Arc Agent"),
});

export type ArcPartnerCampaignRequest = z.output<typeof arcPartnerCampaignRequestSchema>;
export type ArcPartnerCampaignRequestInput = z.input<typeof arcPartnerCampaignRequestSchema>;

export function parseArcPartnerCampaignRequest(input: unknown): ArcPartnerCampaignRequest {
  return arcPartnerCampaignRequestSchema.parse(input ?? {});
}

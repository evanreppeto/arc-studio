import { z } from "zod";

import { resolveAttribution, type ResolvedAttribution } from "./attribution";
import { classifyLossSignals } from "./loss-classification";
import { OFFICIAL_PERSONA_MAPPINGS, validateLeadIngestionPersona } from "./personas";
import { calculateScores } from "./scoring";

const stringField = z.string().trim().min(1);

const attributionInputSchema = z.object({
  campaignId: z.string().trim().optional(),
  campaignAssetId: z.string().trim().optional(),
  channel: z.string().trim().optional(),
  token: z.string().trim().optional(),
  utmSource: z.string().trim().optional(),
  utmMedium: z.string().trim().optional(),
  utmCampaign: z.string().trim().optional(),
});

const contactSchema = z
  .object({
    firstName: z.string().trim().optional(),
    lastName: z.string().trim().optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().optional(),
  })
  .refine(
    (contact) => Boolean(contact.firstName || contact.lastName || contact.email || contact.phone),
    {
      message: "Contact must include a name, email, or phone.",
    },
  );

export const leadIngestionSchema = z.object({
  persona: z.unknown(),
  source: stringField,
  externalLeadId: z.string().trim().min(1).optional(),
  /**
   * When this lead was actually last touched, for imports carrying history.
   * Absent means "now" (the leads.received_at column default), which is right
   * for a genuinely new lead and wrong for an imported one — without it every
   * imported lead reads as zero days old and cold-lead detection can't fire for
   * 30 days. Optional so no existing caller or response code changes.
   */
  receivedAt: z.string().trim().datetime().optional(),
  company: z
    .object({
      name: stringField,
      partnerTier: z.enum(["A", "B", "C"]).optional(),
      networkConnection: z.enum(["warm_intro", "cold_outreach"]).optional(),
    })
    .optional(),
  contact: contactSchema.optional(),
  property: z
    .object({
      streetLine1: stringField,
      streetLine2: z.string().trim().optional(),
      city: stringField,
      state: z.string().trim().length(2),
      postalCode: stringField,
    })
    .optional(),
  // Best-effort capture of a PARTIAL address (e.g. Arc found a prospect's city +
  // state but no street/ZIP). A `property` row requires all four address fields
  // (NOT NULL in the DB), so a partial address can't become one — it would be
  // dropped. Instead it rides along here and persists as location metadata on the
  // company/lead. Every field is optional; a malformed/empty block coerces to
  // undefined (.catch) so it can never reject an otherwise valid lead.
  location: z
    .object({
      streetLine1: z.string().trim().min(1).optional(),
      streetLine2: z.string().trim().min(1).optional(),
      city: z.string().trim().min(1).optional(),
      state: z.string().trim().min(1).optional(),
      postalCode: z.string().trim().min(1).optional(),
    })
    .refine(
      (loc) =>
        Boolean(
          loc.streetLine1 || loc.streetLine2 || loc.city || loc.state || loc.postalCode,
        ),
      { message: "Location must include at least one address field." },
    )
    .optional()
    .catch(undefined),
  lossSummary: z.string().trim().optional(),
  // Optional, defaulting to the empty array the DB column itself defaults to.
  // Inbound damage leads carry loss signals; Arc's prospecting/partner leads
  // (plumbers, insurers to recruit) have no loss event, so they supply none and
  // route to needs_review via the "unknown" classification.
  lossSignals: z.array(z.string().trim().min(1)).default([]),
  metadata: z
    .object({
      after_hours_call: z.boolean().optional(),
      photo_uploaded: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
  // Best-effort: a malformed attribution block coerces to undefined (.catch) so it
  // can never reject a lead. Resolution happens after parse.
  attribution: attributionInputSchema.optional().catch(undefined),
}).refine((lead) => Boolean(lead.company || lead.contact || lead.property), {
  message: "Lead must include at least one company, contact, or property relationship.",
  path: ["relationship"],
});

export type LeadIngestionInput = z.input<typeof leadIngestionSchema>;
export type ParsedLeadIngestionInput = z.output<typeof leadIngestionSchema>;

export type LeadIngestionResult =
  | {
      ok: true;
      status: "accepted";
      routing: "elevated" | "target" | "needs_review" | "archived";
      persona: string;
      classification: ReturnType<typeof classifyLossSignals>;
      scores: ReturnType<typeof calculateScores>;
      normalizedInput: ParsedLeadIngestionInput;
      attribution: ResolvedAttribution;
    }
  | {
      ok: false;
      status: "rejected";
      httpStatus: 400;
      errors: Array<{
        code: string;
        message: string;
        path?: string[];
      }>;
    };

export function parseLeadIngestionPayload(
  payload: unknown,
  calculatedAt?: Date | string,
  allowedPersonaKeys: readonly string[] = OFFICIAL_PERSONA_MAPPINGS,
  /**
   * Operator-declared `source` → campaign-uuid map, for leads that arrive with a
   * source but no utm/token to attribute them by (a phone-in logged as "Google
   * Ads", a partner referral). Supplied by the caller because the rules are
   * per-org data and this module is pure.
   *
   * Empty by default, and that default was the bug: `resolveAttribution` has
   * always taken this map and nothing has ever passed one, so its `source_rule`
   * branch was unreachable in production — tested, correct, and dead. Every lead
   * with a source and no utm resolved `unattributed`, which is why the journey
   * lens picker has nothing to divide.
   *
   * It is a MAP, not an inference: `source` is uncontrolled free text (prod holds
   * "Google Ads" next to "arc_demo" and "Storm canvassing"), so deriving a channel
   * from it directly would manufacture attribution that no touch recorded. A human
   * says which source means which campaign, and resolveAttribution still discards
   * any value that isn't a uuid.
   */
  sourceRules: Record<string, string> = {},
): LeadIngestionResult {
  const parsed = leadIngestionSchema.safeParse(payload);

  if (!parsed.success) {
    return {
      ok: false,
      status: "rejected",
      httpStatus: 400,
      errors: parsed.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.map(String),
      })),
    };
  }

  const persona = validateLeadIngestionPersona(parsed.data.persona, allowedPersonaKeys);

  if (!persona.ok) {
    return {
      ok: false,
      status: "rejected",
      httpStatus: 400,
      errors: [
        {
          code: persona.code,
          message: persona.message,
          path: ["persona"],
        },
      ],
    };
  }

  const classification = classifyLossSignals([
    parsed.data.lossSummary ?? "",
    ...parsed.data.lossSignals,
  ]);
  const scores = calculateScores({
    lead: {
      standingWater: classification.matchedTargetKeywords.includes("standing water"),
      photoUploaded: parsed.data.metadata?.photo_uploaded,
      afterHoursCall: parsed.data.metadata?.after_hours_call,
    },
    partner: {
      tier: parsed.data.company?.partnerTier,
      relationshipSignal: parsed.data.company?.networkConnection,
    },
    calculatedAt,
  });

  const attribution = resolveAttribution(
    {
      ...(parsed.data.attribution ?? {}),
      source: parsed.data.source,
    },
    sourceRules,
  );

  return {
    ok: true,
    status: "accepted",
    routing: mapRouting(classification.routingRecommendation),
    persona: persona.persona,
    classification,
    scores,
    normalizedInput: parsed.data,
    attribution,
  };
}

function mapRouting(
  recommendation: ReturnType<typeof classifyLossSignals>["routingRecommendation"],
): LeadIngestionResult extends infer TResult
  ? TResult extends { ok: true; routing: infer TRouting }
    ? TRouting
    : never
  : never {
  if (recommendation === "elevate") {
    return "elevated";
  }

  if (recommendation === "archive_low_priority") {
    return "archived";
  }

  return "needs_review";
}

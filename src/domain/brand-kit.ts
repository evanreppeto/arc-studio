/**
 * Brand Kit — pure, industry-agnostic business-identity logic. No I/O.
 * Persistence lives in `src/lib/brand-kit/`. This module owns the shape of a
 * business profile, the neutral defaults a brand-new org starts from, the
 * quick-start industry templates, and the assembly of the Arc context bundle.
 */

export type DensityOption = "comfortable" | "compact";
export type MotionOption = "standard" | "reduced";
export type ProfileStatus = "draft" | "active";

export type BrandColor = { label: string; hex: string };
export type BrandPalette = {
  primary: BrandColor;
  secondary: BrandColor;
  accent: BrandColor;
  dark: BrandColor;
  light: BrandColor;
  headingFont: string;
  bodyFont: string;
};

export type ProofPoint = {
  kind: "testimonial" | "certification" | "stat";
  label: string;
  detail?: string;
};

export type BrandKitGuardrails = {
  /** Human-readable labels of claim types the business must not make. */
  disallowedClaims: string[];
  /** Free-form compliance guidance shown to Arc and reviewers. */
  complianceNotes: string;
};

export type PersonaDefinition = {
  key: string;
  label: string;
  audienceType: string;
  sortOrder: number;
  isActive: boolean;
  metadata: {
    description?: string;
    recommendedCta?: string;
    messageAngle?: string;
    proofPoints?: string[];
  };
};

export type BusinessProfile = {
  displayName: string;
  legalName: string | null;
  tagline: string | null;
  description: string | null;
  industry: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  shortMark: string | null;
  serviceAreas: string[];
  timeZone: string | null;
  accent: string;
  density: DensityOption;
  motion: MotionOption;
  tone: string;
  voiceGuidance: string | null;
  preferredPhrases: string[];
  bannedPhrases: string[];
  services: string[];
  proofPoints: ProofPoint[];
  guardrails: BrandKitGuardrails;
  brandPalette: BrandPalette;
  status: ProfileStatus;
};

const EMPTY_COLOR: BrandColor = { label: "", hex: "" };
export const EMPTY_BRAND_PALETTE: BrandPalette = {
  primary: { ...EMPTY_COLOR }, secondary: { ...EMPTY_COLOR }, accent: { ...EMPTY_COLOR },
  dark: { ...EMPTY_COLOR }, light: { ...EMPTY_COLOR }, headingFont: "", bodyFont: "",
};

export const NEUTRAL_PERSONAS: PersonaDefinition[] = [
  {
    key: "decision_maker",
    label: "Decision maker",
    audienceType: "customer",
    sortOrder: 0,
    isActive: true,
    metadata: { description: "The person who chooses and pays for the service." },
  },
  {
    key: "referrer",
    label: "Referrer",
    audienceType: "partner",
    sortOrder: 1,
    isActive: true,
    metadata: { description: "Someone positioned to refer business your way." },
  },
  {
    key: "repeat_customer",
    label: "Repeat customer",
    audienceType: "customer",
    sortOrder: 2,
    isActive: true,
    metadata: { description: "An existing customer who may buy again." },
  },
];

export const NEUTRAL_DEFAULTS: BusinessProfile = {
  displayName: "",
  legalName: null,
  tagline: null,
  description: null,
  industry: null,
  websiteUrl: null,
  logoUrl: null,
  faviconUrl: null,
  shortMark: null,
  serviceAreas: [],
  timeZone: null,
  accent: "#C8A24B",
  density: "comfortable",
  motion: "standard",
  tone: "balanced",
  voiceGuidance: null,
  preferredPhrases: [],
  bannedPhrases: [],
  services: [],
  proofPoints: [],
  guardrails: {
    disallowedClaims: [
      "False or unverifiable claims",
      "Misleading pricing or fake urgency",
      "Guarantees of outcomes outside the business's control",
    ],
    complianceNotes:
      "Keep claims truthful and substantiated. Avoid promises the business cannot guarantee.",
  },
  brandPalette: EMPTY_BRAND_PALETTE,
  status: "draft",
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asColor(value: unknown): BrandColor {
  const v = (value ?? {}) as Record<string, unknown>;
  return { label: asString(v.label, ""), hex: asString(v.hex, "") };
}

/** Map a raw brand_palette jsonb blob into a BrandPalette, tolerating missing keys. */
export function parseBrandPalette(value: unknown): BrandPalette {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    primary: asColor(raw.primary), secondary: asColor(raw.secondary), accent: asColor(raw.accent),
    dark: asColor(raw.dark), light: asColor(raw.light),
    headingFont: asString(raw.headingFont, ""), bodyFont: asString(raw.bodyFont, ""),
  };
}

function asProofPoints(value: unknown): ProofPoint[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is ProofPoint =>
      v != null &&
      typeof v === "object" &&
      typeof (v as ProofPoint).kind === "string" &&
      typeof (v as ProofPoint).label === "string",
  );
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Map a raw `business_profiles` row (snake_case, jsonb) into a BusinessProfile. */
export function parseBusinessProfile(row: Record<string, unknown>): BusinessProfile {
  const guardrailsRaw = (row.guardrails ?? {}) as Record<string, unknown>;
  const density = row.density === "compact" ? "compact" : "comfortable";
  const motion = row.motion === "reduced" ? "reduced" : "standard";
  const status = row.status === "active" ? "active" : "draft";
  const disallowedClaims = asStringArray(guardrailsRaw.disallowedClaims);
  return {
    displayName: asString(row.display_name, NEUTRAL_DEFAULTS.displayName),
    legalName: asNullableString(row.legal_name),
    tagline: asNullableString(row.tagline),
    description: asNullableString(row.description),
    industry: asNullableString(row.industry),
    websiteUrl: asNullableString(row.website_url),
    logoUrl: asNullableString(row.logo_url),
    faviconUrl: asNullableString(row.favicon_url),
    shortMark: asNullableString(row.short_mark),
    serviceAreas: asStringArray(row.service_areas),
    timeZone: asNullableString(row.time_zone),
    accent: asString(row.accent, NEUTRAL_DEFAULTS.accent),
    density,
    motion,
    tone: asString(row.tone, NEUTRAL_DEFAULTS.tone),
    voiceGuidance: asNullableString(row.voice_guidance),
    preferredPhrases: asStringArray(row.preferred_phrases),
    bannedPhrases: asStringArray(row.banned_phrases),
    services: asStringArray(row.services),
    proofPoints: asProofPoints(row.proof_points),
    guardrails: {
      disallowedClaims:
        disallowedClaims.length > 0 ? disallowedClaims : NEUTRAL_DEFAULTS.guardrails.disallowedClaims,
      complianceNotes: asString(
        guardrailsRaw.complianceNotes,
        NEUTRAL_DEFAULTS.guardrails.complianceNotes,
      ),
    },
    brandPalette: parseBrandPalette(row.brand_palette),
    status,
  };
}

export type ProfileValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Validate a BusinessProfile prior to persistence. */
export function validateBusinessProfile(profile: BusinessProfile): ProfileValidationResult {
  const errors: string[] = [];
  if (profile.displayName.trim().length === 0) errors.push("display_name_required");
  if (!HEX_COLOR.test(profile.accent)) errors.push("accent_invalid");
  for (const slot of ["primary", "secondary", "accent", "dark", "light"] as const) {
    const hex = profile.brandPalette[slot].hex;
    if (hex.length > 0 && !HEX_COLOR.test(hex)) errors.push(`palette_${slot}_invalid`);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** A partial palette proposed by vision / website analysis (any subset of slots + fonts). */
export type BrandPaletteUpdate = Partial<BrandPalette>;

/** Normalize a candidate hex ("f2a93b", "#18B4A6") to "#rrggbb", or null if not a valid 6-digit hex. */
function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return HEX_COLOR.test(withHash) ? withHash : null;
}

function fillColor(current: BrandColor, incoming: BrandColor | undefined): BrandColor {
  if (current.hex.length > 0) return current; // never overwrite a slot the operator already set
  const hex = normalizeHex(incoming?.hex);
  if (!hex) return current; // ignore missing/invalid hex
  return { label: asString(incoming?.label, ""), hex };
}

/**
 * Merge a vision/website-extracted palette into the current one with keep-or-fill
 * semantics: only empty colour slots are filled, and only from a valid (normalizable)
 * hex; fonts fill only when blank. Existing values and invalid colours are preserved.
 */
export function mergeBrandPalette(
  current: BrandPalette,
  update: BrandPaletteUpdate | null | undefined,
): BrandPalette {
  if (!update) return current;
  return {
    primary: fillColor(current.primary, update.primary),
    secondary: fillColor(current.secondary, update.secondary),
    accent: fillColor(current.accent, update.accent),
    dark: fillColor(current.dark, update.dark),
    light: fillColor(current.light, update.light),
    headingFont: current.headingFont || asString(update.headingFont, ""),
    bodyFont: current.bodyFont || asString(update.bodyFont, ""),
  };
}

/** The five colour slots, in the order the Brand screen shows them. */
export const BRAND_COLOR_SLOTS = ["primary", "secondary", "accent", "dark", "light"] as const;
export type BrandColorSlot = (typeof BRAND_COLOR_SLOTS)[number];

/** One slot as the operator's editor submits it. An empty `hex` clears the slot. */
export type BrandColorEdit = { label?: string; hex?: string };

export type BrandPaletteEdit = {
  colors?: Partial<Record<BrandColorSlot, BrandColorEdit>>;
  headingFont?: string;
  bodyFont?: string;
};

export type BrandPaletteEditResult =
  | { ok: true; palette: BrandPalette }
  | { ok: false; errors: string[] };

/**
 * Apply an operator's palette edit. Deliberately NOT `mergeBrandPalette`, which
 * exists for machine extraction and has keep-or-fill semantics: it refuses to
 * overwrite a set slot and silently drops anything it can't parse.
 *
 * A person editing their own palette needs the opposite of both. They must be
 * able to change a colour they already set, and to clear one back to empty. And
 * a hex they typed wrong has to come back as an error — silently keeping the old
 * value would show them a saved-looking screen with the previous colour still on
 * it, which is the failure that makes someone approve creative in the wrong brand.
 *
 * Slots absent from `colors` are left exactly as they were, so a caller can send
 * one slot without restating the rest.
 */
export function applyBrandPaletteEdit(
  current: BrandPalette,
  edit: BrandPaletteEdit,
): BrandPaletteEditResult {
  const errors: string[] = [];
  const next: BrandPalette = { ...current };

  for (const slot of BRAND_COLOR_SLOTS) {
    const incoming = edit.colors?.[slot];
    if (!incoming) continue; // untouched slot

    const rawHex = (incoming.hex ?? "").trim();
    const label = (incoming.label ?? current[slot].label).trim();

    if (rawHex.length === 0) {
      // An explicit clear. The label goes with it — a named slot with no colour
      // would render as a gap the operator can't see the cause of.
      next[slot] = { label: "", hex: "" };
      continue;
    }

    const hex = normalizeHex(rawHex);
    if (!hex) {
      errors.push(`${slot}: "${rawHex}" isn't a 6-digit hex colour.`);
      continue;
    }
    next[slot] = { label, hex };
  }

  if (edit.headingFont !== undefined) next.headingFont = edit.headingFont.trim();
  if (edit.bodyFont !== undefined) next.bodyFont = edit.bodyFont.trim();

  return errors.length === 0 ? { ok: true, palette: next } : { ok: false, errors };
}

export type IndustryTemplate = {
  id: string;
  label: string;
  /** Partial overrides applied on top of NEUTRAL_DEFAULTS. */
  profile: Partial<BusinessProfile>;
  personas: PersonaDefinition[];
};

function persona(
  key: string,
  label: string,
  audienceType: string,
  sortOrder: number,
  description: string,
): PersonaDefinition {
  return { key, label, audienceType, sortOrder, isActive: true, metadata: { description } };
}

export const INDUSTRY_TEMPLATES: IndustryTemplate[] = [
  {
    id: "neutral",
    label: "Start neutral / from scratch",
    profile: {},
    personas: NEUTRAL_PERSONAS,
  },
  {
    id: "home_property_services",
    label: "Home & Property Services",
    profile: {
      tone: "reassuring",
      services: ["Repairs", "Maintenance", "Emergency response", "Inspections"],
    },
    personas: [
      persona("homeowner", "Homeowner", "customer", 0, "Owner-occupant needing service at their home."),
      persona("property_manager", "Property manager", "customer", 1, "Manages multiple properties and recurring work."),
      persona("trade_partner", "Trade partner", "partner", 2, "Adjacent trade that can refer overflow work."),
    ],
  },
  {
    id: "professional_services",
    label: "Professional & B2B Services",
    profile: {
      tone: "professional",
      services: ["Consulting", "Advisory", "Managed services", "Project delivery"],
    },
    personas: [
      persona("buyer", "Economic buyer", "customer", 0, "Holds budget authority for the engagement."),
      persona("champion", "Internal champion", "customer", 1, "Advocates for the solution inside the account."),
      persona("referral_partner", "Referral partner", "partner", 2, "Sends qualified introductions."),
    ],
  },
  {
    id: "health_wellness",
    label: "Health & Wellness",
    profile: {
      tone: "warm",
      services: ["Appointments", "Programs", "Memberships", "Consultations"],
    },
    personas: [
      persona("new_patient", "New patient/client", "customer", 0, "First-time visitor evaluating the practice."),
      persona("returning_client", "Returning client", "customer", 1, "Existing client booking again."),
      persona("referring_provider", "Referring provider", "partner", 2, "Provider who refers patients."),
    ],
  },
  {
    id: "retail_ecommerce",
    label: "Retail & E-commerce",
    profile: {
      tone: "friendly",
      services: ["Products", "Collections", "Subscriptions", "Promotions"],
    },
    personas: [
      persona("first_time_shopper", "First-time shopper", "customer", 0, "Has not purchased before."),
      persona("loyal_customer", "Loyal customer", "customer", 1, "Repeat buyer eligible for loyalty offers."),
      persona("cart_abandoner", "Cart abandoner", "customer", 2, "Added to cart but did not check out."),
    ],
  },
  {
    id: "real_estate_property",
    label: "Real Estate & Property",
    profile: {
      tone: "professional",
      services: ["Listings", "Buyer representation", "Leasing", "Property management"],
    },
    personas: [
      persona("seller", "Seller", "customer", 0, "Owner looking to list or sell."),
      persona("buyer", "Buyer", "customer", 1, "Prospective purchaser."),
      persona("investor", "Investor", "customer", 2, "Acquires property for return."),
    ],
  },
  {
    id: "hospitality_local",
    label: "Hospitality & Local",
    profile: {
      tone: "friendly",
      services: ["Reservations", "Events", "Catering", "Local offers"],
    },
    personas: [
      persona("first_time_guest", "First-time guest", "customer", 0, "Trying the venue for the first time."),
      persona("regular", "Regular", "customer", 1, "Frequent visitor."),
      persona("event_planner", "Event planner", "customer", 2, "Books group or private events."),
    ],
  },
];

const NEUTRAL_TEMPLATE = INDUSTRY_TEMPLATES[0];

export function getIndustryTemplate(id: string): IndustryTemplate {
  return INDUSTRY_TEMPLATES.find((t) => t.id === id) ?? NEUTRAL_TEMPLATE;
}

/** Apply a template's partial overrides on top of NEUTRAL_DEFAULTS. */
export function applyIndustryTemplate(id: string): BusinessProfile {
  const tpl = getIndustryTemplate(id);
  return { ...NEUTRAL_DEFAULTS, ...tpl.profile, industry: tpl.id === "neutral" ? null : tpl.id };
}

export type ArcBusinessContext = {
  businessName: string;
  industry: string | null;
  services: string[];
  tone: string;
  voiceGuidance: string | null;
  preferredPhrases: string[];
  bannedPhrases: string[];
  proofPoints: ProofPoint[];
  personas: PersonaDefinition[];
  guardrails: BrandKitGuardrails;
  brainFacts: string[];
  palette: BrandPalette;
  logoUrl: string | null;
  tagline: string | null;
  description: string | null;
  websiteUrl: string | null;
  serviceAreas: string[];
};

/**
 * Assemble the read-only context bundle Arc and the UI consume. Pure: callers
 * pass a profile + persona rows; this never reaches I/O. Inactive personas are
 * dropped and the rest are sorted by sortOrder.
 */
export function assembleArcContext(
  profile: BusinessProfile,
  personas: PersonaDefinition[],
  brainFacts: string[] = [],
): ArcBusinessContext {
  const businessName = profile.displayName.trim().length > 0 ? profile.displayName.trim() : "the business";
  return {
    businessName,
    industry: profile.industry,
    services: profile.services,
    tone: profile.tone,
    voiceGuidance: profile.voiceGuidance,
    preferredPhrases: profile.preferredPhrases,
    bannedPhrases: profile.bannedPhrases,
    proofPoints: profile.proofPoints,
    personas: personas.filter((p) => p.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    guardrails: profile.guardrails,
    brainFacts,
    palette: profile.brandPalette,
    logoUrl: profile.logoUrl,
    tagline: profile.tagline,
    description: profile.description,
    websiteUrl: profile.websiteUrl,
    serviceAreas: profile.serviceAreas,
  };
}

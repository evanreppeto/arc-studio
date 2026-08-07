import { deriveObjectLabelForms, parseObjectLabelOverride, type ObjectLabelOverride } from "@/domain";

export type ProductIndustryKey =
  | "general"
  | "restoration"
  | "home_services"
  | "professional_services"
  | "agency"
  | "healthcare"
  | "real_estate"
  | "saas"
  | "ecommerce";

export type CrmObjectLanguage = {
  label: string;
  noun: string;
  nameHeader: string;
  singular: string;
};

export type ProductLanguageObjectKey = "companies" | "contacts" | "properties" | "leads" | "jobs" | "outcomes";

export type ProductLanguage = {
  industry: ProductIndustryKey;
  crmLabel: string;
  crmObjects: Record<ProductLanguageObjectKey, CrmObjectLanguage>;
};

/**
 * A workspace's own words, overriding the industry vocabulary. Stored on
 * `app_settings` under `crm_object_labels`; shape validated per object by
 * `parseObjectLabelOverride`, so a malformed or half-filled entry falls back to
 * the industry label rather than rendering a mixed screen.
 */
export type ObjectLabelSettings = {
  /** The CRM section's own name — "Matters" in the nav, replacing "Relationships". */
  section?: string;
  /**
   * Typed for consumers, but still re-validated at runtime by
   * `parseObjectLabelOverride` — this arrives from a jsonb column, so the type is
   * a convenience for callers, not a guarantee about what's in the row.
   */
  objects?: Partial<Record<ProductLanguageObjectKey, ObjectLabelOverride>>;
};

const INDUSTRY_ALIASES: Record<string, ProductIndustryKey> = {
  general: "general",
  general_other: "general",
  restoration: "restoration",
  restoration_property_recovery: "restoration",
  restoration_and_property_recovery: "restoration",
  restoration_home_services: "restoration",
  restoration_and_home_services: "restoration",
  home_services: "home_services",
  home_field_services: "home_services",
  home_and_field_services: "home_services",
  roofing_exteriors: "home_services",
  roofing_and_exteriors: "home_services",
  general_contracting: "home_services",
  professional_services: "professional_services",
  agency: "agency",
  marketing_creative_agency: "agency",
  marketing_and_creative_agency: "agency",
  healthcare: "healthcare",
  healthcare_dental_med_spa: "healthcare",
  healthcare_dental_and_med_spa: "healthcare",
  real_estate: "real_estate",
  saas: "saas",
  saas_b2b_tech: "saas",
  saas_and_b2b_tech: "saas",
  ecommerce: "ecommerce",
  e_commerce: "ecommerce",
  e_commerce_retail: "ecommerce",
  e_commerce_and_retail: "ecommerce",
};

function aliasKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Converts picker keys and older display-label settings to one stable industry key. */
export function canonicalIndustryKey(value?: string | null): ProductIndustryKey {
  if (!value) return "general";
  return INDUSTRY_ALIASES[aliasKey(value)] ?? "general";
}

const GENERAL_OBJECTS: ProductLanguage["crmObjects"] = {
  companies: { label: "Organizations", noun: "organizations", nameHeader: "Organization", singular: "organization" },
  contacts: { label: "People", noun: "people", nameHeader: "Person", singular: "person" },
  properties: { label: "Sites", noun: "sites", nameHeader: "Site", singular: "site" },
  leads: { label: "Leads", noun: "leads", nameHeader: "Lead", singular: "lead" },
  jobs: { label: "Projects", noun: "projects", nameHeader: "Project", singular: "project" },
  outcomes: { label: "Outcomes", noun: "outcomes", nameHeader: "Outcome", singular: "outcome" },
};

const LANGUAGE: Record<ProductIndustryKey, Omit<ProductLanguage, "industry">> = {
  general: { crmLabel: "Relationships", crmObjects: GENERAL_OBJECTS },
  restoration: {
    crmLabel: "CRM",
    crmObjects: {
      companies: { label: "Companies", noun: "companies", nameHeader: "Company", singular: "company" },
      contacts: { label: "Contacts", noun: "contacts", nameHeader: "Contact", singular: "contact" },
      properties: { label: "Properties", noun: "properties", nameHeader: "Property", singular: "property" },
      leads: { label: "Leads", noun: "leads", nameHeader: "Lead", singular: "lead" },
      jobs: { label: "Jobs", noun: "jobs", nameHeader: "Job", singular: "job" },
      outcomes: { label: "Outcomes", noun: "outcomes", nameHeader: "Outcome", singular: "outcome" },
    },
  },
  home_services: {
    crmLabel: "Customers",
    crmObjects: {
      companies: { label: "Accounts", noun: "accounts", nameHeader: "Account", singular: "account" },
      contacts: { label: "Customers", noun: "customers", nameHeader: "Customer", singular: "customer" },
      properties: { label: "Service locations", noun: "service locations", nameHeader: "Location", singular: "service location" },
      leads: { label: "Requests", noun: "requests", nameHeader: "Request", singular: "request" },
      jobs: { label: "Jobs", noun: "jobs", nameHeader: "Job", singular: "job" },
      outcomes: { label: "Outcomes", noun: "outcomes", nameHeader: "Outcome", singular: "outcome" },
    },
  },
  professional_services: {
    crmLabel: "Clients",
    crmObjects: {
      companies: { label: "Organizations", noun: "organizations", nameHeader: "Organization", singular: "organization" },
      contacts: { label: "Clients", noun: "clients", nameHeader: "Client", singular: "client" },
      properties: { label: "Accounts", noun: "accounts", nameHeader: "Account", singular: "account" },
      leads: { label: "Inquiries", noun: "inquiries", nameHeader: "Inquiry", singular: "inquiry" },
      jobs: { label: "Engagements", noun: "engagements", nameHeader: "Engagement", singular: "engagement" },
      outcomes: { label: "Results", noun: "results", nameHeader: "Result", singular: "result" },
    },
  },
  agency: {
    crmLabel: "Clients",
    crmObjects: {
      companies: { label: "Clients", noun: "clients", nameHeader: "Client", singular: "client" },
      contacts: { label: "Contacts", noun: "contacts", nameHeader: "Contact", singular: "contact" },
      properties: { label: "Brands", noun: "brands", nameHeader: "Brand", singular: "brand" },
      leads: { label: "Leads", noun: "leads", nameHeader: "Lead", singular: "lead" },
      jobs: { label: "Projects", noun: "projects", nameHeader: "Project", singular: "project" },
      outcomes: { label: "Results", noun: "results", nameHeader: "Result", singular: "result" },
    },
  },
  healthcare: {
    crmLabel: "Patients",
    crmObjects: {
      companies: { label: "Organizations", noun: "organizations", nameHeader: "Organization", singular: "organization" },
      contacts: { label: "Patients", noun: "patients", nameHeader: "Patient", singular: "patient" },
      properties: { label: "Locations", noun: "locations", nameHeader: "Location", singular: "location" },
      leads: { label: "Inquiries", noun: "inquiries", nameHeader: "Inquiry", singular: "inquiry" },
      jobs: { label: "Appointments", noun: "appointments", nameHeader: "Appointment", singular: "appointment" },
      outcomes: { label: "Outcomes", noun: "outcomes", nameHeader: "Outcome", singular: "outcome" },
    },
  },
  real_estate: {
    crmLabel: "Pipeline",
    crmObjects: {
      companies: { label: "Brokerages", noun: "brokerages", nameHeader: "Brokerage", singular: "brokerage" },
      contacts: { label: "Contacts", noun: "contacts", nameHeader: "Contact", singular: "contact" },
      properties: { label: "Properties", noun: "properties", nameHeader: "Property", singular: "property" },
      leads: { label: "Leads", noun: "leads", nameHeader: "Lead", singular: "lead" },
      jobs: { label: "Deals", noun: "deals", nameHeader: "Deal", singular: "deal" },
      outcomes: { label: "Closings", noun: "closings", nameHeader: "Closing", singular: "closing" },
    },
  },
  saas: {
    crmLabel: "Accounts",
    crmObjects: {
      companies: { label: "Accounts", noun: "accounts", nameHeader: "Account", singular: "account" },
      contacts: { label: "Contacts", noun: "contacts", nameHeader: "Contact", singular: "contact" },
      properties: { label: "Workspaces", noun: "workspaces", nameHeader: "Workspace", singular: "workspace" },
      leads: { label: "Prospects", noun: "prospects", nameHeader: "Prospect", singular: "prospect" },
      jobs: { label: "Deals", noun: "deals", nameHeader: "Deal", singular: "deal" },
      outcomes: { label: "Revenue", noun: "revenue outcomes", nameHeader: "Revenue outcome", singular: "revenue outcome" },
    },
  },
  ecommerce: {
    crmLabel: "Customers",
    crmObjects: {
      companies: { label: "Brands", noun: "brands", nameHeader: "Brand", singular: "brand" },
      contacts: { label: "Customers", noun: "customers", nameHeader: "Customer", singular: "customer" },
      properties: { label: "Stores", noun: "stores", nameHeader: "Store", singular: "store" },
      leads: { label: "Shoppers", noun: "shoppers", nameHeader: "Shopper", singular: "shopper" },
      jobs: { label: "Orders", noun: "orders", nameHeader: "Order", singular: "order" },
      outcomes: { label: "Purchases", noun: "purchases", nameHeader: "Purchase", singular: "purchase" },
    },
  },
};

/**
 * The vocabulary a workspace's screens should speak.
 *
 * Resolution order: the workspace's own typed labels, then its industry
 * template, then `general`'s neutral nouns. Overrides are applied per object, so
 * a workspace that renamed only `properties` keeps its industry's words for the
 * other five rather than being dropped to `general` wholesale.
 *
 * `overrides` is optional so the marketing `/industries` pages — which must show
 * what an industry gives you, not what one tenant renamed — can ask for the
 * template alone.
 */
export function getProductLanguage(industry?: string | null, overrides?: ObjectLabelSettings | null): ProductLanguage {
  const key = canonicalIndustryKey(industry);
  const base: ProductLanguage = { industry: key, ...LANGUAGE[key] };
  if (!overrides) return base;

  const section = typeof overrides.section === "string" ? overrides.section.trim() : "";
  const crmObjects = { ...base.crmObjects };
  for (const objectKey of Object.keys(crmObjects) as ProductLanguageObjectKey[]) {
    const parsed = parseObjectLabelOverride(overrides.objects?.[objectKey]);
    if (parsed) crmObjects[objectKey] = deriveObjectLabelForms(parsed);
  }

  return { industry: key, crmLabel: section || base.crmLabel, crmObjects };
}

/**
 * Example scenes for the "describe an image / describe the shot" prompts.
 *
 * These are placeholders, so they teach by example — which means a hardcoded one
 * teaches the WRONG example to eight industries out of nine. Studio shipped with
 * "a clean service van in a suburban driveway" in both boxes: fine for a
 * restoration or home-services tenant, an odd non-sequitur for a law firm, a
 * clinic, or a shop. Same rule as every other label here — the industry template
 * decides, `general` is the neutral fallback.
 *
 * Deliberately free of text, logos, and signage: the server strips those from
 * generated images unconditionally, so an example asking for them would teach a
 * prompt that quietly does not work.
 */
const MEDIA_PROMPT_EXAMPLES: Record<ProductIndustryKey, { image: string; video: string }> = {
  general: {
    image: "A bright, welcoming workspace photographed at eye level in natural light",
    video: "A bright workspace in natural light, slow steady camera move across the room",
  },
  restoration: {
    image: "A clean service van in a suburban driveway on a bright morning",
    video: "A clean service van pulls into a suburban driveway on a bright morning, slow steady camera",
  },
  home_services: {
    image: "A tidy work van parked outside a suburban home on a bright morning",
    video: "A work van pulls up outside a suburban home, morning light, slow steady camera",
  },
  professional_services: {
    image: "A calm meeting room with morning light falling across the table",
    video: "Morning light moving across an empty meeting-room table, slow push in",
  },
  agency: {
    image: "A bright studio desk with a laptop and colour swatches, shot from above",
    video: "Colour swatches laid out one by one on a bright studio desk, overhead, slow and unhurried",
  },
  healthcare: {
    image: "A calm, bright reception area with plants and comfortable seating",
    video: "A calm reception area in soft daylight, slow gentle pan, no people",
  },
  real_estate: {
    image: "A sunlit living room, styled and empty, windows open to the garden",
    video: "Sunlight moving across an empty styled living room, slow steady dolly",
  },
  saas: {
    image: "A clean desk with an open laptop in a bright office, screen not readable",
    video: "A bright office desk in morning light, slow push toward an open laptop",
  },
  ecommerce: {
    image: "A single product centred on a seamless backdrop, soft studio lighting",
    video: "A single product on a seamless backdrop, slow turntable rotation, studio light",
  },
};

/** The example scenes for a workspace's industry (falls back to `general`). */
export function getMediaPromptExamples(industry?: string | null): { image: string; video: string } {
  return MEDIA_PROMPT_EXAMPLES[canonicalIndustryKey(industry)];
}

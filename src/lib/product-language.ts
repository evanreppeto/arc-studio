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

export type ProductLanguage = {
  industry: ProductIndustryKey;
  crmLabel: string;
  crmObjects: Record<"companies" | "contacts" | "properties" | "leads" | "jobs" | "outcomes", CrmObjectLanguage>;
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

export function getProductLanguage(industry?: string | null): ProductLanguage {
  const key = canonicalIndustryKey(industry);
  return { industry: key, ...LANGUAGE[key] };
}

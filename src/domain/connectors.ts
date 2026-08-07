// Pure, deterministic connector catalog + status math. No I/O. Mirrors the
// shape of connections.ts but is workspace-scoped and credential-based (a key
// stored per workspace) rather than env-var-based.
//
// This module is the tenant-agnostic connector *plugin framework* metadata layer
// (BSR-363). Every connector — whether it exposes a remote MCP tool, a
// signal source that proposes opportunities, or an outbound channel — declares
// one metadata descriptor here. The behavioural side (a signal source's
// detect(), a channel's dispatch()) lives in the runtime registry at
// `src/lib/connectors/registry.ts`, keyed back to the `key` declared here.

export type ConnectorAuthKind = "api_key" | "oauth" | "none";
export type ConnectorAccess = "read_only" | "gated_write";
export type ConnectorStatus = "not_configured" | "disabled" | "error" | "connected" | "unavailable";

/**
 * Whether a catalog entry can actually reach the outside world yet.
 *
 * `planned` is for a connector whose external integration isn't written. It is NOT
 * cosmetic: it makes the connector unreachable rather than merely undocumented. A
 * connector with no live source can otherwise be switched on, report "Connected",
 * and either do nothing (best case) or invent findings (what permit-data did) — and
 * a note in a doc protects only the people who read the doc, never the operator
 * looking at a switch.
 */
export type ConnectorAvailability = "live" | "planned";

/**
 * What role a connector plays. Governs how it is loaded and used:
 * - `mcp_tool`      — a remote/native tool Arc can call in draft/act modes.
 * - `signal_source` — read-only; exposes detect() → OpportunityCandidate[] that
 *                     feed the Opportunity inbox via upsertOpportunities.
 * - `channel`       — an outbound medium; exposes dispatch() called ONLY by the
 *                     approved-send path. Never auto-sends.
 * - `import_source` — read-IN; pulls external records (CRM contacts, firmographic
 *                     enrichment) and writes ONLY internal CRM rows through the
 *                     gated lead-ingestion path. Runs as an EXPLICIT operator
 *                     action (runCrmImport), never on the automatic detection loop,
 *                     and never writes to the outside world. See docs/CONNECTORS.md.
 */
export type ConnectorKind = "mcp_tool" | "signal_source" | "channel" | "import_source";

/**
 * HYBRID cost model (BSR-372 governs metering later; this layer just carries the
 * field). `free` and `byo_key` bypass metering entirely — the workspace either
 * pays nothing or pays its own provider directly. `metered` is billed by us.
 */
export type ConnectorCostTier = "free" | "byo_key" | "metered";

/**
 * Declares what credential (if any) the operator must supply to connect. `kind`
 * mirrors `authKind`; `optional` means the connector still works without it (so
 * it can be enabled with no credential). `none` connectors need nothing stored.
 */
export type ConnectorCredentialSchema = {
  kind: ConnectorAuthKind;
  /** Field label shown in the connect form (e.g. "Gemini API key"). */
  label?: string;
  /** Helper text under the field. */
  hint?: string;
  /** True when the connector functions without the credential present. */
  optional?: boolean;
};

/**
 * What the connector can actually do, by kind. Purely descriptive — used by the
 * catalog, the runner hand-off, and the Opportunity/approval wiring.
 */
export type ConnectorCapability = {
  /** One-line human summary. */
  summary: string;
  /** signal_source: the opportunity `kind` values detect() may emit. */
  opportunityKinds?: string[];
  /** channel: the outbound medium (email, sms, social_post, webhook, …). */
  channelMedium?: string;
  /** mcp_tool: tool namespaces the server exposes (mirrors toolNamespace). */
  toolNamespaces?: string[];
  /** import_source: the CRM object types this connector writes (companies/contacts/leads). */
  importsInto?: string[];
};

export type ConnectorRegistryEntry = {
  /**
   * Stable catalog identifier — this IS the descriptor `id`. Also the
   * workspace_connectors.connector_key value and the key the runtime registry
   * (detect/dispatch impls) is keyed on. Kept as `key` because it is load-bearing
   * across the DB column, read-model, actions, and tests.
   */
  key: string;
  /** Plugin role — see ConnectorKind. */
  kind: ConnectorKind;
  label: string;
  description: string;
  /** HYBRID cost model tier — carried now, metered governed by BSR-372. */
  costTier: ConnectorCostTier;
  /** Industries this connector is most relevant to. `[]` = universal (all types). */
  verticals: string[];
  /** What the connector does, by kind. */
  capability: ConnectorCapability;
  /** What the operator must supply to connect. */
  credentialSchema: ConnectorCredentialSchema;
  /**
   * Per-workspace config keys the connector cannot meaningfully run without — any
   * ONE present counts as satisfied (a key set often has aliases). Absent/empty
   * means the connector needs no config.
   *
   * This exists so a connector that needs *where to look* rather than *a key* can
   * still report `not_configured` instead of claiming "Connected" and quietly doing
   * nothing — or, worse, falling back to some built-in default that is right for
   * exactly one tenant.
   */
  requiredConfigKeys?: string[];
  /**
   * Defaults to "live". "planned" = the external integration isn't built, so the
   * connector reports `unavailable`, can't be enabled, and never runs.
   */
  availability?: ConnectorAvailability;
  /**
   * PLATFORM-CREDITS mode (the bundled default of the dual credential model):
   * names the deployment env var holding the platform's own key for this
   * provider. When present AND set in the environment, the connector works out
   * of the box with no stored workspace credential — resolved by
   * `resolveConnectorCredential` in src/lib/connectors/credential-resolution.ts
   * as: workspace's own Vault key first (byo), else the platform key (metered
   * against the workspace's plan), else an honest "not configured". Absent =
   * BYO-only (e.g. a personal-account OAuth the platform cannot share).
   */
  platformEnvVar?: string;
  /** Convenience mirror of credentialSchema.kind (widely read by UI/read-model). */
  authKind: ConnectorAuthKind;
  access: ConnectorAccess;
  /**
   * Remote MCP endpoint for connectors loaded into the runner (mcp_tool, Slice B).
   * null for "native" connectors whose capability already lives in-app (Gemini)
   * and for signal_source / channel connectors (no remote MCP server).
   */
  mcpUrl: string | null;
  /** Header that carries the credential for remote MCP connectors. */
  authHeader?: string;
  /** mcpServers map key / tool namespace for remote connectors. */
  toolNamespace: string;
};

export const CONNECTOR_REGISTRY: ConnectorRegistryEntry[] = [
  {
    key: "gemini-research",
    kind: "mcp_tool",
    label: "Gemini Web Research",
    description: "Grounded web search with citations — included on platform credits, or bring this workspace's own Gemini API key.",
    costTier: "byo_key",
    platformEnvVar: "GEMINI_API_KEY",
    verticals: [],
    capability: { summary: "Grounded web research with citations.", toolNamespaces: ["gemini"] },
    credentialSchema: {
      kind: "api_key",
      label: "Gemini API key",
      hint: "From Google AI Studio. Stored encrypted in your Vault — never shown again, never sent to the browser.",
    },
    authKind: "api_key",
    access: "read_only",
    mcpUrl: null,
    toolNamespace: "gemini",
  },
  {
    key: "gemini-media",
    kind: "mcp_tool",
    label: "Media Generation",
    description:
      "AI image & video generation for Studio and Arc — included on platform credits (metered, spend-capped), or bring this workspace's own Gemini API key. Output always lands as approval-gated draft assets, provenance-tagged and risk-flagged.",
    costTier: "byo_key",
    platformEnvVar: "GEMINI_API_KEY",
    verticals: [],
    capability: { summary: "Generate campaign imagery and short video as approval-gated drafts.", toolNamespaces: ["media"] },
    credentialSchema: {
      kind: "api_key",
      label: "Gemini API key",
      hint: "From Google AI Studio (billing enabled for image output). Stored encrypted in your Vault — never shown again, never sent to the browser.",
    },
    authKind: "api_key",
    access: "gated_write",
    mcpUrl: null,
    toolNamespace: "media",
  },
  {
    key: "higgsfield",
    kind: "mcp_tool",
    label: "Higgsfield",
    description:
      "Cinematic image & video generation, UGC/viral ad variants, and virality prediction on this " +
      "workspace's own Higgsfield credits. Loaded into the runner as a remote MCP; output lands as " +
      "approval-gated draft assets. Connect with a personal account (OAuth) or a Cloud API key.",
    costTier: "byo_key",
    verticals: [],
    capability: { summary: "Cinematic image & video generation, draft assets only.", toolNamespaces: ["higgsfield"] },
    credentialSchema: {
      kind: "oauth",
      label: "Higgsfield credential",
      hint:
        "Connect with Higgsfield (personal-account OAuth), or paste a Cloud API key from cloud.higgsfield.ai — " +
        "the supported path for the hosted runner (no signed-in session to expire). Used only for approval-gated draft assets.",
    },
    authKind: "oauth",
    access: "gated_write",
    mcpUrl: "https://mcp.higgsfield.ai/mcp",
    authHeader: "Authorization",
    toolNamespace: "higgsfield",
  },
  // --- signal_source + channel connectors. Behaviour lives in
  //     src/lib/connectors/builtin/ and is keyed back to these `key`s. ---
  {
    key: "weather-signals",
    kind: "signal_source",
    label: "Weather Signals (NWS/NOAA)",
    description:
      "Read-only signal source: reads live active alerts from the National Weather Service / NOAA for " +
      "your service area (US states or lat-lng points) and proposes geo-targeted storm-response " +
      "opportunities to the inbox. No API key — NWS is public. Never contacts anyone — proposals only.",
    costTier: "free",
    verticals: ["restoration", "roofing", "hvac", "landscaping", "solar", "insurance", "property_management"],
    capability: {
      summary: "Emits weather-event opportunities from live NWS/NOAA alerts for the configured service area.",
      opportunityKinds: ["weather_event"],
    },
    credentialSchema: {
      kind: "none",
      hint: "No credential — NWS/NOAA is a public API. Configure the US states (or lat-lng points) to watch.",
    },
    // No key to supply, but it still cannot run until it's told WHERE to watch.
    // Without this the connector reads "Connected" on an empty config and silently
    // watches whatever the code happens to default to — see parseWeatherServiceArea.
    // The aliases mirror exactly what that parser accepts.
    requiredConfigKeys: ["states", "areas", "points", "locations"],
    authKind: "none",
    access: "read_only",
    mcpUrl: null,
    toolNamespace: "weather-signals",
  },
  {
    key: "rss-signals",
    kind: "signal_source",
    label: "Feeds & News Watch",
    description:
      "Read-only signal source: watches the RSS/Atom feeds you configure — a Google Alerts feed for your brand, a " +
      "competitor's blog, an industry news feed — and proposes a timely-response opportunity for each fresh item. " +
      "No API key — RSS is public. Never posts anything — proposals only.",
    costTier: "free",
    // Universal: every business has news it could respond to. `[]` = all verticals.
    verticals: [],
    capability: {
      summary: "Emits news_signal opportunities from fresh items in the workspace's watched RSS/Atom feeds.",
      opportunityKinds: ["news_signal"],
    },
    credentialSchema: {
      kind: "none",
      hint: "No credential — RSS/Atom feeds are public. Add the feed URLs to watch (one per line).",
    },
    // Public, so no key — but useless until told WHICH feeds to watch. Same gate as
    // weather: without it an empty config would read "Connected" and do nothing.
    requiredConfigKeys: ["feeds"],
    authKind: "none",
    access: "read_only",
    mcpUrl: null,
    toolNamespace: "rss-signals",
  },
  {
    key: "news-search",
    kind: "signal_source",
    label: "News Search",
    description:
      "Read-only signal source: searches the news for the terms you watch — your brand, a competitor, an industry " +
      "topic — and proposes a timely-response opportunity for each fresh mention. Uses your own GNews API key, so it " +
      "finds coverage on sites that publish no feed. Never posts anything — proposals only.",
    costTier: "byo_key",
    // Universal: every business can watch its own name and its market.
    verticals: [],
    capability: {
      summary: "Emits news_signal opportunities from fresh news articles matching the workspace's watched search terms.",
      opportunityKinds: ["news_signal"],
    },
    credentialSchema: {
      kind: "api_key",
      label: "GNews API key",
      hint: "A free key from gnews.io. Stored encrypted in your Vault — never shown again, never sent to the browser.",
    },
    // Needs BOTH a key AND terms to search. requiredConfigKeys gates the config half;
    // the credential gate handles the key half.
    requiredConfigKeys: ["queries"],
    authKind: "api_key",
    access: "read_only",
    mcpUrl: null,
    toolNamespace: "news-search",
  },
  {
    key: "reviews-signals",
    kind: "signal_source",
    label: "Reviews & Reputation",
    description:
      "Read-only Google Business Profile. Connect via OAuth and set the business location; Arc reads recent reviews " +
      "and proposes service-recovery opportunities (negatives) and referral/testimonial opportunities (positives), " +
      "and audits the profile itself for the local-search gaps that suppress visibility — missing primary category, " +
      "no service area, absent hours, a thin description. It never replies and never edits the profile — proposals " +
      "only; any response or fix stays an approval-gated draft.",
    costTier: "byo_key",
    verticals: [
      "restoration",
      "home_services",
      "field_services",
      "retail",
      "restaurants",
      "healthcare",
      "professional_services",
      "automotive",
      "fitness",
    ],
    capability: {
      summary: "Emits review_signal opportunities from recent reviews, and local_seo_gap opportunities from the business profile.",
      opportunityKinds: ["review_signal", "local_seo_gap"],
    },
    credentialSchema: {
      kind: "oauth",
      label: "Google Business Profile",
      hint: "Sign in to Google Business Profile to pull recent reviews. Stored encrypted in your Vault; used read-only.",
    },
    // Needs the location resource name (accounts/{id}/locations/{id}) the reviews
    // endpoint is keyed on — without it there's nothing to read, so gate it.
    requiredConfigKeys: ["gbpLocation"],
    authKind: "oauth",
    access: "read_only",
    mcpUrl: null,
    toolNamespace: "reviews-signals",
  },
  {
    key: "competitor-ads",
    kind: "signal_source",
    label: "Competitor Ad Intel",
    // Meta's official Ad Library API only (ToS) — no scraping. Google has no
    // official ads-transparency API, so this is Meta-only by necessity.
    description:
      "Read-only competitor ad intel from Meta's official Ad Library. Proposes defensive / contested-territory " +
      "opportunities with the competitor's keywords and creative intel attached — never contacts anyone. " +
      "COVERAGE NOTE: outside the EU, Meta's Ad Library API only returns political & social-issue ads; general " +
      "commercial ads are broadly queryable for EU-delivered ads. A quiet result may mean Meta doesn't expose " +
      "those ads, not that competitors are inactive.",
    // FREE, not byo_key: the Ad Library API bills nothing per call (it is rate-limited,
    // not metered), so a platform-key call must NOT flip to `metered` and charge for a
    // free API — effectiveCostTier keeps `free` free on the platform path.
    costTier: "free",
    // Platform-credits: one deployment-level token serves every workspace, exactly like
    // the HubSpot/Google OAuth apps — the operator sets it once and customers connect
    // without sourcing their own Meta token. A workspace may still paste its own token
    // (BYO wins in resolveConnectorCredential), which also gives it a private rate-limit
    // budget rather than sharing the platform token's.
    platformEnvVar: "META_AD_LIBRARY_TOKEN",
    verticals: [
      "home_services",
      "restoration",
      "retail",
      "ecommerce",
      "healthcare",
      "legal",
      "financial_services",
      "saas",
      "agencies",
    ],
    capability: {
      summary: "Emits competitor_signal opportunities from competitor ad-library activity.",
      opportunityKinds: ["competitor_signal"],
    },
    credentialSchema: {
      kind: "api_key",
      label: "Meta Ad Library access token",
      hint: "Optional — competitor ad intel is included, so you only need this to run searches on your own Meta token (your own rate-limit budget). Stored encrypted in your Vault; used read-only. Official API only — no scraping.",
      // The platform token satisfies the credential gate, so a workspace never has to
      // source its own Meta token just to switch this on.
      optional: true,
    },
    // Needs BOTH who to watch and where — a token alone can't query the library.
    requiredConfigKeys: ["competitors"],
    authKind: "api_key",
    access: "read_only",
    mcpUrl: null,
    toolNamespace: "competitor-ads",
  },
  {
    key: "webhook-dispatch",
    kind: "channel",
    label: "Outbound Webhook",
    description:
      "Outbound channel: posts an approved message payload to a configured endpoint. Fires only from the " +
      "human-approved send path — there is no automatic send.",
    costTier: "free",
    verticals: [],
    capability: { summary: "Dispatches approved payloads to an outbound webhook.", channelMedium: "webhook" },
    credentialSchema: { kind: "none", hint: "The endpoint URL lives in the connector config, not the Vault." },
    authKind: "none",
    access: "gated_write",
    mcpUrl: null,
    toolNamespace: "webhook-dispatch",
    // Without an endpoint there is nowhere to post — gate it so the connector reads
    // `not_configured` instead of a false "Connected" that could never deliver.
    requiredConfigKeys: ["endpoint"],
  },
  {
    key: "slack-alerts",
    kind: "channel",
    label: "Slack Alerts",
    description:
      "Internal alerts to your own Slack channel — Arc posts a summary of the opportunities it found so your team " +
      "sees them without opening the app. It NEVER messages customers and doesn't touch the campaign-send path. " +
      "Posts only when you click; nothing is sent automatically.",
    costTier: "free",
    // Universal — every team runs Slack or nothing; a no-op when not connected.
    verticals: [],
    capability: { summary: "Posts internal opportunity/approval alerts to a Slack channel (operator-triggered).", channelMedium: "slack" },
    credentialSchema: {
      kind: "api_key",
      label: "Slack Incoming Webhook URL",
      hint: "Create an Incoming Webhook in your Slack workspace (Apps → Incoming Webhooks) and paste the https://hooks.slack.com/… URL. Stored encrypted in your Vault.",
    },
    authKind: "api_key",
    access: "gated_write",
    mcpUrl: null,
    toolNamespace: "slack-alerts",
  },
  // --- The `metered` reference connector: a paid third-party data vendor, GOVERNED
  //     by the cost model (BSR-372) — a scan meters billable lookups against the
  //     workspace spend cap. The vendor itself is unbuilt (BSR-368), so this is
  //     `planned`: the metering path around it is real and tested, the data source
  //     is not. Pricing lives in src/domain/connector-metering.ts.
  //
  //     It is planned rather than merely undocumented because of what it used to do.
  //     detect() invented a finding per municipality — "Paid permit records flagged
  //     fresh filings in {X}" at confidence 65, from nothing but a name the operator
  //     typed — and metered a paid lookup for each. Fabricated evidence that bills
  //     you is the worst thing in this catalog; a doc note wouldn't stop a switch. ---
  {
    key: "permit-data",
    kind: "signal_source",
    label: "Permit & Property Data",
    description:
      "PLANNED — no permit/property data vendor is wired up yet, so this can't be switched on and proposes " +
      "nothing. When one lands it will pull paid building-permit records for watched municipalities and propose " +
      "renovation & restoration opportunities, billed as one metered lookup per municipality against your spend " +
      "cap. Read-only: it will only propose, never contact anyone.",
    availability: "planned",
    costTier: "metered",
    verticals: ["restoration", "home_services", "construction", "real_estate"],
    capability: {
      summary: "Emits permit-backed renovation/restoration opportunities for watched municipalities.",
      opportunityKinds: ["permit_filed"],
    },
    credentialSchema: {
      kind: "api_key",
      label: "Permit data API key",
      hint: "From your permit-data vendor. Stored encrypted in your Vault. Usage is billed per lookup — see Settings → Usage.",
    },
    authKind: "api_key",
    access: "read_only",
    mcpUrl: null,
    toolNamespace: "permit-data",
  },
  // --- import_source connectors (BSR-368). Read-IN: pull external records and
  //     write ONLY internal CRM rows via the gated lead-ingestion path. Run as an
  //     explicit operator action (runCrmImport), never on the auto-detection loop,
  //     never outbound. Behaviour lives in src/lib/integrations/{crm,enrichment}/. ---
  {
    key: "hubspot-import",
    kind: "import_source",
    label: "HubSpot CRM Import",
    description:
      "Read-only import: pulls your HubSpot contacts into CRM leads — persona-mapped and deduped on the HubSpot " +
      "record id (a re-import updates, never duplicates) — so Arc can work them. Uses your own HubSpot OAuth on " +
      "read-only contact scopes; it never writes back to HubSpot and never contacts anyone.",
    costTier: "byo_key",
    verticals: [],
    capability: {
      summary: "Imports HubSpot contacts as persona-mapped CRM leads, idempotent on the external id.",
      importsInto: ["companies", "contacts", "leads"],
    },
    credentialSchema: {
      kind: "oauth",
      label: "HubSpot account",
      hint: "Connect HubSpot (OAuth, read-only contacts scope) or paste a private-app token. Stored encrypted in your Vault; used read-only.",
    },
    authKind: "oauth",
    access: "read_only",
    mcpUrl: null,
    toolNamespace: "hubspot-import",
  },
  {
    key: "csv-import",
    kind: "import_source",
    label: "CSV Import",
    description:
      "Read-only import: paste or upload a CSV of contacts and Arc maps the columns to CRM leads — deduped on " +
      "email/phone (a re-import updates, never duplicates) — so you can work a spreadsheet without a CRM integration. " +
      "No account to connect; nothing goes back out. Every business has a list somewhere.",
    costTier: "free",
    // Universal — the lowest-friction way any business gets its contacts into Arc.
    verticals: [],
    capability: {
      summary: "Imports contacts from a pasted CSV as persona-mapped CRM leads, deduped on email/phone.",
      importsInto: ["companies", "contacts", "leads"],
    },
    credentialSchema: {
      kind: "none",
      hint: "No account to connect. Set a default persona for imported leads, then paste your CSV.",
    },
    // Leads carry a NOT NULL persona, so a default is required before an import can
    // run — same reason the reader stays "not connected" until it's set.
    requiredConfigKeys: ["defaultPersona"],
    authKind: "none",
    access: "read_only",
    mcpUrl: null,
    toolNamespace: "csv-import",
  },
  {
    key: "mailchimp-import",
    kind: "import_source",
    label: "Mailchimp Import",
    description:
      "Read-only import: pulls a Mailchimp audience into CRM leads — persona-mapped and deduped on the Mailchimp " +
      "member id (a re-import updates, never duplicates) — so Arc can work your email list. Uses your own Mailchimp " +
      "API key on read-only member access; it never writes back to Mailchimp and never contacts anyone.",
    costTier: "byo_key",
    verticals: [],
    capability: {
      summary: "Imports a Mailchimp audience's members as persona-mapped CRM leads, idempotent on the member id.",
      importsInto: ["contacts", "leads"],
    },
    credentialSchema: {
      kind: "api_key",
      label: "Mailchimp API key",
      hint: "From Mailchimp → Account → Extras → API keys (the '…-us21' form). Stored encrypted in your Vault; used read-only.",
    },
    // Leads carry a NOT NULL persona; the audience id is validated at import time.
    requiredConfigKeys: ["defaultPersona"],
    authKind: "api_key",
    access: "read_only",
    mcpUrl: null,
    toolNamespace: "mailchimp-import",
  },
  {
    key: "lead-enrichment",
    kind: "import_source",
    label: "Lead Enrichment",
    description:
      "Metered enrichment: augments imported companies with firmographics (employee count, revenue, industry) from " +
      "a data vendor on your own vendor credential, feeding account tiering + scoring. Billable — each lookup is " +
      "metered against your spend cap. Read-only: it only augments records, never contacts anyone.",
    costTier: "metered",
    verticals: [],
    capability: {
      summary: "Augments records with firmographic data used to tier + score accounts.",
      importsInto: ["companies"],
    },
    credentialSchema: {
      kind: "api_key",
      label: "Enrichment vendor API key",
      hint: "From your firmographic data vendor. Stored encrypted in your Vault. Usage is billed per lookup — see Settings → Usage.",
    },
    authKind: "api_key",
    access: "read_only",
    mcpUrl: null,
    toolNamespace: "lead-enrichment",
    // Needs BOTH the vendor key AND the endpoint to do anything — the runtime
    // provider is null without `config.endpoint` (see resolveEnrichmentProvider in
    // src/lib/connectors/import.ts). Gate the config half so a key-only setup reads
    // `not_configured` instead of a false "Connected" that silently no-ops.
    requiredConfigKeys: ["endpoint"],
  },
];

export function findConnector(key: string): ConnectorRegistryEntry | null {
  return CONNECTOR_REGISTRY.find((entry) => entry.key === key) ?? null;
}

/** Catalog entries of a given kind (mcp_tool / signal_source / channel). */
export function listConnectorsByKind(kind: ConnectorKind): ConnectorRegistryEntry[] {
  return CONNECTOR_REGISTRY.filter((entry) => entry.kind === kind);
}

/**
 * Whether a stored credential is required before this connector can go
 * `connected`. `none` schemas and `optional` credentials need nothing — those
 * connectors can be enabled with no Vault secret (e.g. a public signal source).
 */
export function connectorRequiresCredential(entry: Pick<ConnectorRegistryEntry, "credentialSchema">): boolean {
  return entry.credentialSchema.kind !== "none" && !entry.credentialSchema.optional;
}

/** HYBRID cost model: free + byo_key bypass metering; metered is billed (BSR-372). */
export function bypassesMetering(costTier: ConnectorCostTier): boolean {
  return costTier === "free" || costTier === "byo_key";
}

/** Where a connector call's credential actually came from. */
export type ConnectorCredentialSource = "byo" | "platform" | "none";

/** True when the entry declares a platform key the deployment MAY provide. */
export function supportsPlatformCredits(entry: Pick<ConnectorRegistryEntry, "platformEnvVar">): boolean {
  return Boolean(entry.platformEnvVar);
}

/**
 * The cost tier a call actually runs under, given where its credential came
 * from. This is what metering must consume: a workspace key means the
 * workspace pays its provider directly (bypasses metering); the platform key
 * means WE pay, so the call is metered and spend-capped regardless of the
 * entry's static tier. No credential falls back to the static tier (free
 * connectors run; credentialed ones will refuse upstream).
 */
export function effectiveCostTier(
  entry: Pick<ConnectorRegistryEntry, "costTier">,
  source: ConnectorCredentialSource,
): ConnectorCostTier {
  if (source === "byo") return "byo_key";
  if (source === "platform") return entry.costTier === "free" ? "free" : "metered";
  return entry.costTier;
}

/** True when the connector's required per-workspace config is actually filled in. */
export function connectorConfigSatisfied(
  entry: Pick<ConnectorRegistryEntry, "requiredConfigKeys">,
  config: Record<string, unknown> | null | undefined,
): boolean {
  const keys = entry.requiredConfigKeys ?? [];
  if (keys.length === 0) return true;
  const cfg = config ?? {};
  return keys.some((key) => {
    const value = cfg[key];
    if (value == null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });
}

/**
 * Operator-facing status, computed (never stored): a missing REQUIRED credential
 * always wins (not_configured); missing required config is the same kind of "you
 * haven't finished connecting this" and reports the same way; a disabled switch
 * beats test state; an untested but enabled connector is connected. Connectors that
 * need no credential (requiresCredential=false) skip the credential gate entirely,
 * and connectors with no required config skip the config gate.
 */
export function computeConnectorStatus(input: {
  credentialPresent: boolean;
  enabled: boolean;
  lastTestOk: boolean | null;
  /** Defaults true — the historical behaviour for credentialed connectors. */
  requiresCredential?: boolean;
  /** Defaults satisfied — only `false` gates, so connectors with no required config are unaffected. */
  configPresent?: boolean;
  /** Defaults "live" — an omitted value can't change an existing connector's status. */
  availability?: ConnectorAvailability;
  /** True when the deployment supplies a platform key for this connector — the
   *  credential requirement is satisfied without a stored workspace credential
   *  (platform-credits mode). Defaults false so BYO-only connectors are unaffected. */
  platformCredentialAvailable?: boolean;
}): ConnectorStatus {
  // Beats every other gate: there is nothing to configure your way out of. A stale
  // enabled=true row can't resurrect it either, which is the point — this is what
  // makes "not built" unreachable instead of merely discouraged.
  if (input.availability === "planned") return "unavailable";
  const requiresCredential = input.requiresCredential ?? true;
  if (requiresCredential && !input.credentialPresent && !input.platformCredentialAvailable) return "not_configured";
  if (input.configPresent === false) return "not_configured";
  if (!input.enabled) return "disabled";
  if (input.lastTestOk === false) return "error";
  return "connected";
}

/** True when the connector's external integration exists and it may be switched on. */
export function connectorIsAvailable(entry: Pick<ConnectorRegistryEntry, "availability">): boolean {
  return (entry.availability ?? "live") === "live";
}

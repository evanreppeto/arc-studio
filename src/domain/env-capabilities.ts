/**
 * What every environment variable is FOR, grouped by the capability it turns on
 * (BSR-480).
 *
 * `.env.example` lists ~65 variables with no indication of which are required
 * for which capability. The result is a failure shape this project keeps
 * repeating: a feature ships, looks live, and is silently inert because one flag
 * was never set in prod. The weather connector, Sentry, and the inbound email
 * receiver all shipped that way.
 *
 * THE POINT OF THIS FILE. It is the single declarative answer to "what is
 * switched off right now, and what breaks while it is?" — read by the operator
 * health console, by `pnpm diagnose:env`, and by `.env.example` itself. Adding a
 * capability means adding a row here, not threading a boolean through three
 * surfaces that then disagree.
 *
 * Values are NEVER read, only presence. Nothing here can leak a secret, which is
 * what lets the same catalogue serve a terminal, a page, and a doc.
 */

/**
 * How much a variable matters to its capability.
 *
 * `platform` is the one worth explaining: it describes the deployment rather
 * than a tenant's feature — source-map upload, who may see the admin console.
 * Those must not count against a capability's readiness, or every self-hosted
 * environment reads as broken for lacking our Sentry org.
 */
export type EnvRequirement = "required" | "optional" | "platform";

export type EnvVarSpec = {
  name: string;
  requirement: EnvRequirement;
  /** What happens while it is unset. Shown verbatim to an operator. */
  ifUnset: string;
  /** Other accepted names for the same value, read as a fallback. */
  aliases?: readonly string[];
};

export type CapabilitySpec = {
  key: string;
  label: string;
  /** What this capability does once it is live. */
  summary: string;
  vars: readonly EnvVarSpec[];
};

const v = (
  name: string,
  requirement: EnvRequirement,
  ifUnset: string,
  aliases?: readonly string[],
): EnvVarSpec => ({ name, requirement, ifUnset, aliases });

export const ENV_CAPABILITIES: readonly CapabilitySpec[] = [
  {
    key: "persistence",
    label: "Persistence",
    summary: "Everything the app stores and reads back.",
    vars: [
      v("NEXT_PUBLIC_SUPABASE_URL", "required", "Nothing persists — lead ingest returns 202 not_configured and every read-model degrades.", ["MARKETING_SUPABASE_URL", "NEXT_PUBLIC_MARKETING_SUPABASE_URL"]),
      v("SUPABASE_SERVICE_ROLE_KEY", "required", "No server-side write and no admin read succeeds.", ["MARKETING_SUPABASE_SERVICE_ROLE_KEY"]),
      v("NEXT_PUBLIC_SUPABASE_ANON_KEY", "required", "Browser-side auth cannot start a session.", ["MARKETING_SUPABASE_ANON_KEY", "NEXT_PUBLIC_MARKETING_SUPABASE_ANON_KEY"]),
    ],
  },
  {
    key: "auth",
    label: "Operator access",
    summary: "Who can reach the app, and who can administer the platform.",
    vars: [
      v("ARC_AUTH_MODE", "optional", "Falls back to the default gate. Set `supabase` on any shared deployment or screens are open.", ["AUTH_MODE"]),
      v("OPERATOR_ACCESS_TOKEN", "optional", "The legacy cookie gate stays off. Unset is correct for local dev, not for a shared host."),
      v("OPERATOR_EMAIL", "optional", "No credentials exist for the legacy operator gate, so nobody can pass it once it is armed."),
      v("OPERATOR_PASSWORD", "optional", "No credentials exist for the legacy operator gate, so nobody can pass it once it is armed."),
      v("OPERATOR_SUPPORT_EMAIL", "optional", "In-app help shows no support contact for operators to write to."),
      v("ARC_SELF_SERVE_SIGNUP", "optional", "Signup stays invite-only. Set to 1 only behind a completed launch checklist."),
      v("ARC_PLATFORM_ADMIN_EMAILS", "platform", "Nobody can see the health console or the waitlist — the gate fails closed."),
    ],
  },
  {
    key: "agent",
    label: "Agent loop",
    summary: "Arc receives work, thinks, and writes back.",
    vars: [
      v("ARC_AGENT_API_TOKEN", "required", "POST /api/v1/arc/runs refuses with 503 and the runner cannot call back in."),
      v("ARC_RUNNER_URL", "required", "Queued work is never picked up — the app has nowhere to wake the runner.", ["ARC_WEBHOOK_URL"]),
      v("ARC_WEBHOOK_SECRET", "optional", "Wake requests go unsigned. Set it anywhere the runner is reachable from the internet."),
      v("GEMINI_API_KEY", "required", "Arc's model calls and the Brain's embeddings both fail."),
      v("ARC_DISPLAY_NAME", "optional", "The attached agent is called \"Arc\" everywhere in the UI."),
    ],
  },
  {
    key: "embeddings",
    label: "Brain / semantic memory",
    summary: "Arc recalls what it has learned instead of starting cold.",
    vars: [
      v("GEMINI_API_KEY", "required", "Recall falls back to literal matching — the Brain contributes nothing semantic."),
      v("GEMINI_EMBEDDING_MODEL", "optional", "Uses the pinned default (gemini-embedding-2). The escape hatch if that model is retired."),
      v("BRAND_KNOWLEDGE_MODEL", "optional", "Brand document learning uses its default model."),
    ],
  },
  {
    key: "send",
    label: "Send loop",
    summary: "Approved outbound actually leaves, and engagement comes back.",
    vars: [
      v("ARC_SEND_ENABLED", "required", "Master kill switch. Dark means no mail leaves, however well configured everything else is."),
      v("RESEND_API_KEY", "required", "No transport. A per-workspace key in the Vault also satisfies this."),
      v("RESEND_FROM", "required", "Sends have no From identity and are rejected.", ["RESEND_FROM_EMAIL"]),
      v("RESEND_WEBHOOK_SECRET", "required", "Deliveries, opens, clicks and replies never arrive — sends look fire-and-forget and the journey timeline stays empty."),
      v("EMAIL_UNSUBSCRIBE_SECRET", "required", "Unsubscribe links cannot be signed or verified, which is a compliance failure, not a missing feature."),
      v("NEXT_PUBLIC_SITE_URL", "required", "Links inside sent mail have no absolute host to point at.", ["NEXT_PUBLIC_APP_URL", "EMAIL_EXPORT_SITE_URL"]),
      v("NEXT_PUBLIC_APP_URL", "optional", "Stripe Checkout and Portal return links are derived from the request host instead of a fixed one."),
      v("EMAIL_EXPORT_APP_NAME", "optional", "Exported auth email templates are branded \"Arc\" rather than this deployment's name."),
      v("EMAIL_EXPORT_LOGO_URL", "optional", "Exported auth email templates carry no logo."),
    ],
  },
  {
    key: "media",
    label: "Media generation",
    summary: "Arc drafts creative as approval-gated assets.",
    vars: [
      v("ARC_MEDIA_ENABLED", "optional", "The legacy deployment-wide path is off. Per-workspace connectors are the modern route and do not need this."),
      v("GEMINI_API_KEY", "required", "No image or video generation is possible on either path."),
      v("GEMINI_IMAGE_MODEL", "optional", "Uses the default photoreal model."),
      v("GEMINI_VIDEO_MODEL", "optional", "Uses the default Veo model."),
      v("GCS_BUCKET", "optional", "Reference-image upload is disabled; the attach button reports not configured."),
      v("GCS_SERVICE_ACCOUNT_KEY", "optional", "Same as GCS_BUCKET — both are needed for signed upload URLs."),
    ],
  },
  {
    key: "cron",
    label: "Scheduled work",
    summary: "Daily scans and notices run without a human.",
    vars: [
      v("CRON_SECRET", "required", "Every scheduled route rejects — nothing runs on a schedule."),
      v("OPPORTUNITY_SCAN_CRON_ENABLED", "optional", "The daily opportunity scan does not run."),
      v("BILLING_NOTICES_CRON_ENABLED", "optional", "Quota and trial-expiry notices are never sent."),
      v("OPPORTUNITY_AUTO_DRAFT_ENABLED", "optional", "The scan finds opportunities but never drafts from them."),
      v("OPPORTUNITY_AUTO_DRAFT_DRY_RUN", "optional", "Auto-draft writes for real. Set to 1 to log intended drafts without creating them."),
      v("ARC_OPPORTUNITY_CONFIDENCE_FLOOR", "optional", "Uses the default floor (50, with crm_inactivity held to 60). Raise it when an inbox is too noisy."),
    ],
  },
  {
    key: "billing",
    label: "Billing",
    summary: "Strangers can subscribe, and quotas mean something.",
    vars: [
      v("STRIPE_SECRET_KEY", "required", "Checkout, portal and webhook handling are all unavailable."),
      v("STRIPE_WEBHOOK_SECRET", "required", "Subscription events are never verified, so entitlements never sync after payment."),
      v("STRIPE_PRICE_STARTER", "required", "The Starter plan cannot be checked out."),
      v("STRIPE_PRICE_PRO", "required", "The Pro plan cannot be checked out."),
      v("STRIPE_PRICE_SCALE", "required", "The Scale plan cannot be checked out."),
      v("ARC_BILLING_ENFORCEMENT", "optional", "Quota overage is measured but never blocks work."),
    ],
  },
  {
    key: "connectors",
    label: "Connector OAuth",
    summary: "Tenants connect their own HubSpot, Google and Drive accounts.",
    vars: [
      v("HUBSPOT_CLIENT_ID", "optional", "The HubSpot connector falls back to the private-app-token form — no \"Connect with HubSpot\" button."),
      v("HUBSPOT_CLIENT_SECRET", "optional", "Same as HUBSPOT_CLIENT_ID — both are needed for the OAuth flow."),
      v("GOOGLE_CLIENT_ID", "optional", "No \"Connect with Google\" on the reviews connector."),
      v("GOOGLE_CLIENT_SECRET", "optional", "Same as GOOGLE_CLIENT_ID — both are needed for the OAuth flow."),
      v("GOOGLE_DRIVE_CLIENT_ID", "optional", "Drive import is unavailable; media must be uploaded by hand."),
      v("GOOGLE_DRIVE_CLIENT_SECRET", "optional", "Drive import is unavailable; the OAuth exchange cannot complete."),
      v("GOOGLE_DRIVE_PICKER_API_KEY", "optional", "The Drive file picker cannot open, so nothing can be selected."),
      v("GOOGLE_DRIVE_APP_ID", "optional", "The Drive file picker cannot open, so nothing can be selected."),
      v("GOOGLE_DRIVE_REDIRECT_URI", "optional", "Drive OAuth has nowhere to return to."),
      v("NWS_USER_AGENT", "optional", "The weather connector calls the National Weather Service unidentified, which they may throttle."),
    ],
  },
  {
    key: "social",
    label: "Social publishing",
    summary: "Approved posts can reach Meta, X and LinkedIn.",
    vars: [
      // All four Meta values are needed together — a partial set publishes
      // nothing and reports an auth error rather than a configuration one.
      v("META_APP_ID", "optional", "Meta publishing is unavailable; approved posts stay in the outbox."),
      v("META_APP_SECRET", "optional", "Meta publishing is unavailable; the app cannot authenticate."),
      v("META_PAGE_ID", "optional", "No Facebook Page to publish to, even with valid Meta credentials."),
      v("META_PAGE_ACCESS_TOKEN", "optional", "No Facebook Page authorisation; posts are rejected at send."),
      v("META_IG_USER_ID", "optional", "Instagram is not a publishable target; Facebook may still work."),
      v("X_API_KEY", "optional", "X publishing is unavailable; approved posts stay in the outbox."),
      v("X_API_SECRET", "optional", "X publishing is unavailable; the app cannot authenticate."),
      v("X_ACCESS_TOKEN", "optional", "X publishing has no authorised account to post as."),
      v("X_ACCESS_TOKEN_SECRET", "optional", "X publishing has no authorised account to post as."),
      v("LINKEDIN_ACCESS_TOKEN", "optional", "LinkedIn publishing is unavailable; approved posts stay in the outbox."),
      v("LINKEDIN_ORG_URN", "optional", "LinkedIn posts have no organisation to publish as."),
    ],
  },
  {
    key: "ingest",
    label: "Inbound APIs",
    summary: "External systems can push leads, results and media in.",
    vars: [
      v("LEADS_INGEST_API_TOKEN", "optional", "POST /api/v1/leads/ingest stays OPEN. Unset is a dev convenience and a hole on a shared host."),
      v("CAMPAIGN_RESULTS_API_TOKEN", "optional", "POST /api/v1/campaigns/results stays open."),
      v("MEDIA_INGEST_API_TOKEN", "optional", "POST /api/v1/media stays open. Required once Supabase persistence is configured."),
    ],
  },
  {
    key: "observability",
    label: "Observability",
    summary: "A failure reaches a human instead of a log nobody reads.",
    vars: [
      v("NEXT_PUBLIC_SENTRY_DSN", "required", "Errors land nowhere a human looks — the SDK is inert without it."),
      v("ALERT_SLACK_WEBHOOK_URL", "required", "Primary-surface and runner failures are recorded but nobody is paged. This is the state that let a broken campaigns board sit unnoticed for hours."),
      v("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "optional", "Events are not separated by environment, so prod and preview noise mix."),
      v("NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE", "optional", "Tracing stays off. Blank is treated as unset, not as zero."),
      v("SENTRY_AUTH_TOKEN", "platform", "Source maps are not uploaded, so stack traces stay minified."),
      v("SENTRY_ORG", "platform", "Source-map upload cannot resolve the org."),
      v("SENTRY_PROJECT", "platform", "Source-map upload cannot resolve the project."),
    ],
  },
  {
    key: "site",
    label: "Search verification",
    summary: "Search consoles can confirm we own the marketing domain.",
    vars: [
      v("GOOGLE_SITE_VERIFICATION", "platform", "The Google ownership meta tag is omitted, so Search Console cannot verify the domain."),
      v("BING_SITE_VERIFICATION", "platform", "The Bing ownership meta tag is omitted, so Webmaster Tools cannot verify the domain."),
    ],
  },
  {
    key: "preview",
    label: "Demo & preview",
    summary: "Sales demos and the backend-less local preview.",
    vars: [
      v("ARC_DEMO_DATA", "optional", "Screens show real (possibly empty) data. Set to 1 ONLY for demos and local preview — it substitutes fixtures for empty state."),
      v("ARC_DEMO_INDUSTRY", "optional", "The demo tenant uses its default industry vocabulary rather than a chosen one."),
      v("DEFAULT_ORG_SLUG", "optional", "Cosmetic: names the synthetic org in the offline demo. It does NOT select a tenant."),
    ],
  },
];

export type CapabilityState = "ready" | "partial" | "inert";

export type CapabilityReport = {
  key: string;
  label: string;
  summary: string;
  state: CapabilityState;
  /** Required vars that are unset — the reason it is not ready. */
  missingRequired: EnvVarSpec[];
  /** Optional vars that are unset — worth knowing, never a failure. */
  missingOptional: EnvVarSpec[];
  /** Deployment-level vars that are unset. Never affects `state`. */
  missingPlatform: EnvVarSpec[];
  /** One operator-readable line: what is off, and what that costs. */
  detail: string;
};

export type EnvLike = Record<string, string | undefined>;

/** Present and non-blank. A blank value is unset — `Number("")` is 0, and so on. */
export function isEnvVarSet(env: EnvLike, spec: EnvVarSpec): boolean {
  const names = [spec.name, ...(spec.aliases ?? [])];
  return names.some((name) => (env[name] ?? "").trim().length > 0);
}

function describe(state: CapabilityState, missingRequired: EnvVarSpec[]): string {
  if (state === "ready") return "Every required variable is set.";
  const names = missingRequired.map((s) => s.name).join(", ");
  return state === "inert"
    ? `Switched off — nothing is set (${names}).`
    : `Partly configured — missing ${names}.`;
}

/**
 * Grade one capability from what is present.
 *
 * `partial` is deliberately its own state rather than being folded into
 * `inert`: half-configured is the more dangerous of the two, because the app
 * often looks like it is working. Sending with a key but no webhook secret is
 * exactly that — mail leaves and nothing comes back.
 */
export function reportCapability(env: EnvLike, spec: CapabilitySpec): CapabilityReport {
  const missingRequired = spec.vars.filter((s) => s.requirement === "required" && !isEnvVarSet(env, s));
  const missingOptional = spec.vars.filter((s) => s.requirement === "optional" && !isEnvVarSet(env, s));
  const missingPlatform = spec.vars.filter((s) => s.requirement === "platform" && !isEnvVarSet(env, s));

  const required = spec.vars.filter((s) => s.requirement === "required");
  const state: CapabilityState =
    missingRequired.length === 0
      ? "ready"
      : missingRequired.length === required.length
        ? "inert"
        : "partial";

  return {
    key: spec.key,
    label: spec.label,
    summary: spec.summary,
    state,
    missingRequired,
    missingOptional,
    missingPlatform,
    detail: describe(state, missingRequired),
  };
}

export function reportCapabilities(env: EnvLike): CapabilityReport[] {
  return ENV_CAPABILITIES.map((spec) => reportCapability(env, spec));
}

/** Every variable the catalogue knows about, deduped. For coverage checks. */
export function allKnownEnvVars(): string[] {
  const names = new Set<string>();
  for (const capability of ENV_CAPABILITIES) {
    for (const spec of capability.vars) {
      names.add(spec.name);
      for (const alias of spec.aliases ?? []) names.add(alias);
    }
  }
  return [...names].sort();
}

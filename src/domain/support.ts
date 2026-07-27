// Support requests — the in-app "something's broken / I need a human" path.
//
// Pure domain: validation, labels, and the exact shape of the notification
// email. The category/impact/status keys below are mirrored by CHECK
// constraints in supabase/migrations/20260727120000_support_requests.sql — keep
// the two in sync (a value that passes here but fails the constraint is a 500
// that no mocked test can see).

export type SupportCategory = "bug" | "question" | "feature" | "billing" | "other";
export type SupportImpact = "blocking" | "slowing" | "minor";
export type SupportStatus = "open" | "acknowledged" | "resolved" | "closed";

export const SUPPORT_CATEGORIES: { key: SupportCategory; label: string; hint: string }[] = [
  { key: "bug", label: "Something's broken", hint: "A page, button, or number that isn't behaving" },
  { key: "question", label: "How do I…", hint: "You're stuck on how something works" },
  { key: "feature", label: "Feature request", hint: "Something you wish Arc could do" },
  { key: "billing", label: "Billing & account", hint: "Plan, invoices, seats, access" },
  { key: "other", label: "Something else", hint: "Anything that doesn't fit above" },
];

export const SUPPORT_IMPACTS: { key: SupportImpact; label: string; hint: string }[] = [
  { key: "blocking", label: "Blocking me", hint: "I can't do the work at all" },
  { key: "slowing", label: "Slowing me down", hint: "There's a workaround, but it hurts" },
  { key: "minor", label: "Minor", hint: "Worth fixing, not urgent" },
];

export const SUPPORT_STATUSES: { key: SupportStatus; label: string; tone: "warn" | "blue" | "ok" | "muted" }[] = [
  { key: "open", label: "Open", tone: "warn" },
  { key: "acknowledged", label: "In progress", tone: "blue" },
  { key: "resolved", label: "Resolved", tone: "ok" },
  { key: "closed", label: "Closed", tone: "muted" },
];

const CATEGORY_KEYS = new Set<string>(SUPPORT_CATEGORIES.map((c) => c.key));
const IMPACT_KEYS = new Set<string>(SUPPORT_IMPACTS.map((i) => i.key));

export const SUPPORT_SUBJECT_MAX = 140;
export const SUPPORT_BODY_MAX = 6000;
const SUPPORT_BODY_MIN = 12;

export function supportCategoryLabel(key: string): string {
  return SUPPORT_CATEGORIES.find((c) => c.key === key)?.label ?? "Support request";
}

export function supportImpactLabel(key: string): string {
  return SUPPORT_IMPACTS.find((i) => i.key === key)?.label ?? "Slowing me down";
}

export function supportStatusMeta(key: string): { label: string; tone: "warn" | "blue" | "ok" | "muted" } {
  return SUPPORT_STATUSES.find((s) => s.key === key) ?? { label: "Open", tone: "warn" };
}

/** Whatever the client volunteers about its environment. Never trusted, never required. */
export type SupportDiagnostics = {
  pagePath?: string;
  userAgent?: string;
  viewport?: string;
  timezone?: string;
  appVersion?: string;
  capturedAt?: string;
};

export type SupportRequestInput = {
  category: string;
  impact: string;
  subject: string;
  body: string;
  diagnostics?: SupportDiagnostics;
};

export type NormalizedSupportRequest = {
  category: SupportCategory;
  impact: SupportImpact;
  subject: string;
  body: string;
  pagePath: string;
  diagnostics: SupportDiagnostics;
};

export type ParsedSupportRequest =
  | { ok: true; value: NormalizedSupportRequest }
  | { ok: false; error: string };

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** An in-app route only — never an absolute URL, so we don't store a stray host. */
function cleanPagePath(value: unknown): string {
  const path = clean(value, 200);
  return path.startsWith("/") && !path.startsWith("//") ? path : "";
}

function cleanDiagnostics(input: SupportDiagnostics | undefined): SupportDiagnostics {
  if (!input) return {};
  const out: SupportDiagnostics = {};
  const pagePath = cleanPagePath(input.pagePath);
  if (pagePath) out.pagePath = pagePath;
  const userAgent = clean(input.userAgent, 400);
  if (userAgent) out.userAgent = userAgent;
  const viewport = clean(input.viewport, 40);
  if (viewport) out.viewport = viewport;
  const timezone = clean(input.timezone, 80);
  if (timezone) out.timezone = timezone;
  const appVersion = clean(input.appVersion, 80);
  if (appVersion) out.appVersion = appVersion;
  const capturedAt = clean(input.capturedAt, 40);
  if (capturedAt) out.capturedAt = capturedAt;
  return out;
}

export function parseSupportRequest(input: SupportRequestInput): ParsedSupportRequest {
  const category = clean(input.category, 20);
  if (!CATEGORY_KEYS.has(category)) return { ok: false, error: "Pick what kind of help you need." };

  const impact = clean(input.impact, 20);
  if (!IMPACT_KEYS.has(impact)) return { ok: false, error: "Pick how much this is affecting you." };

  const subject = clean(input.subject, SUPPORT_SUBJECT_MAX);
  if (!subject) return { ok: false, error: "Add a one-line summary so we know what to look at." };

  const body = clean(input.body, SUPPORT_BODY_MAX);
  if (body.length < SUPPORT_BODY_MIN) {
    return { ok: false, error: "Add a bit more detail — what you did, and what happened instead." };
  }

  const diagnostics = cleanDiagnostics(input.diagnostics);
  return {
    ok: true,
    value: {
      category: category as SupportCategory,
      impact: impact as SupportImpact,
      subject,
      body,
      pagePath: diagnostics.pagePath ?? "",
      diagnostics,
    },
  };
}

/**
 * Short human-quotable handle for a request, derived from its uuid so it needs
 * no extra column or sequence. Shown to the submitter and used as the email
 * subject tag so a reply thread can be matched back to the row.
 */
export function supportReferenceCode(id: string): string {
  const compact = id.replace(/-/g, "").toUpperCase();
  return `ARC-${compact.slice(0, 6) || "000000"}`;
}

export type SupportEmailContext = {
  reference: string;
  request: NormalizedSupportRequest;
  workspaceName: string;
  orgId: string;
  submittedByEmail: string;
  submittedByName: string;
};

/** The notification that lands in the support inbox. Reply-to lives in the body — see notify.ts. */
export function formatSupportEmail(ctx: SupportEmailContext): {
  subject: string;
  heading: string;
  bodyBlocks: string[];
} {
  const { request } = ctx;
  const who = ctx.submittedByName
    ? `${ctx.submittedByName} (${ctx.submittedByEmail || "no email on file"})`
    : ctx.submittedByEmail || "an operator with no email on file";

  const facts = [
    `Workspace: ${ctx.workspaceName}`,
    `From: ${who}`,
    `Type: ${supportCategoryLabel(request.category)}`,
    `Impact: ${supportImpactLabel(request.impact)}`,
    request.pagePath ? `Page: ${request.pagePath}` : "",
    request.diagnostics.appVersion ? `Build: ${request.diagnostics.appVersion}` : "",
    request.diagnostics.viewport ? `Viewport: ${request.diagnostics.viewport}` : "",
    request.diagnostics.timezone ? `Timezone: ${request.diagnostics.timezone}` : "",
    request.diagnostics.userAgent ? `Browser: ${request.diagnostics.userAgent}` : "",
    `Org: ${ctx.orgId}`,
  ].filter(Boolean);

  return {
    subject: `[${ctx.reference}] ${supportCategoryLabel(request.category)} — ${request.subject}`,
    heading: request.subject,
    bodyBlocks: [request.body, facts.join("\n"), `Reply to ${ctx.submittedByEmail || "the workspace owner"}.`],
  };
}

/**
 * `mailto:` fallback shown next to the form, pre-filled with the same context
 * the form would have captured. This is the path that still works when Supabase
 * or Resend isn't configured, so it must never depend on either.
 */
export function buildSupportMailto(input: {
  inbox: string;
  workspaceName: string;
  submittedByEmail: string;
  pagePath?: string;
  appVersion?: string;
}): string {
  const subject = `Arc support — ${input.workspaceName}`;
  const lines = [
    "What happened:",
    "",
    "",
    "What you expected instead:",
    "",
    "",
    "---",
    `Workspace: ${input.workspaceName}`,
    input.submittedByEmail ? `Account: ${input.submittedByEmail}` : "",
    input.pagePath ? `Page: ${input.pagePath}` : "",
    input.appVersion ? `Build: ${input.appVersion}` : "",
  ].filter(Boolean);
  return `mailto:${input.inbox}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
}

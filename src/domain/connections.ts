// Pure, deterministic logic for outbound connections (Resend + social).
// No I/O. Secrets live in env vars; this module never reads process.env.

export type ConnectionProvider = "resend" | "instagram" | "facebook" | "linkedin" | "x" | "google_drive";
export type ConnectionKind = "email" | "social" | "storage";

/** Derived status surfaced to operators — never persisted (see read-model). */
export type ConnectionStatus = "not_configured" | "disabled" | "error" | "connected";

export type ConnectionRegistryEntry = {
  provider: ConnectionProvider;
  kind: ConnectionKind;
  label: string;
  /** Primary env var shown in the UI (display only). Resend uses its single key. */
  envVar: string | null;
  /** All env vars that must be present for the connection to count as configured. */
  requiredEnvVars: string[];
};

/** Canonical list of connectable providers. Seeded into the `connections` table. */
export const CONNECTION_REGISTRY: ConnectionRegistryEntry[] = [
  { provider: "resend", kind: "email", label: "Resend", envVar: "RESEND_API_KEY", requiredEnvVars: ["RESEND_API_KEY"] },
  {
    provider: "google_drive",
    kind: "storage",
    label: "Google Drive",
    envVar: "GOOGLE_DRIVE_CLIENT_ID",
    requiredEnvVars: ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET"],
  },
  {
    provider: "instagram",
    kind: "social",
    label: "Instagram",
    envVar: "META_PAGE_ACCESS_TOKEN",
    requiredEnvVars: ["META_APP_ID", "META_APP_SECRET", "META_IG_USER_ID", "META_PAGE_ACCESS_TOKEN"],
  },
  {
    provider: "facebook",
    kind: "social",
    label: "Facebook",
    envVar: "META_PAGE_ACCESS_TOKEN",
    requiredEnvVars: ["META_APP_ID", "META_APP_SECRET", "META_PAGE_ID", "META_PAGE_ACCESS_TOKEN"],
  },
  {
    provider: "linkedin",
    kind: "social",
    label: "LinkedIn",
    envVar: "LINKEDIN_ACCESS_TOKEN",
    requiredEnvVars: ["LINKEDIN_ACCESS_TOKEN", "LINKEDIN_ORG_URN"],
  },
  {
    provider: "x",
    kind: "social",
    label: "X",
    envVar: "X_API_KEY",
    requiredEnvVars: ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"],
  },
];

/**
 * Pure: which of a provider's required env vars are missing or blank in `env`.
 * Empty result ⇒ fully configured. Unknown provider ⇒ [] (callers only pass
 * registry providers). Used by the read-model (status) and the social test action.
 */
export function missingRequiredEnvVars(
  provider: ConnectionProvider,
  env: Record<string, string | undefined>,
): string[] {
  const entry = CONNECTION_REGISTRY.find((candidate) => candidate.provider === provider);
  if (!entry) return [];
  return entry.requiredEnvVars.filter((name) => !env[name]?.trim());
}

/**
 * Compute the operator-facing status from the env secret presence, the operator
 * kill-switch, and the last connection-test result. Precedence: a missing secret
 * always wins (not_configured); a disabled switch beats test state; an untested
 * connection (lastTestOk null) is treated as connected once enabled.
 */
export function computeConnectionStatus(input: {
  envPresent: boolean;
  enabled: boolean;
  lastTestOk: boolean | null;
}): ConnectionStatus {
  if (!input.envPresent) return "not_configured";
  if (!input.enabled) return "disabled";
  if (input.lastTestOk === false) return "error";
  return "connected";
}

export type ResendEmailInput = {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
};

export type ResendEmailPayload = {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  /**
   * Extra SMTP headers. Carries List-Unsubscribe / List-Unsubscribe-Post, which
   * Gmail and Yahoo require of bulk senders — mail without them gets filtered
   * regardless of content.
   */
  headers?: Record<string, string>;
};

/**
 * Pure: validate + normalize an email into a Resend `POST /emails` body. Throws on
 * missing required fields so the executor records a clean failure rather than
 * handing Resend a malformed request.
 */
export function buildResendEmailPayload(input: ResendEmailInput): ResendEmailPayload {
  const from = input.from?.trim();
  if (!from) throw new Error("buildResendEmailPayload: from is required.");

  const recipients = (Array.isArray(input.to) ? input.to : [input.to])
    .map((address) => address?.trim())
    .filter((address): address is string => Boolean(address));
  if (recipients.length === 0) throw new Error("buildResendEmailPayload: at least one recipient is required.");

  const subject = input.subject?.trim();
  if (!subject) throw new Error("buildResendEmailPayload: subject is required.");

  const html = input.html?.trim();
  const text = input.text?.trim();
  if (!html && !text) throw new Error("buildResendEmailPayload: an html or text body is required.");

  const headers = Object.fromEntries(
    Object.entries(input.headers ?? {}).filter(([key, value]) => key.trim() && value?.trim()),
  );

  return {
    from,
    to: recipients,
    subject,
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
  };
}

/** Stable idempotency key for an outbound dispatch — same inputs, same key. */
export function resolveDispatchIdempotencyKey(parts: {
  provider: string;
  channel: string;
  approvalItemId: string;
}): string {
  return `${parts.provider}:${parts.channel}:${parts.approvalItemId}`;
}

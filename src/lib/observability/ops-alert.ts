import { postSlackWebhook } from "@/lib/integrations/slack/notify";

/**
 * Platform failure alerts to a Slack Incoming Webhook (BSR-477).
 *
 * Sentry's Slack integration is a paid add-on, so this bypasses Sentry for
 * ALERTING while keeping it as the error RECORD. Different jobs: Sentry answers
 * "what broke and where", Slack answers "somebody look now". Sentry was only
 * ever the convenient middleman between them.
 *
 * ⚠️ NOT the `slack-alerts` connector. That one is per-workspace and
 * operator-triggered — a TENANT's own webhook, posting opportunity summaries
 * when someone clicks a button. Routing platform failures through it would send
 * our ops noise into a customer's Slack. This reads a platform env var and is
 * never workspace-scoped.
 *
 * Unset env var = no-op, like every other integration here.
 */

const WEBHOOK_ENV = "ALERT_SLACK_WEBHOOK_URL";

/**
 * How long the same scope stays quiet after alerting.
 *
 * The failure this exists for is a query breaking on EVERY request — exactly
 * the shape that turns an alert channel into 10,000 identical messages, which
 * is how real alerts get ignored. One message per scope per window; Sentry
 * still has every occurrence.
 *
 * In-memory, so it resets on deploy and is per-instance. That is deliberate:
 * a durable cross-instance lock would need a DB write on the failure path,
 * which is the last place to add a dependency that can itself fail.
 */
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

const lastAlertedAt = new Map<string, number>();

/** Exported for tests — there is no other reason to reach into the state. */
export function __resetOpsAlertCooldown(): void {
  lastAlertedAt.clear();
}

export type OpsAlert = {
  /** What failed, in code terms — matches reportDegraded's scope. */
  scope: string;
  /** One line a human reads at 2am. */
  message: string;
  /** Ids and flags only — never record contents. */
  detail?: Record<string, string | number | boolean | null | undefined>;
  /** Where it came from, for the channel prefix. */
  source?: "app" | "runner" | "cron";
};

function shouldAlert(scope: string, now: number): boolean {
  const previous = lastAlertedAt.get(scope);
  if (previous !== undefined && now - previous < ALERT_COOLDOWN_MS) return false;
  lastAlertedAt.set(scope, now);
  return true;
}

/**
 * Post a failure to the ops channel. Never throws and never rejects — an
 * alerting failure must not become the outage the caller was already absorbing.
 *
 * Returns whether a post was attempted, which is what tests assert on. Callers
 * should not await this on a request path; fire and forget.
 */
export async function alertOpsFailure(alert: OpsAlert, opts: { now?: number } = {}): Promise<boolean> {
  try {
    const url = process.env[WEBHOOK_ENV]?.trim();
    if (!url) return false;

    const now = opts.now ?? Date.now();
    if (!shouldAlert(alert.scope, now)) return false;

    const source = alert.source ?? "app";
    const detail = alert.detail
      ? Object.entries(alert.detail)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v]) => `${k}=${v}`)
          .join(" · ")
      : "";

    // Plain text, not Block Kit: this has to render in a phone notification.
    const text = [
      `:rotating_light: *${source}* failure — \`${alert.scope}\``,
      alert.message,
      detail || null,
      `_Muted for ${ALERT_COOLDOWN_MS / 60000}m; Sentry has every occurrence._`,
    ]
      .filter(Boolean)
      .join("\n");

    await postSlackWebhook(url, { text });
    return true;
  } catch {
    // Swallowed on purpose. See the doc comment.
    return false;
  }
}

/** True when the platform webhook is configured — for the health console. */
export function isOpsAlertingConfigured(): boolean {
  return Boolean(process.env[WEBHOOK_ENV]?.trim());
}

import * as Sentry from "@sentry/nextjs";

import { isSentryEnabled } from "./sentry-options";
import { alertOpsFailure } from "./ops-alert";

// Report a failure the app deliberately absorbed (BSR-542 / BSR-543).
//
// The pattern this exists for: a read-model or page catches an error and
// degrades to an empty/null shape so one broken query can't take down a screen.
// That is usually the right call for the USER — but it makes the failure
// invisible to everyone else. A caught error is, by definition, not reported by
// Sentry's automatic instrumentation, so a query can fail on every request for
// days while the page looks merely empty.
//
// That is this project's defining failure mode. On 2026-07-28 a missing column
// took the campaigns board to "0 packages" for every org, and nothing anywhere
// said so — it took a wrong-turn investigation into the org resolver to find.
//
// So: keep degrading, but stop doing it quietly.

export type DegradedContext = {
  /** What failed, in code terms — e.g. "campaigns.getCampaignWorkspaceList". */
  scope: string;
  /** Whether this read is the primary content of a screen. */
  surface?: "primary" | "secondary";
  /** Anything that helps diagnose without carrying customer content. */
  detail?: Record<string, string | number | boolean | null | undefined>;
};

/**
 * Record a swallowed failure. Never throws — a reporting failure must not become
 * the outage the caller was avoiding.
 *
 * Deliberately takes no PII: `detail` is for ids and flags, not record contents.
 * The message and stack come from the error itself, which for a Postgres error
 * is the column/constraint name — exactly what's needed and nothing more.
 */
export function reportDegraded(error: unknown, context: DegradedContext): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error));

    if (isSentryEnabled) {
      Sentry.captureException(err, {
        level: context.surface === "primary" ? "error" : "warning",
        tags: {
          degraded: "true",
          scope: context.scope,
          surface: context.surface ?? "secondary",
        },
        extra: context.detail ?? {},
      });
    }

    // Always leave a server-log trace too. Sentry may be unconfigured (local,
    // CI, a preview), and that is exactly when someone is most likely to be
    // staring at a mysteriously empty screen.
    console.warn(
      `[degraded] ${context.scope}: ${err.message}`,
      context.detail ? JSON.stringify(context.detail) : "",
    );

    // Page a human, but only for PRIMARY surfaces (BSR-477).
    //
    // A secondary panel degrading is a thing to fix on a weekday; the primary
    // content of a screen degrading is the 2am case this whole mechanism was
    // built for. Alerting on both would put the loud one in a channel people
    // have learned to scroll past — which is worse than not alerting at all.
    //
    // Deliberately not awaited: this runs on a request path the caller is
    // already trying to keep alive, and alertOpsFailure never rejects.
    if (context.surface === "primary") {
      void alertOpsFailure({
        scope: context.scope,
        message: err.message,
        detail: context.detail,
        source: "app",
      });
    }
  } catch {
    // Intentionally silent: reporting is best-effort by construction.
  }
}

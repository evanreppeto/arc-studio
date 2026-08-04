/**
 * Keep the reason when a page-level read fails (BSR-546).
 *
 * The repo-wide pattern is `.catch(() => ({ status: "unavailable" }))` — which
 * discards WHY, so a broken query and an empty workspace become the same thing.
 * On `/campaigns` that hid a live prod outage for hours behind a board reading
 * "0 packages", while the twice-daily guardrail stayed green (BSR-542, BSR-545).
 *
 * This is the shared replacement:
 *
 *   getPerformanceReadModel(...).catch(unavailable("analytics.performance", ctx.orgId))
 *
 * It preserves the message for the view to render, and logs server-side with the
 * org id so a failure is findable even before any UI distinguishes the states.
 */

import { reportDegraded } from "./report-degraded";

export type UnavailableResult = {
  status: "unavailable";
  /** Why it failed. Safe to show an operator; never contains a credential. */
  message: string;
};

/**
 * "There is no backend here", which is an ANSWER, not an outage.
 *
 * This file already warned against using `unavailable` for it — *"Not for
 * legitimate non-failures — 'not configured', 'not found' — which are answers,
 * not outages, and would only train people to ignore the alert"* — and then two
 * read models did exactly that, because `unavailable` was the only status on
 * offer. `/analytics` showed a red **"Some analytics couldn't load"** banner in
 * every backend-less preview, naming a query that had never run and could not
 * have failed (BSR-546 follow-up).
 *
 * A banner that cries wolf is how the next real outage gets ignored, so the two
 * cases get two statuses. `reasonIfUnavailable` returns null for this one.
 */
export type NotConfiguredResult = { status: "not_configured" };

/**
 * Use in the `if (!isSupabaseAdminConfigured())` guard at the top of a read
 * model, in place of returning `unavailable`.
 *
 * Deliberately silent: there is nothing to report. Nothing broke, nothing is
 * degraded, and logging it would bury the failures that matter under one line
 * per read per request in local development.
 */
export function notConfigured(): NotConfiguredResult {
  return { status: "not_configured" };
}

/**
 * Build a `.catch` handler that records the failure instead of erasing it.
 *
 * @param label  what failed, for the log line — e.g. "analytics.performance"
 * @param orgId  whose data it was, so a tenant-specific failure is traceable
 */
export function unavailable(label: string, orgId?: string | null) {
  return (error: unknown): UnavailableResult => {
    const message = error instanceof Error ? error.message : `${label} is unavailable.`;
    // Deliberately noisy. An operator looking at an empty screen should be able
    // to find something; silence is what made the campaigns outage invisible.
    console.error(`[${label}] read failed for org ${orgId ?? "unknown"}: ${message}`);
    return { status: "unavailable", message };
  };
}

/**
 * The read-model's own version of the above, for failures that never reach a
 * page's `.catch` (BSR-547).
 *
 * `unavailable()` builds a `.catch` handler, so it only ever sees a THROWN
 * error. A read-model that catches internally and RETURNS
 * `{ status: "unavailable" }` — which is the shape most of them use — bypasses
 * it entirely. On the Brain that meant 20 of 22 failure returns reported
 * nothing at all: no log, no Sentry, no org. A PostgREST error there produced
 * an empty screen and total silence, which is the exact failure this project
 * keeps rediscovering.
 *
 * Call this at the point of failure instead. It reports the org that was
 * ACTUALLY queried rather than one the page guessed, which is the whole reason
 * BSR-547 preferred this over resolving context again at the page layer.
 *
 * Not for legitimate non-failures — "not configured", "not found" — which are
 * answers, not outages, and would only train people to ignore the alert.
 */
export function unavailableRead(
  scope: string,
  orgId: string | null | undefined,
  error: unknown,
  options: { surface?: "primary" | "secondary"; fallbackMessage?: string } = {},
): UnavailableResult {
  const message = errorMessage(error) ?? options.fallbackMessage ?? `${scope} is unavailable.`;
  reportDegraded(error instanceof Error ? error : new Error(message), {
    scope,
    surface: options.surface ?? "secondary",
    // "unresolved" rather than "unknown": the org could not be determined, which
    // is a different and more actionable statement than the value being absent.
    detail: { orgId: orgId ?? "unresolved", ...postgrestDetail(error) },
  });
  return { status: "unavailable", message };
}

/**
 * Supabase hands back a plain `{ message, code, details, hint }` object, not an
 * Error. `String(thatObject)` is "[object Object]", so a naive conversion throws
 * away the one thing worth keeping — usually the missing column or constraint.
 */
function errorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return null;
}

function postgrestDetail(error: unknown): Record<string, string> {
  if (!error || typeof error !== "object") return {};
  const detail: Record<string, string> = {};
  for (const key of ["code", "hint"] as const) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === "string" && value) detail[key] = value;
  }
  return detail;
}

/** The reason a read failed, or null when it succeeded. For passing to a view. */
export function reasonIfUnavailable(result: { status: string; message?: string } | null | undefined): string | null {
  // `not_configured` falls out here with everything else that isn't a failure,
  // and that is the point — see NotConfiguredResult. Kept as an explicit early
  // return so the intent survives a future refactor of this predicate.
  if (!result || result.status === "not_configured") return null;
  if (result.status !== "unavailable") return null;
  return result.message?.trim() || "This data could not be loaded.";
}

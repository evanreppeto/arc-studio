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

export type UnavailableResult = {
  status: "unavailable";
  /** Why it failed. Safe to show an operator; never contains a credential. */
  message: string;
};

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

/** The reason a read failed, or null when it succeeded. For passing to a view. */
export function reasonIfUnavailable(result: { status: string; message?: string } | null | undefined): string | null {
  if (!result || result.status !== "unavailable") return null;
  return result.message?.trim() || "This data could not be loaded.";
}

import type { ArcClient } from "./arc-client";

/** Compact workspace snapshot the runner injects each turn (mirrors the app's WorkspaceSummary). */
export type WorkspaceSummary = {
  brandKit: "active" | "draft" | "none";
  connectors: { connected: number; total: number };
  mediaAvailable: number;
  pendingApprovals: number;
  personas: number;
  /**
   * Live record counts (BSR-678). Absent on an older app deploy, so optional.
   * A field is `null` when the count could not be read — which is NOT the same
   * as zero, and the prompt block says so rather than printing a confident 0.
   */
  records?: {
    contacts: number | null;
    companies: number | null;
    leads: number | null;
    campaigns: number | null;
  } | null;
  /**
   * Repeated dismissal patterns, already phrased as what to change (BSR-686).
   * Optional for the same reason as `records`: an older app deploy will not send
   * it. Absent and empty mean the same thing here — no block is rendered.
   */
  dismissalPatterns?: string[] | null;
  /**
   * The operator's recent corrections, verbatim (BSR-685). Optional for the
   * same reason as the fields above: an older app deploy will not send it.
   */
  recentCorrections?: string[] | null;
};

/**
 * Fetch the compact workspace snapshot for this turn. Returns null on any error
 * so a workspace outage never breaks a turn (mirrors resolveBusinessContext).
 */
export async function resolveWorkspaceSummary(client: ArcClient): Promise<WorkspaceSummary | null> {
  try {
    const res = await client.apiGet<{ workspace: WorkspaceSummary }>("/api/v1/arc/workspace");
    return res.workspace ?? null;
  } catch {
    return null;
  }
}

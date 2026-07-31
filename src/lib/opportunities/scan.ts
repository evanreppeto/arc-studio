import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { runSignalSourceDetection } from "@/lib/connectors/detection";

import {
  runColdLeadDetection,
  runCompetitorSignalDetection,
  runNextIterationDetection,
  runWeatherEventDetection,
} from "./detector";

/**
 * What one scan pass actually did.
 *
 * `filtered` counts candidates the confidence floor rejected — reported so a
 * scan that found plenty but surfaced none reads as "nothing cleared the bar"
 * rather than "nothing to find". It does NOT count candidates skipped by
 * per-subject dedup (already open, snoozed, or inside a dismissal cooldown);
 * those aren't new findings, they're work the operator has already seen.
 */
export type OpportunityScanSummary = { added: number; filtered: number };

/**
 * Run every deterministic opportunity detector for the current workspace, best-effort.
 * Shared by the operator "Scan" button (scanForOpportunitiesAction) and the scheduled
 * cron so both surface the same source-backed opportunities — cold CRM leads, ingested
 * weather alerts, captured competitor flights, and campaigns whose results warrant a
 * next iteration — plus every enabled signal_source connector.
 *
 * Read-only: detection never contacts anyone or drafts anything. Each source is
 * best-effort so one failing detector can't sink the others, and the whole pass is
 * idempotent (upsert per-subject dedup), which is what makes it safe to run daily.
 *
 * Scope: pass one explicitly, or omit it and the ambient request context is used
 * (an operator session for the "Scan" button). The scheduled cron MUST pass one —
 * a session-less caller cannot resolve a tenant once a second active org exists,
 * because fetchDefaultOrg deliberately refuses an ambiguous answer. Fanning out
 * across workspaces is runOpportunityScanAcrossWorkspaces below (BSR-626).
 */
export type OpportunityScanScope = { orgId: string; workspaceId: string | null };

export async function runDeterministicOpportunityScan(
  scope?: OpportunityScanScope,
): Promise<OpportunityScanSummary> {
  const swallow = () => null;
  // Connector detection needs the workspace id; the CRM/weather/competitor/next-
  // iteration detectors take the org explicitly when given one.
  const ctx = scope ?? (await getCurrentWorkspaceContext().catch(() => null));
  const orgId = ctx?.orgId;
  const [cold, weather, competitor, nextIteration, connectors] = await Promise.all([
    runColdLeadDetection(undefined, undefined, orgId).catch(swallow),
    runWeatherEventDetection(undefined, undefined, undefined, orgId).catch(swallow),
    runCompetitorSignalDetection(undefined, undefined, orgId).catch(swallow),
    runNextIterationDetection(undefined, orgId).catch(swallow),
    ctx?.workspaceId
      ? runSignalSourceDetection({ workspaceId: ctx.workspaceId, orgId: ctx.orgId }).catch(swallow)
      : Promise.resolve(null),
  ]);

  const summary = { added: 0, filtered: 0 };
  for (const res of [cold, weather, competitor, nextIteration]) {
    if (!res?.ok) continue;
    summary.added += res.count;
    summary.filtered += res.filtered ?? 0;
  }
  // Connector detection reports its own aggregate (`total`) across every enabled
  // signal source, so it folds in the same way.
  if (connectors?.ok) {
    summary.added += connectors.total;
    summary.filtered += connectors.filtered;
  }
  return summary;
}

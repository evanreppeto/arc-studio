import { type AgentTaskScope } from "@/lib/agent-tasks/scope";
import { reportDegraded } from "@/lib/observability/report-degraded";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { runScheduledAutoDraft, type AutoDraftRunSummary } from "./auto-draft";
import { enqueueOpportunityScanTask } from "./enqueue";
import { hasRecentOpportunityScan } from "./recent-scan";
import { runDeterministicOpportunityScan, type OpportunityScanSummary } from "./scan";

/**
 * Run the deterministic opportunity scan for EVERY active workspace (BSR-626).
 *
 * THE BUG THIS EXISTS TO FIX
 *
 * The scheduled scan used to rely on ambient tenant resolution. The cron is
 * unauthenticated, so the detectors resolved their org through
 * `getCurrentOrgId()` → `fetchDefaultOrg()`, which deliberately REFUSES when more
 * than one active organization exists — correctly, because a session-less caller
 * should not be handed somebody's tenant by guesswork.
 *
 * The refusal was then swallowed by the scan's per-detector `.catch()`, so the
 * run reported `{ added: 0 }` and went green. The day a second tenant signed up,
 * automated opportunity detection would have stopped for everyone — including the
 * existing tenant — with nothing anywhere to say so. Self-serve signup is exactly
 * the event that creates that second tenant.
 *
 * So scope is now explicit and iterated rather than inferred.
 */

export type WorkspaceScanResult = {
  orgId: string;
  workspaceId: string;
  workspaceName: string;
  summary: OpportunityScanSummary | null;
  /** Auto-draft outcome for this tenant, when that stage ran. */
  autoDraft: AutoDraftRunSummary | null;
  /** Whether the generative Arc scan was enqueued for this tenant. */
  generativeQueued: boolean;
  /** Present when this workspace's pass threw; the others still ran. */
  error: string | null;
};

/**
 * Stages to run per tenant. The deterministic detectors always run; the other two
 * are opt-in so the operator "Scan" button can reuse the fan-out without also
 * drafting or queueing agent work.
 */
export type FanOutStages = {
  autoDraft?: boolean;
  generative?: boolean;
  /** Hours within which an existing generative scan counts as recent. */
  recentHours?: number;
};

export type FanOutSummary = {
  workspaces: number;
  scanned: number;
  failed: number;
  added: number;
  filtered: number;
  /** Tenants for which the generative Arc scan was queued this pass. */
  generativeQueued: number;
  results: WorkspaceScanResult[];
};

type WorkspaceRow = { id: string; org_id: string; name: string };

/**
 * Active workspaces belonging to active orgs.
 *
 * Both halves matter: a retired tenant should not be scanned, and neither should
 * a disabled workspace inside a live one. This mirrors how `fetchDefaultOrg`
 * decides what counts as a real tenant.
 */
async function listActiveWorkspaces(): Promise<WorkspaceRow[]> {
  const db = getSupabaseAdminClient();
  const { data, error } = await db
    .from("workspaces")
    .select("id, org_id, name, status, organizations!inner(status)")
    .eq("status", "active")
    .eq("organizations.status", "active");

  if (error) throw new Error(`listActiveWorkspaces failed: ${error.message}`);
  return ((data ?? []) as unknown as WorkspaceRow[]).map((w) => ({
    id: w.id,
    org_id: w.org_id,
    name: w.name,
  }));
}

/**
 * Scan every active workspace, one at a time.
 *
 * Sequential rather than parallel on purpose: each pass runs several detectors
 * and writes opportunities, and a hundred tenants fanned out at once would be a
 * self-inflicted load spike on a shared database for a job with no deadline.
 *
 * One workspace's failure never stops the others — it is recorded, reported, and
 * the loop continues. A tenant whose config is broken must not silently take
 * detection away from every healthy tenant, which is the failure this replaces.
 */
export async function runOpportunityScanAcrossWorkspaces(
  stages: FanOutStages = {},
): Promise<FanOutSummary> {
  const empty: FanOutSummary = {
    workspaces: 0,
    scanned: 0,
    failed: 0,
    added: 0,
    filtered: 0,
    generativeQueued: 0,
    results: [],
  };
  if (!isSupabaseAdminConfigured()) return empty;

  let workspaces: WorkspaceRow[];
  try {
    workspaces = await listActiveWorkspaces();
  } catch (error) {
    // Not an empty result — we could not find out. Reported so it cannot read as
    // "no workspaces to scan", which is what the old swallow produced.
    reportDegraded(error, { scope: "opportunities.fan-out", surface: "primary" });
    return { ...empty, failed: 1 };
  }

  const results: WorkspaceScanResult[] = [];
  let added = 0;
  let filtered = 0;
  let failed = 0;
  let generativeQueued = 0;

  for (const workspace of workspaces) {
    const scope = { orgId: workspace.org_id, workspaceId: workspace.id };
    try {
      const summary = await runDeterministicOpportunityScan(scope);
      added += summary.added;
      filtered += summary.filtered;

      // Draft from the backlog this and earlier passes built. Its own env flag
      // still gates it; the scope just makes it reach the right tenant.
      let autoDraft: AutoDraftRunSummary | null = null;
      if (stages.autoDraft) {
        autoDraft = await runScheduledAutoDraft(new Date(), { scope: agentScope(scope) });
      }

      // Queue the generative scan unless this tenant already had one recently.
      // Dedup is per-tenant, which is the whole point — one workspace's recent
      // scan must not suppress another's.
      let queued = false;
      if (stages.generative) {
        const recent = await hasRecentOpportunityScan(
          stages.recentHours ?? 20,
          undefined,
          agentScope(scope),
        );
        if (!recent) {
          const result = await enqueueOpportunityScanTask({
            operator: "Scheduled scan",
            scope: agentScope(scope),
          });
          queued = result.ok;
          if (!result.ok && result.error) throw new Error(result.error);
        }
      }
      if (queued) generativeQueued += 1;

      results.push({
        orgId: workspace.org_id,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        summary,
        autoDraft,
        generativeQueued: queued,
        error: null,
      });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      reportDegraded(error, {
        scope: "opportunities.fan-out",
        surface: "secondary",
        detail: { orgId: workspace.org_id, workspaceId: workspace.id },
      });
      results.push({
        orgId: workspace.org_id,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        summary: null,
        autoDraft: null,
        generativeQueued: false,
        error: message,
      });
    }
  }

  return {
    workspaces: workspaces.length,
    scanned: results.length - failed,
    failed,
    added,
    filtered,
    generativeQueued,
    results,
  };
}

/** The agent-task shape of a scan scope; workspaceId is non-null by construction here. */
function agentScope(scope: { orgId: string; workspaceId: string }): AgentTaskScope {
  return { orgId: scope.orgId, workspaceId: scope.workspaceId };
}

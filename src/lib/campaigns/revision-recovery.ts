import { type SupabaseClient } from "@supabase/supabase-js";

import { notifyArcCampaignTask } from "@/lib/arc-chat/notify";
import { getSupabaseAdminClient } from "../supabase/server";

/**
 * Recovery for campaign asset revisions that were recorded but never started.
 *
 * `agent_tasks` is a durable RECORD, not a durable queue: the wake POST is the
 * only thing that ever starts a task, and `arc-chat/inbox.ts` — the one poller
 * — filters `task_type = "arc_chat_message"`. So a `campaign_asset_revision`
 * whose wake was dropped (unreachable runner, 6s timeout, process restart
 * between the ack and the run) sits `queued` forever with nothing to re-surface
 * it. Three of them stranded on prod in a single afternoon; the operator saw
 * "revision requested" and never learned otherwise (BSR-695).
 *
 * This module is the missing half: find those rows, and let the operator send
 * them again.
 *
 * Re-dispatch is deliberately operator-initiated rather than an automatic
 * sweep. A revision spends real model budget, and the honest failure is one a
 * human can see and decide about — a background retry loop would hide the
 * underlying wake problem again, which is how this stayed invisible the first
 * time.
 */

/**
 * How long a task may sit `queued` before it counts as stranded.
 *
 * The runner claims a campaign task (queued -> running) as its first act, so
 * `queued` means "never started" rather than "started, still working". Ten
 * minutes is well beyond the claim round-trip and still leaves a wide margin if
 * a runner deploy lags the app's — a task that IS running must never be offered
 * for retry, because re-dispatching it would run the same instruction twice.
 */
export const STALLED_REVISION_MS = 10 * 60_000;

export type StalledRevision = {
  agentTaskId: string;
  /** The campaign asset the operator asked Arc to change. */
  assetId: string;
  /** What they asked for, so the retry affordance can name it. */
  instruction: string;
  requestedAt: string;
};

export type RedispatchResult =
  | { ok: true; dispatched: true }
  | { ok: true; dispatched: false; reason: "runner_unreachable" }
  | { ok: false; reason: "not_found" | "already_running" };

type TaskRow = {
  id: string;
  source_id: string | null;
  campaign_id: string | null;
  objective: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  status: string;
};

function assertOk(label: string, error: { message: string } | null) {
  if (error) throw new Error(`${label} failed: ${error.message}`);
}

function instructionOf(row: TaskRow): string {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  if (typeof meta.human_instruction === "string" && meta.human_instruction.trim()) {
    return meta.human_instruction;
  }
  return row.objective ?? "";
}

/**
 * Revision tasks for one campaign that are still `queued` past the cutoff.
 *
 * Org-scoped: `agent_tasks` is read with the service-role client, so this
 * `org_id` filter is the only thing keeping one workspace's stranded work out
 * of another's screen.
 */
export async function listStalledRevisions(
  input: { campaignId: string; orgId: string; staleMs?: number },
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<StalledRevision[]> {
  const cutoff = new Date(Date.now() - (input.staleMs ?? STALLED_REVISION_MS)).toISOString();

  const { data, error } = await client
    .from("agent_tasks")
    .select("id, source_id, campaign_id, objective, metadata, created_at, status")
    .eq("org_id", input.orgId)
    .eq("campaign_id", input.campaignId)
    .eq("task_type", "campaign_asset_revision")
    .eq("status", "queued")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true });
  assertOk("agent_tasks stalled-revision list", error);

  return ((data ?? []) as TaskRow[])
    // `source_id` is the campaign asset (source_type = "campaign_asset"). Without
    // it there is nothing to attach the retry to, so drop rather than guess.
    .filter((row): row is TaskRow & { source_id: string } => Boolean(row.source_id))
    .map((row) => ({
      agentTaskId: row.id,
      assetId: row.source_id,
      instruction: instructionOf(row),
      requestedAt: row.created_at,
    }));
}

/**
 * Send a stranded revision to the runner again.
 *
 * Re-reads the row under the org scope first and refuses anything not still
 * `queued`. That check is the whole safety property: a task that already moved
 * to `running` is in flight, and waking it again would run the operator's
 * instruction a second time. It does NOT write a new task — the original row is
 * reused, so retrying cannot fan out into duplicates however many times it is
 * pressed.
 */
export async function redispatchStalledRevision(
  input: { agentTaskId: string; orgId: string; operator: string },
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<RedispatchResult> {
  const { data, error } = await client
    .from("agent_tasks")
    .select("id, source_id, campaign_id, objective, metadata, created_at, status")
    .eq("id", input.agentTaskId)
    .eq("org_id", input.orgId)
    .eq("task_type", "campaign_asset_revision")
    .maybeSingle<TaskRow>();
  assertOk("agent_tasks retry lookup", error);

  if (!data) return { ok: false, reason: "not_found" };
  if (data.status !== "queued") return { ok: false, reason: "already_running" };
  if (!data.campaign_id || !data.source_id) return { ok: false, reason: "not_found" };

  const dispatched = await notifyArcCampaignTask({
    agentTaskId: data.id,
    campaignId: data.campaign_id,
    assetId: data.source_id,
    conversationId: null,
    message: instructionOf(data),
    operator: input.operator,
    taskType: "campaign_asset_revision",
  });

  if (!dispatched) {
    console.warn(
      `[campaigns] retry of revision task ${data.id} was not acknowledged by the runner. ` +
        "The task is still queued and can be retried again once the runner is reachable.",
    );
    return { ok: true, dispatched: false, reason: "runner_unreachable" };
  }

  return { ok: true, dispatched: true };
}

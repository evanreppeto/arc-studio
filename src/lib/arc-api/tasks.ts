import { type SupabaseClient } from "@supabase/supabase-js";

import {
  type NativeTaskStatus,
  type NormalizedTask,
  type OperatorDropTarget,
  canOperatorMoveTask,
  normalizeAgentTask,
  redactDeep,
  redactSecrets,
} from "@/domain";
import { type AgentTaskDetail, getAgentTaskDetail } from "@/lib/agent-operations/read-model";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Arc Operations API task layer. Reads normalize `agent_tasks` into the
 * agent-facing shape; writes are LIFECYCLE-ONLY (claim / log / complete /
 * block) and never touch approval status, decisions, or launch/dispatch locks.
 */

const TERMINAL_STATUSES = new Set(["completed", "failed", "canceled"]);

// `agent_tasks` has two FKs to `agents` (agent_id and driver_agent_id), so the
// embed must name the relationship or PostgREST fails with "more than one
// relationship was found". We embed the primary owning agent via agent_id.
const TASK_SELECT = "*, agents!agent_tasks_agent_id_fkey(key, name)";

type AgentJoin = { key: string | null; name: string | null } | null;

type TaskRow = {
  id: string;
  agent_id: string;
  // NOT NULL on agent_tasks, so this is always present on a read row. Child
  // agent_run_logs rows must carry it explicitly — that column has no default.
  org_id: string;
  objective: string | null;
  status: string | null;
  priority: string | null;
  campaign_id: string | null;
  approval_item_id: string | null;
  source_type: string | null;
  source_id: string | null;
  started_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  metadata: Record<string, unknown> | null;
  agents?: AgentJoin;
};

export type ListAgentTasksFilter = {
  status?: NativeTaskStatus;
  assignee?: string;
  limit?: number;
};

export type AgentTaskScope = {
  orgId: string;
  workspaceId: string;
};

export type TaskMutationResult =
  | { ok: true; task: NormalizedTask }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "conflict"; currentStatus: string };

function clampLimit(limit: number | undefined, fallback: number): number {
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) return fallback;
  return Math.min(limit, 100);
}

function rowToNormalized(row: TaskRow, latestLogError: string | null = null): NormalizedTask {
  return normalizeAgentTask({
    id: row.id,
    objective: row.objective,
    status: row.status,
    priority: row.priority,
    campaignId: row.campaign_id,
    approvalItemId: row.approval_item_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.metadata,
    agentKey: row.agents?.key ?? null,
    agentName: row.agents?.name ?? null,
    latestLogError,
  });
}

function applyAgentTaskScope<Query>(query: Query, scope?: AgentTaskScope): Query {
  if (!scope) return query;
  const scoped = query as {
    eq(column: string, value: string): { eq(column: string, value: string): Query };
  };
  return scoped.eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId);
}

async function readTaskRow(taskId: string, client: SupabaseClient, scope?: AgentTaskScope): Promise<TaskRow | null> {
  const query = applyAgentTaskScope(
    client.from("agent_tasks").select(TASK_SELECT).eq("id", taskId),
    scope,
  );
  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(`agent_tasks read failed: ${error.message}`);
  }
  return (data as TaskRow | null) ?? null;
}

export async function listAgentTasks(
  filter: ListAgentTasksFilter = {},
  client: SupabaseClient = getSupabaseAdminClient(),
  scope?: AgentTaskScope,
): Promise<NormalizedTask[]> {
  let agentId: string | undefined;
  if (filter.assignee) {
    // Org-filtered by hand rather than via applyAgentTaskScope, which also
    // filters workspace_id -- a column agents doesn't have. The filter matters:
    // agent keys are unique per org (20260716150000), so several tenants can
    // hold the same key and maybeSingle() would see more than one row.
    const agentQuery = client.from("agents").select("id").eq("key", filter.assignee);
    const { data: agentRow, error: agentErr } = await (scope
      ? agentQuery.eq("org_id", scope.orgId)
      : agentQuery
    ).maybeSingle();
    if (agentErr) {
      throw new Error(`listAgentTasks agent lookup failed: ${agentErr.message}`);
    }
    if (!agentRow) {
      // Unknown assignee -> no tasks rather than an unfiltered dump.
      return [];
    }
    agentId = (agentRow as { id: string }).id;
  }

  let query = applyAgentTaskScope(client.from("agent_tasks").select(TASK_SELECT), scope);
  if (filter.status) {
    query = query.eq("status", filter.status);
  }
  if (agentId) {
    query = query.eq("agent_id", agentId);
  }
  query = query.limit(clampLimit(filter.limit, 25));

  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) {
    throw new Error(`listAgentTasks failed: ${error.message}`);
  }

  const rows = (data ?? []) as TaskRow[];
  return rows.map((row) => rowToNormalized(row));
}

export type AgentTaskForApi = NormalizedTask & { detail: Extract<AgentTaskDetail, { status: "live" }> };

export type GetAgentTaskResult =
  | { ok: true; task: AgentTaskForApi }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "unavailable"; message: string };

export async function getAgentTaskForApi(
  taskId: string,
  client?: SupabaseClient,
  scope?: AgentTaskScope,
): Promise<GetAgentTaskResult> {
  if (scope) {
    const scopedTask = await readTaskRow(taskId, client ?? getSupabaseAdminClient(), scope);
    if (!scopedTask) {
      return { ok: false, reason: "not_found" };
    }
  }

  const detail = await getAgentTaskDetail(
    taskId,
    client,
    "Agent",
    scope ? { org_id: scope.orgId, workspace_id: scope.workspaceId } : undefined,
  );
  if (detail.status === "not_found") {
    return { ok: false, reason: "not_found" };
  }
  if (detail.status === "unavailable") {
    return { ok: false, reason: "unavailable", message: detail.message };
  }

  const latestLogError = detail.logs.find((log) => log.errorMessage)?.errorMessage ?? null;
  const task = normalizeAgentTask({
    id: detail.task.id,
    objective: detail.task.objective,
    status: detail.task.status,
    priority: detail.task.priority,
    campaignId: detail.task.campaignId,
    approvalItemId: detail.task.approvalItemId,
    sourceType: detail.task.sourceType,
    sourceId: detail.task.sourceId,
    createdAt: detail.task.createdAt,
    updatedAt: detail.task.updatedAt,
    metadata: detail.task.metadata,
    agentKey: detail.agent.key,
    agentName: detail.agent.name,
    latestLogError,
  });

  return { ok: true, task: { ...task, detail } };
}

async function updateAndNormalize(
  taskId: string,
  patch: Record<string, unknown>,
  client: SupabaseClient,
  scope?: AgentTaskScope,
): Promise<NormalizedTask> {
  const query = applyAgentTaskScope(
    client
    .from("agent_tasks")
    .update(patch)
      .eq("id", taskId),
    scope,
  );
  const { data, error } = await query
    .select(TASK_SELECT)
    .single();
  if (error) {
    throw new Error(`agent_tasks update failed: ${error.message}`);
  }
  return rowToNormalized(data as TaskRow);
}

/**
 * `updateAndNormalize` with a compare-and-set on `status`: the write only lands
 * if the row is STILL in `guardStatus`. Returns null when the guard misses,
 * which the caller reads as "someone else got there first" — not as an error.
 */
async function updateIfStatus(
  taskId: string,
  guardStatus: string,
  patch: Record<string, unknown>,
  client: SupabaseClient,
  scope?: AgentTaskScope,
): Promise<NormalizedTask | null> {
  const { data, error } = await applyAgentTaskScope(
    client.from("agent_tasks").update(patch).eq("id", taskId).eq("status", guardStatus),
    scope,
  )
    .select(TASK_SELECT)
    .maybeSingle();
  if (error) {
    throw new Error(`agent_tasks update failed: ${error.message}`);
  }
  return data ? rowToNormalized(data as TaskRow) : null;
}

/**
 * Claim a queued task for processing: queued -> running.
 *
 * The status guard makes this a compare-and-set, so two workers racing for the
 * same task — a wake push and an operator's Retry, say — can never both win.
 * It used to read the row, check `status === "queued"`, then update
 * unconditionally; between those two statements both callers saw `queued` and
 * both proceeded, which is a duplicate Arc run (and duplicate spend) on the
 * same instruction. The retry path in `revision-recovery.ts` depends on this
 * being atomic, since that is the whole basis for re-dispatching safely.
 */
export async function claimAgentTask(
  taskId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
  scope?: AgentTaskScope,
): Promise<TaskMutationResult> {
  const row = await readTaskRow(taskId, client, scope);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "queued") {
    return { ok: false, reason: "conflict", currentStatus: row.status ?? "unknown" };
  }
  const task = await updateIfStatus(
    taskId,
    "queued",
    { status: "running", started_at: new Date().toISOString() },
    client,
    scope,
  );
  // The guard missed: the row moved out of `queued` between the read above and
  // this write. Another worker owns it now.
  if (!task) return { ok: false, reason: "conflict", currentStatus: "running" };
  return { ok: true, task };
}

export async function completeAgentTask(
  taskId: string,
  opts: { summary?: string; metadata?: Record<string, unknown> } = {},
  client: SupabaseClient = getSupabaseAdminClient(),
  scope?: AgentTaskScope,
): Promise<TaskMutationResult> {
  const row = await readTaskRow(taskId, client, scope);
  if (!row) return { ok: false, reason: "not_found" };
  if (TERMINAL_STATUSES.has(row.status ?? "")) {
    return { ok: false, reason: "conflict", currentStatus: row.status ?? "unknown" };
  }
  const mergedMetadata: Record<string, unknown> = {
    ...(row.metadata ?? {}),
    ...(redactDeep(opts.metadata ?? {}) as Record<string, unknown>),
  };
  if (opts.summary) {
    mergedMetadata.completion_summary = redactSecrets(opts.summary);
  }
  const task = await updateAndNormalize(
    taskId,
    { status: "completed", completed_at: new Date().toISOString(), metadata: mergedMetadata },
    client,
    scope,
  );
  return { ok: true, task };
}

export async function blockAgentTask(
  taskId: string,
  opts: { reason: string; metadata?: Record<string, unknown> },
  client: SupabaseClient = getSupabaseAdminClient(),
  scope?: AgentTaskScope,
): Promise<TaskMutationResult> {
  const row = await readTaskRow(taskId, client, scope);
  if (!row) return { ok: false, reason: "not_found" };
  if (TERMINAL_STATUSES.has(row.status ?? "")) {
    return { ok: false, reason: "conflict", currentStatus: row.status ?? "unknown" };
  }
  const reason = redactSecrets(opts.reason);
  const mergedMetadata: Record<string, unknown> = {
    ...(row.metadata ?? {}),
    ...(redactDeep(opts.metadata ?? {}) as Record<string, unknown>),
    blocked_reason: reason,
  };
  const task = await updateAndNormalize(taskId, { status: "blocked", metadata: mergedMetadata }, client, scope);

  // Record the block on the run-log timeline (best-effort; the state change is
  // already persisted above, so a failed audit insert must not fail the block).
  // agent_id is NOT NULL on agent_run_logs.
  const { error: logError } = await client.from("agent_run_logs").insert({
    task_id: taskId,
    agent_id: row.agent_id,
    org_id: row.org_id,
    run_status: "failed",
    error_message: reason,
    reasoning_summary: "Arc blocked the task pending human input.",
  });
  if (logError) {
    console.warn(`block run-log insert failed (block already persisted): ${logError.message}`);
  }

  return { ok: true, task };
}

/**
 * Resolved (closed) approval states. Any approval whose status is NOT one of
 * these is still "open" and blocks completing the linked task from the board.
 * Inverting the list this way is safe-by-default: a newly added approval_status
 * enum value is treated as open until explicitly classified as resolved.
 */
const RESOLVED_APPROVAL_STATUSES = new Set(["approved", "declined", "rejected", "archived"]);

export type MoveTaskResult =
  | { ok: true; task: NormalizedTask }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "rejected"; code: string };

async function hasOpenApproval(
  approvalItemId: string | null,
  client: SupabaseClient,
): Promise<boolean> {
  if (!approvalItemId) return false;
  const { data, error } = await client
    .from("approval_items")
    .select("status")
    .eq("id", approvalItemId)
    .maybeSingle();
  if (error) {
    throw new Error(`approval_items lookup failed: ${error.message}`);
  }
  const status = (data as { status: string | null } | null)?.status ?? null;
  return status !== null && !RESOLVED_APPROVAL_STATUSES.has(status);
}

/**
 * Operator-driven board move (drag = immediate state change). Validates the
 * transition with the pure domain rule, applies status + timestamp updates,
 * and records an audit entry on the run-log timeline. Never touches approval
 * decisions or outbound locks.
 */
export async function moveAgentTask(
  taskId: string,
  toStatus: OperatorDropTarget,
  client: SupabaseClient = getSupabaseAdminClient(),
  scope?: AgentTaskScope,
): Promise<MoveTaskResult> {
  const row = await readTaskRow(taskId, client, scope);
  if (!row) return { ok: false, reason: "not_found" };

  const openApproval = await hasOpenApproval(row.approval_item_id, client);
  const check = canOperatorMoveTask(row.status ?? "queued", toStatus, { hasOpenApproval: openApproval });
  if (!check.ok) {
    return { ok: false, reason: "rejected", code: check.reason };
  }

  const patch: Record<string, unknown> = { status: toStatus };
  if (toStatus === "running" && !row.started_at) {
    patch.started_at = new Date().toISOString();
  }
  if (toStatus === "completed") {
    patch.completed_at = new Date().toISOString();
  }

  const task = await updateAndNormalize(taskId, patch, client, scope);

  // Audit log is best-effort: the status change above is the source of truth and
  // is already persisted, so a failed audit insert must not fail (or crash) the move.
  const { error: logError } = await client.from("agent_run_logs").insert({
    task_id: taskId,
    agent_id: row.agent_id,
    org_id: row.org_id,
    run_status: toStatus === "completed" ? "completed" : toStatus === "blocked" ? "failed" : "running",
    reasoning_summary: `Operator moved task to ${toStatus} from the board.`,
    metadata: { source: "operator_board_move", from_status: row.status, to_status: toStatus },
  });
  if (logError) {
    console.warn(`move run-log insert failed (move already persisted): ${logError.message}`);
  }

  return { ok: true, task };
}

export type AppendRunLogInput = {
  message?: string;
  reasoningSummary?: string;
  runStatus?: string;
  modelProvider?: string;
  modelName?: string;
  metadata?: Record<string, unknown>;
};

export type AppendRunLogResult = { ok: true; logId: string } | { ok: false; reason: "not_found" };

/**
 * Append a run-log entry to a task. Inserts into `agent_run_logs` ONLY — never
 * mutates `agent_tasks` (logging does not change task lifecycle state).
 */
export async function appendAgentRunLog(
  taskId: string,
  input: AppendRunLogInput,
  client: SupabaseClient = getSupabaseAdminClient(),
  scope?: AgentTaskScope,
): Promise<AppendRunLogResult> {
  const taskQuery = applyAgentTaskScope(
    client
    .from("agent_tasks")
    .select("agent_id, org_id")
      .eq("id", taskId),
    scope,
  );
  const { data: taskRow, error: taskErr } = await taskQuery
    .maybeSingle();
  if (taskErr) {
    throw new Error(`appendAgentRunLog task lookup failed: ${taskErr.message}`);
  }
  if (!taskRow) {
    return { ok: false, reason: "not_found" };
  }

  const task = taskRow as { agent_id: string; org_id: string };
  const rawSummary = input.reasoningSummary ?? input.message ?? null;
  const reasoningSummary = rawSummary === null ? null : redactSecrets(rawSummary);
  const { data, error } = await client
    .from("agent_run_logs")
    .insert({
      task_id: taskId,
      agent_id: task.agent_id,
      org_id: task.org_id,
      run_status: input.runStatus ?? "running",
      reasoning_summary: reasoningSummary,
      model_provider: input.modelProvider ?? null,
      model_name: input.modelName ?? null,
      metadata: redactDeep(input.metadata ?? {}) as Record<string, unknown>,
    })
    .select("id")
    .single();
  if (error) {
    throw new Error(`appendAgentRunLog insert failed: ${error.message}`);
  }
  return { ok: true, logId: (data as { id: string }).id };
}

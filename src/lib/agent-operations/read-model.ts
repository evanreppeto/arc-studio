import { type SupabaseClient } from "@supabase/supabase-js";
import { reportDegraded } from "@/lib/observability/report-degraded";

import { getCurrentAgentTaskTenantFields, type AgentTaskTenantFields } from "../agent-tasks/scope";
import { isDemoDataEnabled } from "../demo/demo-mode";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "../supabase/server";
import { buildDemoAgentOperationsDashboard } from "./demo";

const OPEN_TASK_STATUSES = new Set(["queued", "running", "needs_approval", "blocked"]);
const ACTIVE_APPROVAL_STATUSES = new Set([
  "needs_compliance",
  "needs_review",
  "pending_approval",
  "pending_owner_approval",
  "revision_requested",
]);

type AgentTaskActorKind = "human" | "agent" | "system";

type AgentTaskActor = {
  kind: AgentTaskActorKind;
  label: string;
};

type AgentTaskDriver = AgentTaskActor & {
  agentId: string | null;
};

export type AgentOperationsMetric = {
  label: string;
  value: number | string;
  delta: string;
};

export type AgentOperationsAgent = {
  key: string;
  name: string;
  purpose: string;
  status: string;
  currentTask: string;
  riskFlags: string[];
  href: string;
};

export type AgentOperationsTask = {
  id: string;
  fullId: string;
  agentKey: string;
  agentName: string;
  task: string;
  objective: string;
  linkedObject: string;
  linkedHref: string;
  /** Short campaign label for the card tag chip (additive; demo + live). */
  campaignLabel: string | null;
  /** Short persona label for the card meta line (additive; demo + live). */
  personaLabel: string | null;
  approvalHref: string | null;
  risk: string;
  approval: string;
  status: string;
  priority: string;
  dueAt: string | null;
  scheduledFor: string | null;
  progress: { done: number; total: number } | null;
  owner: AgentTaskActor;
  driver: AgentTaskDriver;
  approverLabel: string;
  description: string | null;
  updated: string;
  href: string;
};

export type ArcRunnerStatus = {
  configured: boolean;
  agentId: string | null;
  name: string;
  status: string;
  runner: string;
  mode: string;
  lastHeartbeat: string | null;
  queuedTasks: number;
  runningTasks: number;
  blockedTasks: number;
  approvalTasks: number;
  killSwitch: string;
  nextStep: string;
};

export type AgentOperationsApproval = {
  id: string;
  source: string;
  campaign: string;
  channel: string;
  status: string;
  risk: string;
  href: string;
};

export type AgentOperationsOutput = {
  output: string;
  agent: string;
  status: string;
  time: string;
};

export type AgentTaskOutput = {
  id: string;
  title: string;
  outputType: string;
  body: string;
  readableBody: string;
  structuredSections: Array<{ label: string; value: string }>;
  evidence: Array<{ label: string; href: string }>;
  media: Array<{ label: string; href: string; type: "image" | "video" | "file" | "link" }>;
  riskLevel: string;
  complianceStatus: string;
  approvalStatus: string;
  approvalHref: string | null;
  campaignAssetId: string | null;
  createdAt: string | null;
};

type AgentTaskTimelineItem = {
  id: string;
  source: "Human" | "Arc" | "System" | "Approval";
  title: string;
  body: string | null;
  createdAt: string | null;
  eventType: string;
};

export type AgentOperationsDashboard =
  | {
      status: "live";
      metrics: AgentOperationsMetric[];
      agents: AgentOperationsAgent[];
      tasks: AgentOperationsTask[];
      approvals: AgentOperationsApproval[];
      recentOutputs: AgentOperationsOutput[];
      arcRunner: ArcRunnerStatus;
    }
  | {
      status: "unavailable";
      message: string;
    };

type AgentRow = {
  id: string;
  key: string | null;
  name: string | null;
  description: string | null;
  status: string | null;
  allowed_actions: unknown;
  blocked_actions: unknown;
  default_approval_policy: string | null;
  metadata: unknown;
  updated_at: string | null;
};

type AgentTaskRow = {
  id: string;
  agent_id: string | null;
  description: string | null;
  owner_kind: string | null;
  owner_label: string | null;
  driver_kind: string | null;
  driver_agent_id: string | null;
  driver_label: string | null;
  approver_label: string | null;
  status: string | null;
  priority: string | null;
  objective: string | null;
  task_type: string | null;
  source_type: string | null;
  source_id: string | null;
  campaign_id: string | null;
  approval_item_id: string | null;
  due_at: string | null;
  scheduled_for: string | null;
  completed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  metadata: unknown;
};

type AgentTaskDetailRow = AgentTaskRow & {
  started_at: string | null;
};

type LegacyAgentTaskRow = Omit<
  AgentTaskRow,
  | "description"
  | "owner_kind"
  | "owner_label"
  | "driver_kind"
  | "driver_agent_id"
  | "driver_label"
  | "approver_label"
  | "due_at"
  | "scheduled_for"
> &
  Partial<
    Pick<
      AgentTaskRow,
      | "description"
      | "owner_kind"
      | "owner_label"
      | "driver_kind"
      | "driver_agent_id"
      | "driver_label"
      | "approver_label"
      | "due_at"
      | "scheduled_for"
    >
  >;

type LegacyAgentTaskDetailRow = LegacyAgentTaskRow & {
  started_at: string | null;
};

const TASK_SELECT =
  "id,agent_id,description,owner_kind,owner_label,driver_kind,driver_agent_id,driver_label,approver_label,status,priority,objective,task_type,source_type,source_id,campaign_id,approval_item_id,due_at,scheduled_for,completed_at,created_at,updated_at,metadata";

const LEGACY_TASK_SELECT =
  "id,agent_id,status,priority,objective,task_type,source_type,source_id,campaign_id,approval_item_id,completed_at,created_at,updated_at,metadata";

const TASK_DETAIL_SELECT =
  "id,agent_id,description,owner_kind,owner_label,driver_kind,driver_agent_id,driver_label,approver_label,status,priority,objective,task_type,source_type,source_id,campaign_id,approval_item_id,due_at,scheduled_for,started_at,completed_at,created_at,updated_at,metadata";

const LEGACY_TASK_DETAIL_SELECT =
  "id,agent_id,status,priority,objective,task_type,source_type,source_id,campaign_id,approval_item_id,started_at,completed_at,created_at,updated_at,metadata";

export type AgentTaskDetail =
  | {
      status: "live";
      task: {
        id: string;
        status: string;
        priority: string;
        objective: string;
        owner: AgentTaskActor;
        driver: AgentTaskDriver;
        approverLabel: string;
        description: string | null;
        taskType: string;
        sourceType: string | null;
        sourceId: string | null;
        campaignId: string | null;
        approvalItemId: string | null;
        dueAt: string | null;
        scheduledFor: string | null;
        startedAt: string | null;
        completedAt: string | null;
        createdAt: string | null;
        updatedAt: string | null;
        metadata: Record<string, unknown>;
      };
      acceptanceCriteria: Array<{ id: string; label: string; completed: boolean }>;
      latestOutput: AgentTaskOutput | null;
      timeline: AgentTaskTimelineItem[];
      agent: {
        id: string;
        key: string;
        name: string;
        description: string;
        status: string;
        allowedActions: string[];
        blockedActions: string[];
        approvalPolicy: string;
      };
      campaign: {
        id: string;
        name: string;
        persona: string;
        status: string;
        objective: string;
      } | null;
      approval: {
        id: string;
        itemType: string;
        status: string;
        riskLevel: string;
        href: string;
      } | null;
      inputs: Array<{
        id: string;
        inputType: string;
        sourceTable: string | null;
        sourceId: string | null;
        summary: string;
        payload: Record<string, unknown>;
      }>;
      outputs: AgentTaskOutput[];
      logs: Array<{
        id: string;
        runStatus: string;
        modelProvider: string | null;
        modelName: string | null;
        inputTokens: number | null;
        outputTokens: number | null;
        costEstimate: string | null;
        retryCount: number;
        reasoningSummary: string | null;
        errorMessage: string | null;
        startedAt: string | null;
        completedAt: string | null;
        metadata: Record<string, unknown>;
      }>;
    }
  | {
      status: "unavailable";
      message: string;
    }
  | {
      status: "not_found";
    };

type ApprovalItemRow = {
  id: string;
  campaign_id: string | null;
  campaign_asset_id: string | null;
  item_type: string | null;
  status: string | null;
  risk_level: string | null;
  requested_by: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  draft_output: unknown;
  decision_notes: string | null;
};

type AgentTaskApprovalRow = {
  id: string;
  item_type: string | null;
  status: string | null;
  risk_level: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  decision_notes?: string | null;
};

type AgentOutputRow = {
  id: string;
  task_id: string | null;
  approval_item_id: string | null;
  campaign_asset_id?: string | null;
  title: string | null;
  output_type: string | null;
  body?: string | null;
  edited_body?: string | null;
  structured_payload?: unknown;
  risk_level: string | null;
  compliance_status: string | null;
  approval_status: string | null;
  created_at: string | null;
};

type CampaignRow = {
  id: string;
  name: string | null;
  persona: string | null;
  status: string | null;
  objective: string | null;
};

type AgentTaskEventRow = {
  id: string;
  task_id: string | null;
  actor_kind: string | null;
  actor_label: string | null;
  event_type: string | null;
  title: string | null;
  body: string | null;
  metadata: unknown;
  created_at: string | null;
};

export async function getAgentOperationsDashboard(
  client?: SupabaseClient,
  agentName: string = "Agent",
  tenantScope?: AgentTaskTenantFields,
): Promise<AgentOperationsDashboard> {
  if (!client && !isSupabaseAdminConfigured()) {
    return isDemoDataEnabled()
      ? buildDemoAgentOperationsDashboard()
      : { status: "unavailable", message: "Agent operations are unavailable." };
  }

  try {
    const supabase = client ?? getSupabaseAdminClient();
    const scope = tenantScope ?? (!client ? await getCurrentAgentTaskTenantFields() : undefined);
    const [agentsResult, tasksResult, approvalsResult, outputsResult, campaignsResult] = await Promise.all([
      applyOrgScope(
        supabase
          .from("agents")
          .select("id,key,name,description,status,allowed_actions,blocked_actions,default_approval_policy,metadata,updated_at")
          .order("updated_at", { ascending: false })
          .limit(25),
        scope?.org_id,
      ),
      fetchDashboardTasks(supabase, scope),
      applyOrgScope(
        supabase
          .from("approval_items")
          .select(
            "id,campaign_id,campaign_asset_id,item_type,status,risk_level,requested_by,submitted_at,reviewed_at,draft_output,decision_notes",
          ),
        scope?.org_id,
      )
        .order("submitted_at", { ascending: false })
        .limit(50),
      applyOrgScope(
        supabase
          .from("agent_outputs")
          .select("id,task_id,approval_item_id,title,output_type,risk_level,compliance_status,approval_status,created_at"),
        scope?.org_id,
      )
        .order("created_at", { ascending: false })
        .limit(25),
      applyOrgScope(
        supabase
          .from("campaigns")
          .select("id,name,persona,status,objective"),
        scope?.org_id,
      )
        .order("updated_at", { ascending: false })
        .limit(50),
    ]);

    assertSupabaseResult("agents", agentsResult.error);
    assertSupabaseResult("agent_tasks", tasksResult.error);
    assertSupabaseResult("approval_items", approvalsResult.error);
    assertSupabaseResult("agent_outputs", outputsResult.error);
    assertSupabaseResult("campaigns", campaignsResult.error);

    const agents = ((agentsResult.data ?? []) as AgentRow[]).map(normalizeAgentRow);
    const tasks = ((tasksResult.data ?? []) as AgentTaskRow[]).map(normalizeTaskRow);
    const approvals = ((approvalsResult.data ?? []) as ApprovalItemRow[]).map(normalizeApprovalRow);
    const outputs = ((outputsResult.data ?? []) as AgentOutputRow[]).map(normalizeOutputRow);
    const campaigns = ((campaignsResult.data ?? []) as CampaignRow[]).map(normalizeCampaignRow);

    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const approvalById = new Map(approvals.map((approval) => [approval.id, approval]));
    const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
    const activeApprovals = approvals.filter((item) => ACTIVE_APPROVAL_STATUSES.has(item.status));
    const openTasks = tasks.filter((task) => OPEN_TASK_STATUSES.has(task.status));

    // Connected but no Arc work recorded yet: only show the demo preview when
    // the demo flag is enabled; otherwise fall through to the real empty board.
    if (tasks.length === 0 && agents.length === 0) {
      if (isDemoDataEnabled()) return buildDemoAgentOperationsDashboard();
    }

    return {
      status: "live",
      metrics: [
        { label: "Active agents", value: agents.filter((agent) => agent.status !== "paused").length, delta: "Supabase registry" },
        { label: "Tasks running", value: openTasks.length, delta: "Open queue" },
        { label: "Awaiting approval", value: activeApprovals.length, delta: "Human gate" },
        { label: "Blocked outputs", value: countBlocked(tasks, outputs), delta: "Guardrails visible" },
        { label: "Approved this week", value: approvals.filter((item) => item.status === "approved").length, delta: "Recent decisions" },
        { label: "Risk flags", value: countRiskFlags(approvals, outputs), delta: "Review signals" },
      ],
      agents: agents.map((agent) => mapAgent(agent, tasks)),
      tasks: tasks.map((task) => mapTask(task, agentById, campaignById, approvalById, agentName)),
      approvals: activeApprovals.slice(0, 5).map((item) => mapApproval(item, campaignById)),
      recentOutputs: outputs.slice(0, 6).map((output) => mapOutput(output, taskById, agentById)),
      arcRunner: mapArcRunner(agents, tasks, agentName),
    };
  } catch (error) {
    // Degrade, but not silently — this read IS the screen, so an empty
    // state here is indistinguishable from an outage (BSR-544).
    reportDegraded(error, { scope: "agent-operations.getAgentOperationsDashboard", surface: "primary" });
    return {
      status: "unavailable",
      message: error instanceof Error ? error.message : "Agent operations are unavailable.",
    };
  }
}

export async function getAgentTaskDetail(
  taskId: string,
  client?: SupabaseClient,
  agentName: string = "Agent",
  tenantScope?: AgentTaskTenantFields,
): Promise<AgentTaskDetail> {
  if (!client && !isSupabaseAdminConfigured()) {
    return {
      status: "unavailable",
      message: "Supabase env vars are not configured.",
    };
  }

  try {
    const supabase = client ?? getSupabaseAdminClient();
    const scope = tenantScope ?? (!client ? await getCurrentAgentTaskTenantFields() : undefined);
    const { data: taskData, error: taskError } = await fetchTaskDetailRow(supabase, taskId, scope);

    assertSupabaseResult("agent_tasks", taskError);

    if (!taskData) {
      return { status: "not_found" };
    }
    const task = normalizeTaskRow(taskData);

    const [agentResult, inputsResult, outputsResult, logsResult, campaignResult, approvalResult, eventsResult] = await Promise.all([
      supabase
        .from("agents")
        .select("id,key,name,description,status,allowed_actions,blocked_actions,default_approval_policy,metadata,updated_at")
        .eq("id", task.agent_id ?? "")
        .maybeSingle<AgentRow>(),
      supabase
        .from("agent_task_inputs")
        .select("id,input_type,source_table,source_id,summary,payload")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true }),
      supabase
        .from("agent_outputs")
        .select("id,title,output_type,body,edited_body,structured_payload,approval_item_id,campaign_asset_id,risk_level,compliance_status,approval_status,created_at")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false }),
      supabase
        .from("agent_run_logs")
        .select("id,run_status,model_provider,model_name,input_token_count,output_token_count,cost_estimate_cents,reasoning_summary,error_message,started_at,completed_at,retry_count,metadata")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false }),
      task.campaign_id
        ? supabase
            .from("campaigns")
            .select("id,name,persona,status,objective")
            .eq("id", task.campaign_id)
            .maybeSingle<CampaignRow>()
        : Promise.resolve({ data: null, error: null }),
      task.approval_item_id
        ? supabase
            .from("approval_items")
            .select("id,item_type,status,risk_level,submitted_at,reviewed_at,decision_notes")
            .eq("id", task.approval_item_id)
            .maybeSingle<AgentTaskApprovalRow>()
        : Promise.resolve({ data: null, error: null }),
      fetchTaskEvents(supabase, taskId),
    ]);

    assertSupabaseResult("agents", agentResult.error);
    assertSupabaseResult("agent_task_inputs", inputsResult.error);
    assertSupabaseResult("agent_outputs", outputsResult.error);
    assertSupabaseResult("agent_run_logs", logsResult.error);
    assertSupabaseResult("campaigns", campaignResult.error);
    assertSupabaseResult("approval_items", approvalResult.error);
    assertSupabaseResult("agent_task_events", eventsResult.error);

    const agent = agentResult.data ? normalizeAgentRow(agentResult.data) : null;
    const taskMetadata = asRecord(task.metadata);
    const outputs = sortByCreatedAtDesc(((outputsResult.data ?? []) as Array<Record<string, unknown>>).map(mapTaskOutputDetail));
    const approval = approvalResult.data
      ? {
          id: approvalResult.data.id,
          itemType: approvalResult.data.item_type ?? "approval_item",
          status: approvalResult.data.status ?? "needs_review",
          riskLevel: approvalResult.data.risk_level ?? "medium",
          href: `/approvals?item=${approvalResult.data.id}`,
        }
      : null;

    return {
      status: "live",
      task: {
        id: task.id,
        status: task.status ?? "queued",
        priority: task.priority ?? "medium",
        objective: task.objective ?? "Agent task awaiting details.",
        owner: mapActor(task.owner_kind, task.owner_label, agentName),
        driver: mapDriver(task, agentName),
        approverLabel: getString(task.approver_label) ?? "Owner",
        description: getString(task.description),
        taskType: task.task_type ?? "agent_task",
        sourceType: task.source_type,
        sourceId: task.source_id,
        campaignId: task.campaign_id,
        approvalItemId: task.approval_item_id,
        dueAt: task.due_at,
        scheduledFor: task.scheduled_for,
        startedAt: "started_at" in task ? task.started_at : null,
        completedAt: task.completed_at,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        metadata: taskMetadata,
      },
      acceptanceCriteria: parseAcceptanceCriteria(taskMetadata),
      latestOutput: outputs[0] ?? null,
      timeline: composeTaskTimeline((eventsResult.data ?? []) as AgentTaskEventRow[], outputs, approvalResult.data ?? null),
      agent: {
        id: agent?.id ?? task.agent_id ?? "unassigned",
        key: agent?.key ?? "unassigned-agent",
        name: agent?.name ?? "Unassigned agent",
        description: agent?.description ?? "No agent record found.",
        status: agent?.status ?? "unknown",
        allowedActions: getStringArray(agent?.allowed_actions),
        blockedActions: getStringArray(agent?.blocked_actions),
        approvalPolicy: agent?.default_approval_policy ?? "owner_required",
      },
      campaign: campaignResult.data
        ? {
            id: campaignResult.data.id,
            name: campaignResult.data.name ?? "Untitled campaign",
            persona: campaignResult.data.persona ?? "Unassigned persona",
            status: campaignResult.data.status ?? "draft",
            objective: campaignResult.data.objective ?? "Campaign objective pending.",
          }
        : null,
      approval,
      inputs: ((inputsResult.data ?? []) as Array<Record<string, unknown>>).map((input) => ({
        id: String(input.id),
        inputType: getString(input.input_type) ?? "input",
        sourceTable: getString(input.source_table),
        sourceId: getString(input.source_id),
        summary: getString(input.summary) ?? "No input summary captured.",
        payload: asRecord(input.payload),
      })),
      outputs,
      logs: ((logsResult.data ?? []) as Array<Record<string, unknown>>).map((log) => ({
        id: String(log.id),
        runStatus: getString(log.run_status) ?? "queued",
        modelProvider: getString(log.model_provider),
        modelName: getString(log.model_name),
        inputTokens: getNumber(log.input_token_count),
        outputTokens: getNumber(log.output_token_count),
        costEstimate: formatCents(getNumber(log.cost_estimate_cents)),
        retryCount: getNumber(log.retry_count) ?? 0,
        reasoningSummary: getString(log.reasoning_summary),
        errorMessage: getString(log.error_message),
        startedAt: getString(log.started_at),
        completedAt: getString(log.completed_at),
        metadata: asRecord(log.metadata),
      })),
    };
  } catch (error) {
    // Degrade, but not silently — this read IS the screen, so an empty
    // state here is indistinguishable from an outage (BSR-544).
    reportDegraded(error, { scope: "agent-operations.getAgentTaskDetail", surface: "primary" });
    return {
      status: "unavailable",
      message: error instanceof Error ? error.message : "Agent task detail is unavailable.",
    };
  }
}

function applyAgentTaskTenantScope<Query>(query: Query, scope?: AgentTaskTenantFields): Query {
  if (!scope) return query;
  const scoped = query as {
    eq(column: string, value: string): { eq(column: string, value: string): Query };
  };
  return scoped.eq("org_id", scope.org_id).eq("workspace_id", scope.workspace_id);
}

function applyOrgScope<Query>(query: Query, orgId?: string): Query {
  if (!orgId) return query;
  return (query as { eq(column: string, value: string): Query }).eq("org_id", orgId);
}

async function fetchDashboardTasks(supabase: SupabaseClient, scope?: AgentTaskTenantFields) {
  const result = await applyAgentTaskTenantScope(
    supabase
      .from("agent_tasks")
      .select(TASK_SELECT),
    scope,
  )
    .order("updated_at", { ascending: false })
    .limit(50);

  if (!isMissingSharedTaskSchemaError(result.error)) return result;

  return applyAgentTaskTenantScope(
    supabase
      .from("agent_tasks")
      .select(LEGACY_TASK_SELECT),
    scope,
  )
    .order("updated_at", { ascending: false })
    .limit(50);
}

async function fetchTaskDetailRow(supabase: SupabaseClient, taskId: string, scope?: AgentTaskTenantFields) {
  const result = await applyAgentTaskTenantScope(
    supabase
      .from("agent_tasks")
      .select(TASK_DETAIL_SELECT)
      .eq("id", taskId),
    scope,
  ).maybeSingle<AgentTaskDetailRow>();

  if (!isMissingSharedTaskSchemaError(result.error)) return result;

  return applyAgentTaskTenantScope(
    supabase
      .from("agent_tasks")
      .select(LEGACY_TASK_DETAIL_SELECT)
      .eq("id", taskId),
    scope,
  ).maybeSingle<LegacyAgentTaskDetailRow>();
}

async function fetchTaskEvents(supabase: SupabaseClient, taskId: string) {
  const result = await supabase
    .from("agent_task_events")
    .select("id,task_id,actor_kind,actor_label,event_type,title,body,metadata,created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (!isMissingTaskEventsSchemaError(result.error)) return result;

  return { data: [], error: null };
}

function assertSupabaseResult(table: string, error: { message?: string } | null) {
  if (error) {
    throw new Error(`${table} lookup failed: ${formatSupabaseLookupError(error.message)}`);
  }
}

function formatSupabaseLookupError(message: string | undefined) {
  const rawMessage = message ?? "";
  const cleanedMessage = stripHtmlMessage(rawMessage);

  if (!cleanedMessage) return "Unknown Supabase error";

  if (/cloudflare/i.test(cleanedMessage) && /(origin dns error|error 1016)/i.test(cleanedMessage)) {
    return "Supabase connection failed: project host could not be resolved (Cloudflare 1016 Origin DNS error). Check NEXT_PUBLIC_SUPABASE_URL and Supabase project status.";
  }

  if (/fetch failed/i.test(cleanedMessage)) {
    return "Supabase connection failed: the data API could not be reached. Check NEXT_PUBLIC_SUPABASE_URL and Supabase project status.";
  }

  if (/<!doctype html|<html/i.test(rawMessage)) {
    return "Supabase connection failed: the data API returned an HTML error page instead of JSON. Check NEXT_PUBLIC_SUPABASE_URL and Supabase project status.";
  }

  return cleanedMessage.length > 320 ? `${cleanedMessage.slice(0, 317).trimEnd()}...` : cleanedMessage;
}

function stripHtmlMessage(message: string) {
  return message
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&bull;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isMissingSharedTaskSchemaError(error: { message?: string } | null) {
  if (!error?.message) return false;
  const message = error.message.toLowerCase();

  return (
    message.includes("agent_tasks") &&
    [
      "description",
      "owner_kind",
      "owner_label",
      "driver_kind",
      "driver_agent_id",
      "driver_label",
      "approver_label",
      "due_at",
      "scheduled_for",
    ].some((column) => message.includes(column)) &&
    (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find"))
  );
}

function isMissingTaskEventsSchemaError(error: { message?: string } | null) {
  if (!error?.message) return false;
  const message = error.message.toLowerCase();

  return (
    message.includes("agent_task_events") &&
    (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find"))
  );
}

function normalizeAgentRow(row: AgentRow) {
  return {
    ...row,
    key: row.key ?? row.id,
    name: row.name ?? titleize(row.key ?? "Agent"),
    description: row.description ?? "Agent record from Supabase.",
    status: row.status ?? "ready",
  };
}

function normalizeTaskRow(row: AgentTaskRow | LegacyAgentTaskRow | AgentTaskDetailRow | LegacyAgentTaskDetailRow) {
  return {
    ...row,
    description: row.description ?? null,
    owner_kind: row.owner_kind ?? null,
    owner_label: row.owner_label ?? null,
    driver_kind: row.driver_kind ?? null,
    driver_agent_id: row.driver_agent_id ?? null,
    driver_label: row.driver_label ?? null,
    approver_label: row.approver_label ?? null,
    due_at: row.due_at ?? null,
    scheduled_for: row.scheduled_for ?? null,
    status: row.status ?? "queued",
    task_type: row.task_type ?? "agent_task",
    objective: row.objective ?? "Agent task awaiting details.",
  };
}

function normalizeApprovalRow(row: ApprovalItemRow) {
  return {
    ...row,
    item_type: row.item_type ?? "approval_item",
    status: row.status ?? "needs_review",
    risk_level: row.risk_level ?? "low",
  };
}

function normalizeOutputRow(row: AgentOutputRow) {
  return {
    ...row,
    output_type: row.output_type ?? "agent_output",
    risk_level: row.risk_level ?? "low",
    compliance_status: row.compliance_status ?? "pending",
    approval_status: row.approval_status ?? "draft",
  };
}

function normalizeCampaignRow(row: CampaignRow) {
  return {
    ...row,
    name: row.name ?? "Untitled campaign",
    persona: row.persona ?? "Unassigned persona",
    status: row.status ?? "draft",
    objective: row.objective ?? "Campaign objective pending.",
  };
}

function mapAgent(agent: ReturnType<typeof normalizeAgentRow>, tasks: ReturnType<typeof normalizeTaskRow>[]): AgentOperationsAgent {
  const agentTasks = tasks.filter((task) => task.agent_id === agent.id);
  const currentTask = agentTasks.find((task) => OPEN_TASK_STATUSES.has(task.status)) ?? agentTasks[0];
  const metadata = asRecord(agent.metadata);
  const riskFlags = getStringArray(metadata.risk_flags);

  return {
    key: agent.key,
    name: agent.name,
    purpose: agent.description,
    status: titleize(agent.status),
    currentTask: currentTask?.objective ?? "No active task assigned.",
    riskFlags: riskFlags.length > 0 ? riskFlags : [agent.default_approval_policy ?? "Approval policy pending"],
    href: `/agent-operations/${agent.key}`,
  };
}

function mapTask(
  task: ReturnType<typeof normalizeTaskRow>,
  agentById: Map<string, ReturnType<typeof normalizeAgentRow>>,
  campaignById: Map<string, ReturnType<typeof normalizeCampaignRow>>,
  approvalById: Map<string, ReturnType<typeof normalizeApprovalRow>>,
  agentName: string,
): AgentOperationsTask {
  const agent = task.agent_id ? agentById.get(task.agent_id) : undefined;
  const campaign = task.campaign_id ? campaignById.get(task.campaign_id) : undefined;
  const approval = task.approval_item_id ? approvalById.get(task.approval_item_id) : undefined;
  const metadata = asRecord(task.metadata);
  const risk = approval?.risk_level ?? getString(metadata.risk_level) ?? getString(metadata.risk) ?? "Low";

  return {
    id: shortId(task.id),
    fullId: task.id,
    agentKey: agent?.key ?? task.agent_id ?? "unassigned-agent",
    agentName: agent?.name ?? "Unassigned agent",
    task: titleize(task.task_type),
    objective: task.objective,
    linkedObject: campaign
      ? `Campaign: ${campaign.name}`
      : [task.source_type, task.source_id].filter(Boolean).join(": ") || "No linked record",
    campaignLabel: campaign?.name ?? null,
    personaLabel: campaign?.persona ? titleize(campaign.persona.replace(/^persona_/, "")) : null,
    linkedHref: task.approval_item_id ? `/approvals?item=${task.approval_item_id}` : campaign ? "/campaigns" : "/agent-operations",
    approvalHref: task.approval_item_id ? `/approvals?item=${task.approval_item_id}` : null,
    risk: titleize(risk),
    approval: task.approval_item_id ? "Owner approval required" : "Internal task",
    status: task.status,
    priority: titleize(task.priority ?? "medium"),
    dueAt: task.due_at ?? null,
    scheduledFor: task.scheduled_for ?? null,
    progress: parseProgress(metadata.progress),
    owner: mapActor(task.owner_kind, task.owner_label, agentName),
    driver: mapDriver(task, agentName),
    approverLabel: getString(task.approver_label) ?? "Owner",
    description: getString(task.description),
    updated: task.updated_at ?? task.created_at ?? "Now",
    href: `/agent-operations/tasks/${task.id}`,
  };
}

function mapArcRunner(
  agents: ReturnType<typeof normalizeAgentRow>[],
  tasks: ReturnType<typeof normalizeTaskRow>[],
  agentName: string = "Agent",
): ArcRunnerStatus {
  const arc = agents.find((agent) => agent.key === "arc");
  const arcTasks = arc ? tasks.filter((task) => task.agent_id === arc.id) : [];
  const metadata = asRecord(arc?.metadata);
  const lastHeartbeat = getString(metadata.last_heartbeat_at) ?? getString(metadata.runner_last_seen_at);
  const mode = getString(metadata.runner_mode) ?? getString(metadata.runtime) ?? "Mac mini CLI bridge pending";
  const runner = getString(metadata.runner) ?? getString(metadata.runner_name) ?? "Codex OAuth or Claude Code CLI";
  const killSwitch = getString(metadata.kill_switch) ?? (arc?.status === "paused" || arc?.status === "disabled" ? "Paused" : "Outbound locked");

  return {
    configured: Boolean(arc),
    agentId: arc?.id ?? null,
    name: arc?.name ?? agentName,
    status: arc ? titleize(arc.status) : "Pending setup",
    runner,
    mode,
    lastHeartbeat,
    queuedTasks: arcTasks.filter((task) => task.status === "queued").length,
    runningTasks: arcTasks.filter((task) => task.status === "running").length,
    blockedTasks: arcTasks.filter((task) => task.status === "blocked" || task.status === "failed").length,
    approvalTasks: arcTasks.filter((task) => task.status === "needs_approval").length,
    killSwitch,
    nextStep: arc
      ? `Start ${agentName} on the Mac mini and have it poll queued tasks.`
      : `Create ${agentName} in Supabase from this page, then start the Mac mini runner.`,
  };
}

function mapApproval(
  approval: ReturnType<typeof normalizeApprovalRow>,
  campaignById: Map<string, ReturnType<typeof normalizeCampaignRow>>,
): AgentOperationsApproval {
  const campaign = approval.campaign_id ? campaignById.get(approval.campaign_id) : undefined;

  return {
    id: approval.id,
    source: titleize(approval.item_type),
    campaign: campaign?.name ?? "No campaign attached",
    channel: titleize(approval.item_type),
    status: titleize(approval.status),
    risk: titleize(approval.risk_level),
    href: `/approvals?item=${approval.id}`,
  };
}

function mapOutput(
  output: ReturnType<typeof normalizeOutputRow>,
  taskById: Map<string, ReturnType<typeof normalizeTaskRow>>,
  agentById: Map<string, ReturnType<typeof normalizeAgentRow>>,
): AgentOperationsOutput {
  const task = output.task_id ? taskById.get(output.task_id) : undefined;
  const agent = task?.agent_id ? agentById.get(task.agent_id) : undefined;

  return {
    output: output.title ?? titleize(output.output_type),
    agent: agent?.name ?? "Agent output",
    status: titleize(output.approval_status || output.compliance_status),
    time: output.created_at ?? "Now",
  };
}

function countBlocked(tasks: ReturnType<typeof normalizeTaskRow>[], outputs: ReturnType<typeof normalizeOutputRow>[]) {
  return (
    tasks.filter((task) => task.status === "blocked").length +
    outputs.filter((output) => output.compliance_status === "blocked" || output.risk_level === "blocked").length
  );
}

function countRiskFlags(approvals: ReturnType<typeof normalizeApprovalRow>[], outputs: ReturnType<typeof normalizeOutputRow>[]) {
  const riskyApprovals = approvals.filter((approval) => !["low", "none"].includes(approval.risk_level)).length;
  const riskyOutputs = outputs.filter((output) => !["low", "none"].includes(output.risk_level)).length;

  return riskyApprovals + riskyOutputs;
}

function mapActor(kind: string | null | undefined, label: string | null | undefined, agentName: string): AgentTaskActor {
  const normalizedKind = normalizeActorKind(kind);
  return {
    kind: normalizedKind,
    // The agent's display name is operator-configurable, so it always wins over any
    // stored label for agent actors; humans/system keep their recorded label.
    label: normalizedKind === "agent" ? agentName : (getString(label) ?? "Operator"),
  };
}

function mapDriver(row: Pick<AgentTaskRow, "agent_id" | "driver_kind" | "driver_agent_id" | "driver_label">, agentName: string): AgentTaskDriver {
  const actor = mapActor(row.driver_kind ?? (row.driver_agent_id || row.agent_id ? "agent" : null), row.driver_label, agentName);

  return {
    ...actor,
    agentId: actor.kind === "agent" ? row.driver_agent_id ?? row.agent_id ?? null : null,
  };
}

function normalizeActorKind(kind: string | null | undefined): AgentTaskActorKind {
  if (kind === "agent" || kind === "system") return kind;
  return "human";
}

function parseAcceptanceCriteria(metadata: Record<string, unknown>) {
  const rawCriteria = metadata.acceptance_criteria;
  if (!Array.isArray(rawCriteria)) return [];

  return rawCriteria.flatMap((item) => {
    if (!isObject(item)) return [];
    const id = getString(item.id);
    const label = getString(item.label);
    if (!id || !label || typeof item.completed !== "boolean") return [];
    return [{ id, label, completed: item.completed }];
  });
}

function mapEventSource(row: Pick<AgentTaskEventRow, "actor_kind">): AgentTaskTimelineItem["source"] {
  if (row.actor_kind === "approval") return "Approval";
  if (row.actor_kind === "agent") return "Arc";
  if (row.actor_kind === "system") return "System";
  return "Human";
}

function composeTaskTimeline(
  events: AgentTaskEventRow[],
  outputs: AgentTaskOutput[],
  approval: AgentTaskApprovalRow | null,
): AgentTaskTimelineItem[] {
  const eventItems = events.map((event) => ({
    id: event.id,
    source: mapEventSource(event),
    title: getString(event.title) ?? titleize(event.event_type ?? "task_event"),
    body: getString(event.body),
    createdAt: event.created_at,
    eventType: event.event_type ?? "task_event",
  }));

  const outputItems = outputs.map((output) => ({
    id: output.id,
    source: "Arc" as const,
    title: output.title,
    body: output.readableBody,
    createdAt: output.createdAt,
    eventType: "output_created",
  }));

  const approvalItem = approval
    ? [
        {
          id: approval.id,
          source: "Approval" as const,
          title: titleize(approval.status ?? "approval_event"),
          body: `${titleize(approval.item_type ?? "approval item")} approval is ${approval.status ?? "pending"}.`,
          createdAt: approval.reviewed_at ?? approval.submitted_at ?? null,
          eventType: "approval_event",
        },
      ]
    : [];

  return sortByCreatedAtDesc([...eventItems, ...outputItems, ...approvalItem]);
}

function sortByCreatedAtDesc<T extends { createdAt: string | null }>(items: T[]) {
  return [...items].sort((left, right) => compareCreatedAtDesc(left.createdAt, right.createdAt));
}

function compareCreatedAtDesc(left: string | null, right: string | null) {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;

  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
    return rightTime - leftTime;
  }

  return right.localeCompare(left);
}

function mapTaskOutputDetail(output: Record<string, unknown>): AgentTaskOutput {
  const structuredPayload = asRecord(output.structured_payload);
  const rawBody = getString(output.edited_body) ?? getString(output.body) ?? "";
  const readableBody = buildReadableOutput(rawBody, structuredPayload);
  const evidence = buildEvidenceLinks(rawBody, structuredPayload);
  const media = buildMediaLinks(rawBody, structuredPayload);
  const approvalItemId = getString(output.approval_item_id);

  return {
    id: String(output.id),
    title: getString(output.title) ?? "Agent output",
    outputType: getString(output.output_type) ?? "output",
    body: rawBody,
    readableBody,
    structuredSections: buildStructuredSections(structuredPayload),
    evidence,
    media,
    riskLevel: getString(output.risk_level) ?? "medium",
    complianceStatus: getString(output.compliance_status) ?? "pending_approval",
    approvalStatus: getString(output.approval_status) ?? "pending_approval",
    approvalHref: approvalItemId ? `/approvals?item=${approvalItemId}` : null,
    campaignAssetId: getString(output.campaign_asset_id),
    createdAt: getString(output.created_at),
  };
}

function buildReadableOutput(rawBody: string, structuredPayload: Record<string, unknown>) {
  const fromPayload = previewValue(structuredPayload);
  if (fromPayload) return fromPayload;

  const parsed = parseDraftJson(rawBody);
  if (parsed) {
    const parsedPreview = previewValue(parsed);
    if (parsedPreview) return parsedPreview;
  }

  return rawBody.trim() || "No readable output body captured.";
}

function buildStructuredSections(payload: Record<string, unknown>) {
  return Object.entries(payload)
    .filter(([key, value]) => isReadableKey(key) && value !== null && value !== undefined)
    .flatMap(([key, value]) => sectionsForValue(key, value))
    .slice(0, 10);
}

function sectionsForValue(key: string, value: unknown): Array<{ label: string; value: string }> {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [{ label: titleize(key), value: String(value) }];
  }

  if (Array.isArray(value)) {
    const readableItems = value.map((item) => (isObject(item) ? previewRecord(item) : typeof item === "string" ? item : null)).filter(Boolean);
    return readableItems.length > 0 ? [{ label: titleize(key), value: readableItems.slice(0, 5).join("\n\n") }] : [];
  }

  if (isObject(value)) {
    const nested = previewRecord(value);
    return nested ? [{ label: titleize(key), value: nested }] : [];
  }

  return [];
}

function previewValue(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const rows = value.map((entry) => (isObject(entry) ? previewRecord(entry) : typeof entry === "string" ? entry : null)).filter(Boolean);
    return rows.length > 0 ? rows.slice(0, 6).join("\n\n") : null;
  }
  if (!isObject(value)) return String(value);

  const direct =
    getString(value.summary) ??
    getString(value.title) ??
    getString(value.headline) ??
    getString(value.message) ??
    getString(value.body) ??
    getString(value.recommended_action) ??
    getString(value.suggested_owner_action);
  if (direct) return direct;

  const collection = Object.entries(value).find(([key, entry]) => isReadableCollectionKey(key) && Array.isArray(entry) && entry.length > 0);
  if (collection) {
    const [collectionKey, collectionValue] = collection;
    const records = (Array.isArray(collectionValue) ? collectionValue : [])
      .map((entry) => (isObject(entry) ? previewRecord(entry) : typeof entry === "string" ? entry : null))
      .filter(Boolean)
      .slice(0, 6);
    return records.length > 0 ? `${titleize(collectionKey)}:\n${records.join("\n\n")}` : null;
  }

  const scalar = Object.entries(value)
    .filter(([key, entry]) => isReadableKey(key) && entry !== null && entry !== undefined && typeof entry !== "object")
    .slice(0, 8)
    .map(([key, entry]) => `${titleize(key)}: ${String(entry)}`);
  return scalar.length > 0 ? scalar.join("\n") : null;
}

function previewRecord(value: Record<string, unknown>) {
  const title =
    getString(value.company_name) ??
    getString(value.name) ??
    getString(value.title) ??
    getString(value.subject) ??
    getString(value.headline) ??
    "Record";
  const fields = [
    "score",
    "partner_score",
    "lead_score",
    "confidence",
    "status",
    "channel",
    "website",
    "phone",
    "recommended_action",
    "recommended_next_action",
    "notes",
    "reason",
    "fit",
  ]
    .map((key) => {
      const valueForKey = value[key];
      return valueForKey !== null && valueForKey !== undefined && typeof valueForKey !== "object"
        ? `${titleize(key)}: ${String(valueForKey)}`
        : null;
    })
    .filter(Boolean);

  const urls = uniqueStrings(extractUrlsFromObject(value)).slice(0, 3);
  if (urls.length > 0) fields.push(`Sources: ${urls.join(", ")}`);

  return [title, ...fields].join("\n");
}

function buildEvidenceLinks(rawBody: string, payload: Record<string, unknown>) {
  return uniqueStrings([...extractUrls(rawBody), ...extractUrlsFromObject(payload)])
    .filter((url) => !isMediaUrl(url))
    .slice(0, 8)
    .map((url) => ({ label: sourceLabel(url), href: url }));
}

function buildMediaLinks(rawBody: string, payload: Record<string, unknown>) {
  return uniqueStrings([...extractUrls(rawBody), ...extractUrlsFromObject(payload)])
    .filter(isMediaUrl)
    .slice(0, 8)
    .map((url) => ({ label: sourceLabel(url), href: url, type: mediaType(url) }));
}

function extractUrlsFromObject(value: Record<string, unknown>): string[] {
  const urls: string[] = [];
  for (const entry of Object.values(value)) {
    if (typeof entry === "string") {
      urls.push(...extractUrls(entry));
    } else if (Array.isArray(entry)) {
      for (const item of entry) {
        if (typeof item === "string") urls.push(...extractUrls(item));
        if (isObject(item)) urls.push(...extractUrlsFromObject(item));
      }
    } else if (isObject(entry)) {
      urls.push(...extractUrlsFromObject(entry));
    }
  }
  return urls;
}

function extractUrls(value: string) {
  return value.match(/https?:\/\/[^\s"'<>),\]]+/g) ?? [];
}

function parseDraftJson(value: string) {
  const firstBrace = value.indexOf("{");
  const lastBrace = value.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;

  try {
    return JSON.parse(value.slice(firstBrace, lastBrace + 1)) as unknown;
  } catch {
    return null;
  }
}

function isReadableCollectionKey(key: string) {
  return /candidate|lead|company|contact|asset|creative|deliverable|source|evidence|campaign|ad|email|sms|post|item/i.test(key);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMediaUrl(url: string) {
  return /\.(png|jpe?g|gif|webp|svg|mp4|webm|mov|m4v|pdf|docx?|pptx?)(\?|#|$)/i.test(url);
}

function mediaType(url: string): "image" | "video" | "file" | "link" {
  if (/\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(url)) return "image";
  if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url)) return "video";
  if (/\.(pdf|docx?|pptx?)(\?|#|$)/i.test(url)) return "file";
  return "link";
}

function sourceLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Source link";
  }
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function formatCents(cents: number | null) {
  if (typeof cents !== "number") return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(cents / 100);
}

function parseProgress(value: unknown): { done: number; total: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const done = record.done;
  const total = record.total;
  if (typeof done !== "number" || typeof total !== "number") return null;
  if (!Number.isFinite(done) || !Number.isFinite(total)) return null;
  if (total <= 0 || done < 0) return null;
  return { done, total };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function isReadableKey(key: string) {
  const normalized = key.toLowerCase();
  return !normalized.endsWith("_id") && !normalized.endsWith("_ids") && normalized !== "id" && !/payload|metadata|audit/.test(normalized);
}

function titleize(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortId(id: string) {
  return id.length > 12 ? id.slice(0, 8) : id;
}

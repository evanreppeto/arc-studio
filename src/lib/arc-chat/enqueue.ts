import { type SupabaseClient } from "@supabase/supabase-js";

import { type ArcMention } from "@/domain";
import { type ApprovalStrictness, type AssistantResponseStyle, type AssistantTone } from "@/lib/settings/store";
import { type ArcSkillId } from "@/lib/arc-skills/catalog";

import { workspaceScopeFields } from "@/lib/tenancy/write-scope";

import { getCurrentAgentTaskTenantFields } from "../agent-tasks/scope";
import { getSupabaseAdminClient } from "../supabase/server";
import { markAgentKeys } from "./agent-config";
import { notifyArcWebhook } from "./notify";
import { insertPendingArcMessage, type ArcAttachment } from "./persistence";
import { logArcChatStatus } from "./status-log";

export type EnqueueChatTaskInput = {
  conversationId: string;
  projectId?: string | null;
  campaignId?: string | null;
  messageId: string;
  message: string;
  mentions: ArcMention[];
  operator: string;
  /** Model-routing hint for the external runner; routine chat defaults to "fast". */
  route?: "fast" | "standard";
  /** Operator stance for this message; the worker decides what Arc may do. */
  mode?: "ask" | "act" | "draft";
  /** Structured slash command id (e.g. "find-leads"), or null for plain chat. */
  command?: string | null;
  /** Optional generic runner skill that narrows tools and adds playbook instructions. */
  skillId?: ArcSkillId | null;
  /** Operator-selected behavior hints from Settings -> Agent behavior. */
  assistantTone?: AssistantTone;
  assistantResponseStyle?: AssistantResponseStyle;
  approvalStrictness?: ApprovalStrictness;
  /** Operator-uploaded reference images (GCS, signed read URLs) for Arc to use. */
  attachments?: ArcAttachment[];
  /** Operator-selected workspace sources to emphasize for this turn. */
  contextScopes?: string[];
  /** Configured agent display name, for operator-facing not-connected messaging. */
  agentName?: string;
};

function assertOk(label: string, error: { message: string } | null) {
  if (error) throw new Error(`${label} failed: ${error.message}`);
}

/**
 * Queue an operator chat message as an agent_task for Arc. Arc's reply comes
 * back via POST /api/v1/arc/messages. Outbound stays locked. Returns the new
 * task id, or throws if no Arc/Arc agent is registered yet.
 */
export async function enqueueArcChatTask(
  input: EnqueueChatTaskInput,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<string> {
  // Resolved before the lookup, not after it: agent keys are unique per org
  // (20260716150000), so an unfiltered lookup can return another tenant's agent
  // and hand its id to the agent_tasks insert below.
  const tenant = await getCurrentAgentTaskTenantFields();

  const { data: agent, error: agentError } = await client
    .from("agents")
    .select("id")
    .eq("org_id", tenant.org_id)
    .eq("workspace_id", tenant.workspace_id)
    .in("key", await markAgentKeys())
    .limit(1)
    .maybeSingle<{ id: string }>();
  assertOk("agents lookup", agentError);

  if (!agent) {
    const agentName = input.agentName?.trim() || "Agent";
    throw new Error(`${agentName} isn't connected to this workspace yet, so the message can't be queued.`);
  }

  const { data: task, error: taskError } = await client
    .from("agent_tasks")
    .insert({
      ...tenant,
      agent_id: agent.id,
      status: "queued",
      priority: "high",
      objective: input.message,
      task_type: "arc_chat_message",
      source_type: "arc_conversation",
      source_id: input.conversationId,
      metadata: {
        requested_by: input.operator,
        human_instruction: input.message,
        conversation_id: input.conversationId,
        message_id: input.messageId,
        mentions: input.mentions,
        command: input.command ?? null,
        skill_id: input.skillId ?? null,
        attachments: input.attachments ?? [],
        context_scopes: input.contextScopes ?? [],
        source: "arc_chat",
        project_id: input.projectId ?? null,
        campaign_id: input.campaignId ?? null,
        model_route: input.route ?? "fast",
        mode: input.mode ?? "act",
        assistant_tone: input.assistantTone ?? "direct",
        response_style: input.assistantResponseStyle ?? "balanced",
        approval_strictness: input.approvalStrictness ?? "standard",
        outbound_locked: true,
      },
    })
    .select("id")
    .single<{ id: string }>();
  assertOk("agent_tasks insert", taskError);
  if (!task) throw new Error("agent_tasks insert returned no id");

  const { error: inputError } = await client.from("agent_task_inputs").insert({
    task_id: task.id,
    // agent_task_inputs gained workspace_id in BSR-712, so this now carries the
    // same scope as the agent_tasks row above rather than org_id alone.
    ...workspaceScopeFields(tenant),
    input_type: "operator_message",
    source_table: "arc_conversations",
    source_id: input.conversationId,
    summary: input.message,
    payload: {
      message: input.message,
      requested_by: input.operator,
      mentions: input.mentions,
      command: input.command ?? null,
      skill_id: input.skillId ?? null,
      attachments: input.attachments ?? [],
      context_scopes: input.contextScopes ?? [],
      project_id: input.projectId ?? null,
      campaign_id: input.campaignId ?? null,
    },
  });
  assertOk("agent_task_inputs insert", inputError);

  // Create the pending Arc reply bubble now, keyed to this task, BEFORE the wake.
  // The runner streams its reply back into this row (POST /api/v1/arc/messages and
  // its /body + /steps children), and every one of those routes matches on a
  // `pending` arc_messages row for the task id — if the row didn't exist yet, a
  // fast reply would 404 and be silently dropped, so the operator would wait on a
  // "thinking" bubble forever. Must precede notifyArcWebhook. Mirrors queueCampaignTask.
  await insertPendingArcMessage({ conversationId: input.conversationId, agentTaskId: task.id }, client);

  // Wake Arc now (push, not poll) so it actually replies. The runner is
  // webhook-only and never pulls this queue, so without this the message sits
  // queued forever. Best-effort and fully isolated: a wake failure must never
  // fail a message that's already persisted — the inbox route is the fallback.
  // Mirrors enqueueOpportunityScanTask's enqueue→notify handoff.
  const wakeStartedAt = Date.now();
  try {
    const delivered = await notifyArcWebhook({
      messageId: input.messageId,
      conversationId: input.conversationId,
      projectId: input.projectId ?? null,
      campaignId: input.campaignId ?? null,
      agentTaskId: task.id,
      message: input.message,
      mentions: input.mentions,
      operator: input.operator,
      route: input.route ?? "fast",
      mode: input.mode ?? "act",
      command: input.command ?? null,
      skillId: input.skillId ?? null,
      attachments: input.attachments ?? [],
      contextScopes: input.contextScopes ?? [],
      assistantTone: input.assistantTone,
      assistantResponseStyle: input.assistantResponseStyle,
      approvalStrictness: input.approvalStrictness,
    });
    logArcChatStatus("waking_mark", {
      agentTaskId: task.id,
      conversationId: input.conversationId,
      detail: `delivered=${delivered} wake_ms=${Date.now() - wakeStartedAt}`,
    });
  } catch (error) {
    // Best-effort wake; the task is queued and the inbox route can still deliver it.
    logArcChatStatus("waking_mark", {
      agentTaskId: task.id,
      conversationId: input.conversationId,
      detail: `delivered=false wake_ms=${Date.now() - wakeStartedAt} error=${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return task.id;
}

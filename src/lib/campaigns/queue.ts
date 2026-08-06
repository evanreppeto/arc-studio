import { type SupabaseClient } from "@supabase/supabase-js";

import { type AgentTaskTenantFields } from "@/lib/agent-tasks/scope";
import { workspaceScopeFields } from "@/lib/tenancy/write-scope";
import { notifyArcCampaignTask } from "@/lib/arc-chat/notify";
import { insertPendingArcMessage } from "@/lib/arc-chat/persistence";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

type CampaignTaskType = "campaign_brief_draft" | "campaign_directive" | "campaign_asset_revision";

type QueueCampaignTaskInput = {
  agentName: string;
  campaignId: string;
  conversationId?: string | null;
  operator: string;
  prompt: string;
  priority?: "high" | "medium" | "low";
  taskType: CampaignTaskType;
  requestedFrom: string;
  tenant: AgentTaskTenantFields;
};

export type QueueCampaignBuildTaskInput = Omit<QueueCampaignTaskInput, "taskType" | "requestedFrom" | "priority">;
export type QueueCampaignDirectiveTaskInput = Omit<QueueCampaignTaskInput, "taskType" | "requestedFrom" | "priority">;

export async function queueCampaignBuildTask(
  input: QueueCampaignBuildTaskInput,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<string> {
  return queueCampaignTask(
    {
      ...input,
      priority: "high",
      taskType: "campaign_brief_draft",
      requestedFrom: "campaigns_ask_mark",
    },
    client,
  );
}

export async function queueCampaignDirectiveTask(
  input: QueueCampaignDirectiveTaskInput,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<string> {
  return queueCampaignTask(
    {
      ...input,
      priority: "medium",
      taskType: "campaign_directive",
      requestedFrom: "campaign_overview_hand_to_mark",
    },
    client,
  );
}

async function queueCampaignTask(input: QueueCampaignTaskInput, client: SupabaseClient): Promise<string> {
  const agentId = await ensureArcAgentId(input.agentName, input.tenant, client);
  const { data: task, error } = await client
    .from("agent_tasks")
    .insert({
      ...input.tenant,
      agent_id: agentId,
      status: "queued",
      priority: input.priority ?? "medium",
      objective: taskObjective(input),
      task_type: input.taskType,
      campaign_id: input.campaignId,
      source_type: "campaign_directive",
      source_id: input.campaignId,
      metadata: {
        requested_from: input.requestedFrom,
        conversation_id: input.conversationId ?? null,
        human_instruction: input.prompt,
        human_approval_required: true,
        outbound_dispatch_allowed: false,
      },
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(`agent_tasks insert failed: ${error.message}`);
  if (!task?.id) throw new Error("agent_tasks insert returned no id");

  if (input.conversationId) {
    await insertPendingArcMessage({ conversationId: input.conversationId, agentTaskId: task.id }, client);
  }

  await notifyArcCampaignTask({
    agentTaskId: task.id,
    campaignId: input.campaignId,
    conversationId: input.conversationId ?? null,
    message: input.prompt,
    operator: input.operator,
    taskType: input.taskType,
  });

  return task.id;
}

function taskObjective(input: QueueCampaignTaskInput): string {
  if (input.taskType === "campaign_brief_draft") {
    return `Build campaign package: ${input.prompt.slice(0, 180)}`;
  }
  return input.prompt;
}

// agents gained workspace_id in BSR-712, so this now carries the full tenant.
// The conflict target must stay (org_id, key) to match the per-org unique;
// targeting "key" alone would resolve against another tenant's agent row and
// overwrite it.
async function ensureArcAgentId(
  agentName: string,
  tenant: AgentTaskTenantFields,
  client: SupabaseClient,
): Promise<string> {
  const { data, error } = await client
    .from("agents")
    .upsert(
      {
        ...workspaceScopeFields(tenant),
        key: "arc",
        name: agentName,
        status: "ready",
        blocked_actions: ["send_email", "send_sms", "publish_social_post", "launch_ads", "change_ad_spend"],
        default_approval_policy: "human_required_before_outbound",
      },
      { onConflict: "org_id,key" },
    )
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(`agents upsert failed: ${error.message}`);
  return data.id;
}

import { describe, expect, it, vi } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { enqueueArcChatTask } from "./enqueue";

const { notifyArcWebhook } = vi.hoisted(() => ({ notifyArcWebhook: vi.fn() }));
vi.mock("./notify", () => ({ notifyArcWebhook }));

vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({
    orgId: "org-1",
    orgSlug: "org",
    orgName: "Org",
    workspaceId: "workspace-1",
    workspaceKey: "default",
    workspaceSlug: "default",
    workspaceName: "Default",
    role: null,
    userId: null,
    source: "default-org",
  })),
}));

vi.mock("@/lib/agent/connection", () => ({
  resolveAgentConnection: vi.fn().mockResolvedValue({
    agentKey: "arc",
  }),
}));

// The row returned by the pending-bubble insert enqueue now makes before waking Arc.
const PENDING_BUBBLE_ROW = {
  id: "pending-1",
  conversation_id: "conversation-1",
  role: "arc",
  body: "",
  status: "pending",
  agent_task_id: "task-1",
  mentions: [],
  metadata: {},
  created_at: "2026-07-10T00:00:00.000Z",
};

describe("enqueueArcChatTask", () => {
  it("persists Arc defaults as worker metadata on the queued task", async () => {
    const supabase = createSupabaseQueryMock({
      agents: { data: { id: "agent-1" }, error: null },
      agent_tasks: { data: { id: "task-1" }, error: null },
      agent_task_inputs: { data: null, error: null },
      arc_conversations: { data: { org_id: "org-1" }, error: null },
      arc_messages: { data: PENDING_BUBBLE_ROW, error: null },
    });

    await enqueueArcChatTask(
      {
        conversationId: "conversation-1",
        messageId: "message-1",
        message: "Draft a partner campaign.",
        mentions: [],
        operator: "Operator",
        route: "standard",
        mode: "draft",
        command: "campaign",
        skillId: "approval-gated-drafting",
        assistantTone: "friendly",
        assistantResponseStyle: "detailed",
        approvalStrictness: "strict",
      },
      supabase,
    );

    const taskInsert = supabase.calls.find(
      (call) => call[0] === "insert" && isRecord(call[1]) && call[1].task_type === "arc_chat_message",
    );

    expect(taskInsert?.[1]).toMatchObject({
      org_id: "org-1",
      workspace_id: "workspace-1",
      metadata: {
        model_route: "standard",
        mode: "draft",
        assistant_tone: "friendly",
        response_style: "detailed",
        approval_strictness: "strict",
        command: "campaign",
        skill_id: "approval-gated-drafting",
        outbound_locked: true,
      },
    });
  });

  // REGRESSION GUARD: the runner is webhook-only (no queue poll), so the enqueue
  // MUST wake it — without this the message sits queued forever and Arc never replies.
  it("wakes Arc's runner after queueing the message (push, not poll)", async () => {
    notifyArcWebhook.mockClear();
    const supabase = createSupabaseQueryMock({
      agents: { data: { id: "agent-1" }, error: null },
      agent_tasks: { data: { id: "task-1" }, error: null },
      agent_task_inputs: { data: null, error: null },
      arc_conversations: { data: { org_id: "org-1" }, error: null },
      arc_messages: { data: PENDING_BUBBLE_ROW, error: null },
    });

    await enqueueArcChatTask(
      { conversationId: "conversation-1", messageId: "message-1", message: "Hi Arc", mentions: [], operator: "Operator" },
      supabase,
    );

    expect(notifyArcWebhook).toHaveBeenCalledTimes(1);
    expect(notifyArcWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conversation-1",
        messageId: "message-1",
        agentTaskId: "task-1",
        message: "Hi Arc",
        route: "fast",
        mode: "act",
      }),
    );
  });

  it("still returns the task id when the wake fails — a wake error must not fail the send", async () => {
    notifyArcWebhook.mockRejectedValueOnce(new Error("runner unreachable"));
    const supabase = createSupabaseQueryMock({
      agents: { data: { id: "agent-1" }, error: null },
      agent_tasks: { data: { id: "task-1" }, error: null },
      agent_task_inputs: { data: null, error: null },
      arc_conversations: { data: { org_id: "org-1" }, error: null },
      arc_messages: { data: PENDING_BUBBLE_ROW, error: null },
    });

    const id = await enqueueArcChatTask(
      { conversationId: "conversation-1", messageId: "message-1", message: "Hi Arc", mentions: [], operator: "Operator" },
      supabase,
    );

    expect(id).toBe("task-1");
  });

  // REGRESSION GUARD: the reply route (POST /api/v1/arc/messages) 404s unless a
  // `pending` arc_messages row already exists for the task — and it must be created
  // BEFORE the runner is woken, or a fast reply races the insert and gets dropped.
  it("creates the pending Arc reply bubble before waking the runner", async () => {
    notifyArcWebhook.mockClear();
    const supabase = createSupabaseQueryMock({
      agents: { data: { id: "agent-1" }, error: null },
      agent_tasks: { data: { id: "task-1" }, error: null },
      agent_task_inputs: { data: null, error: null },
      arc_conversations: { data: { org_id: "org-1" }, error: null },
      arc_messages: { data: PENDING_BUBBLE_ROW, error: null },
    });

    // Snapshot, at wake time, whether the pending bubble was already inserted.
    let bubbleInsertedBeforeWake = false;
    notifyArcWebhook.mockImplementationOnce(() => {
      bubbleInsertedBeforeWake = supabase.calls.some(
        (call) => call[0] === "insert" && isRecord(call[1]) && call[1].status === "pending" && call[1].role === "arc",
      );
    });

    await enqueueArcChatTask(
      { conversationId: "conversation-1", messageId: "message-1", message: "Hi Arc", mentions: [], operator: "Operator" },
      supabase,
    );

    const bubbleInsert = supabase.calls.find(
      (call) => call[0] === "insert" && isRecord(call[1]) && call[1].status === "pending" && call[1].role === "arc",
    );
    expect(bubbleInsert?.[1]).toMatchObject({
      conversation_id: "conversation-1",
      agent_task_id: "task-1",
      status: "pending",
      // Explicit, derived from the parent conversation — never left to the
      // hardcoded arc_messages.org_id DEFAULT, which misfiles into one tenant.
      org_id: "org-1",
    });
    expect(bubbleInsertedBeforeWake).toBe(true);
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

/**
 * REGRESSION GUARD: the operator's media-model pick has to survive the whole
 * hop to the runner, RESOLVED — the runner cannot import the roster, so a bare
 * id crossing this boundary would be a model reference nothing can interpret.
 *
 * This is the exact class of bug this feature was built to fix: a model choice
 * that is recorded somewhere but never reaches the thing that generates.
 */
describe("enqueueArcChatTask media pick", () => {
  function mock() {
    return createSupabaseQueryMock({
      agents: { data: { id: "agent-1" }, error: null },
      agent_tasks: { data: { id: "task-1" }, error: null },
      agent_task_inputs: { data: null, error: null },
      arc_conversations: { data: { org_id: "org-1" }, error: null },
      arc_messages: { data: PENDING_BUBBLE_ROW, error: null },
    });
  }

  const base = {
    conversationId: "conversation-1",
    messageId: "message-1",
    message: "Make a clip for the fall push.",
    mentions: [],
    operator: "Operator",
  };

  it("sends the pick to the runner already resolved", async () => {
    notifyArcWebhook.mockClear();
    await enqueueArcChatTask({ ...base, mediaModel: "higgsfield:veo3_1" }, mock());

    expect(notifyArcWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaPick: { key: "higgsfield:veo3_1", engine: "higgsfield", id: "veo3_1", category: "video", label: "Google Veo 3.1" },
      }),
    );
  });

  it("records the pick on the task row, so a replay knows what was chosen", async () => {
    const supabase = mock();
    await enqueueArcChatTask({ ...base, mediaModel: "higgsfield:veo3_1" }, supabase);

    const taskInsert = supabase.calls.find(
      (call) => call[0] === "insert" && isRecord(call[1]) && call[1].task_type === "arc_chat_message",
    );
    expect(taskInsert?.[1]).toMatchObject({ metadata: { media_model: "higgsfield:veo3_1" } });
  });

  it("drops a model id that no longer names a real model, rather than relaying junk", async () => {
    notifyArcWebhook.mockClear();
    await enqueueArcChatTask({ ...base, mediaModel: "higgsfield:retired_model" }, mock());

    expect(notifyArcWebhook).toHaveBeenCalledWith(expect.objectContaining({ mediaPick: null }));
  });

  it("sends no pick at all when the operator left it on Auto", async () => {
    notifyArcWebhook.mockClear();
    await enqueueArcChatTask({ ...base, mediaModel: "auto" }, mock());

    expect(notifyArcWebhook).toHaveBeenCalledWith(expect.objectContaining({ mediaPick: null }));
  });
});

import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock, type MockSupabase } from "@/lib/repos/__tests__/test-helpers";

import {
  assignConversationToCampaign,
  appendArcStep,
  cancelPendingArcMessage,
  completeArcMessage,
  deleteConversation,
  findPendingMessageByTask,
  insertOperatorMessage,
  linkConversationToCampaign,
  listConversations,
  setConversationPinned,
  setArcMessageFeedback,
  streamArcMessageReasoning,
} from "./persistence";

function calls(supabase: MockSupabase, method: string): Array<Record<string, unknown>> {
  return supabase.calls.filter(([m]) => m === method).map(([, arg]) => arg as Record<string, unknown>);
}

function orderCalls(supabase: MockSupabase): Array<[string, ...unknown[]]> {
  return supabase.calls.filter(([m]) => m === "order");
}

describe("listConversations", () => {
  it("orders pinned first (nulls last), then by last_message_at desc", async () => {
    const supabase = createSupabaseQueryMock({ arc_conversations: { data: [], error: null } });

    await listConversations("Operator", supabase);

    const orders = orderCalls(supabase);
    expect(orders).toContainEqual(["order", "pinned_at", { ascending: false, nullsFirst: false }]);
    expect(orders).toContainEqual(["order", "last_message_at", { ascending: false }]);
  });

  it("maps pinned_at onto pinnedAt", async () => {
    const supabase = createSupabaseQueryMock({
      arc_conversations: {
        data: [
          {
            id: "c1",
            operator: "Operator",
            title: "Hi",
            status: "active",
            project_id: null,
            pinned_at: "2026-06-09T00:00:00Z",
            created_at: "t",
            updated_at: "t",
            last_message_at: "t",
          },
        ],
        error: null,
      },
    });

    const rows = await listConversations("Operator", supabase);

    expect(rows[0].pinnedAt).toBe("2026-06-09T00:00:00Z");
  });
});

describe("insertOperatorMessage", () => {
  it("stores command and skill metadata for skill-driven reruns", async () => {
    const supabase = createSupabaseQueryMock({
      arc_conversations: { data: { org_id: "org-1" }, error: null },
      arc_messages: {
        data: {
          id: "m1",
          conversation_id: "c1",
          role: "operator",
          body: "Find new leads",
          status: "sent",
          agent_task_id: null,
          mentions: [],
          metadata: { command: "find-leads", skill_id: "opportunity-discovery" },
          created_at: "2026-06-23T00:00:00.000Z",
        },
        error: null,
      },
    });

    const message = await insertOperatorMessage(
      {
        conversationId: "c1",
        body: "Find new leads",
        mentions: [],
        command: "find-leads",
        skillId: "opportunity-discovery",
      },
      supabase,
    );

    const insert = calls(supabase, "insert")[0];
    expect(insert.metadata).toMatchObject({ command: "find-leads", skill_id: "opportunity-discovery" });
    expect(message.command).toBe("find-leads");
    expect(message.skillId).toBe("opportunity-discovery");
  });

  // REGRESSION GUARD: shadow mode must stay observational. If an inferred pick
  // ever lands in `skill_id`, it stops being a measurement and starts silently
  // steering turns — including narrowing the runner's tool set — which is the
  // exact failure the shadow phase exists to rule out.
  it("records an inferred skill without applying it as the turn's skill", async () => {
    const supabase = createSupabaseQueryMock({
      arc_conversations: { data: { org_id: "org-1" }, error: null },
      arc_messages: {
        data: {
          id: "m1",
          conversation_id: "c1",
          role: "operator",
          body: "make me an image of a service van",
          status: "sent",
          agent_task_id: null,
          mentions: [],
          metadata: {},
          created_at: "2026-06-23T00:00:00.000Z",
        },
        error: null,
      },
    });

    const message = await insertOperatorMessage(
      {
        conversationId: "c1",
        body: "make me an image of a service van",
        mentions: [],
        skillId: null,
        inferredSkill: { id: "approval-gated-drafting", score: 9, margin: 9, confidence: "high" },
      },
      supabase,
    );

    const insert = calls(supabase, "insert")[0];
    const metadata = insert.metadata as Record<string, unknown>;
    expect(metadata.inferred_skill).toMatchObject({ id: "approval-gated-drafting", confidence: "high" });
    expect(metadata).not.toHaveProperty("skill_id");
    // The turn still ran unskilled, exactly as it does today.
    expect(message.skillId).toBeFalsy();
  });

  // REGRESSION GUARD: arc_messages.org_id has a DEFAULT hardcoded to one org, so an
  // omitted org_id silently misfiles the message into that tenant rather than failing.
  // The org must be derived from the parent conversation and passed explicitly.
  it("writes the parent conversation's org_id explicitly", async () => {
    const supabase = createSupabaseQueryMock({
      arc_conversations: { data: { org_id: "org-other" }, error: null },
      arc_messages: {
        data: {
          id: "m1",
          conversation_id: "c1",
          role: "operator",
          body: "Hi",
          status: "sent",
          agent_task_id: null,
          mentions: [],
          metadata: {},
          created_at: "2026-06-23T00:00:00.000Z",
        },
        error: null,
      },
    });

    await insertOperatorMessage({ conversationId: "c1", body: "Hi", mentions: [] }, supabase);

    expect(supabase.calls).toContainEqual(["from", "arc_conversations"]);
    expect(calls(supabase, "insert")[0]).toMatchObject({ conversation_id: "c1", org_id: "org-other" });
  });

  it("fails loudly rather than misfiling when the conversation has no org", async () => {
    const supabase = createSupabaseQueryMock({
      arc_conversations: { data: null, error: null },
      arc_messages: { data: null, error: null },
    });

    await expect(
      insertOperatorMessage({ conversationId: "c-missing", body: "Hi", mentions: [] }, supabase),
    ).rejects.toThrow(/no org_id/);
    expect(calls(supabase, "insert")).toHaveLength(0);
  });
});

describe("setConversationPinned", () => {
  it("stamps pinned_at when pinning", async () => {
    const supabase = createSupabaseQueryMock({ arc_conversations: { data: null, error: null } });

    await setConversationPinned("c1", true, supabase);

    const update = calls(supabase, "update")[0];
    expect(update.pinned_at).toEqual(expect.any(String));
    // Must be scoped to the one conversation, not an unscoped UPDATE across all rows.
    expect(supabase.calls).toContainEqual(["eq", "id", "c1"]);
  });

  it("clears pinned_at when unpinning", async () => {
    const supabase = createSupabaseQueryMock({ arc_conversations: { data: null, error: null } });

    await setConversationPinned("c1", false, supabase);

    const update = calls(supabase, "update")[0];
    expect(update.pinned_at).toBeNull();
  });
});

describe("deleteConversation", () => {
  it("hard-deletes the conversation row", async () => {
    const supabase = createSupabaseQueryMock({ arc_conversations: { data: null, error: null } });

    await deleteConversation("c1", supabase);

    expect(supabase.calls).toContainEqual(["delete"]);
    expect(supabase.calls).toContainEqual(["eq", "id", "c1"]);
  });
});

describe("cancelPendingArcMessage", () => {
  it("deletes the latest pending Arc message and reports true", async () => {
    const supabase = createSupabaseQueryMock({ arc_messages: { data: { id: "m9" }, error: null } });

    const cancelled = await cancelPendingArcMessage("c1", supabase);

    expect(cancelled).toBe(true);
    expect(supabase.calls).toContainEqual(["eq", "status", "pending"]);
    expect(supabase.calls).toContainEqual(["delete"]);
    // The delete must target the looked-up row's id, not a blanket delete.
    expect(supabase.calls).toContainEqual(["eq", "id", "m9"]);
  });

  it("is a safe no-op when no pending message exists", async () => {
    const supabase = createSupabaseQueryMock({ arc_messages: { data: null, error: null } });

    const cancelled = await cancelPendingArcMessage("c1", supabase);

    expect(cancelled).toBe(false);
    expect(supabase.calls).not.toContainEqual(["delete"]);
  });
});

describe("setArcMessageFeedback", () => {
  it("writes feedback merged into existing metadata, scoped by id", async () => {
    const supabase = createSupabaseQueryMock({
      arc_messages: { data: { id: "m1", metadata: { steps: [] } }, error: null },
    });

    await setArcMessageFeedback("m1", "up", supabase);

    const update = calls(supabase, "update")[0];
    expect(update.metadata).toMatchObject({ steps: [], feedback: "up" });
    expect(supabase.calls).toContainEqual(["eq", "id", "m1"]);
  });

  it("clears feedback when value is null", async () => {
    const supabase = createSupabaseQueryMock({
      arc_messages: { data: { id: "m1", metadata: { feedback: "up" } }, error: null },
    });

    await setArcMessageFeedback("m1", null, supabase);

    const update = calls(supabase, "update")[0];
    expect(update.metadata).toMatchObject({ feedback: null });
  });
});

describe("assignConversationToCampaign", () => {
  it("updates campaign_id on the conversation row", async () => {
    const supabase = createSupabaseQueryMock({ arc_conversations: { data: null, error: null } });

    await assignConversationToCampaign("conv-1", "camp-9", supabase);

    const update = calls(supabase, "update")[0];
    expect(update).toEqual({ campaign_id: "camp-9" });
  });

  it("clears campaign_id with null", async () => {
    const supabase = createSupabaseQueryMock({ arc_conversations: { data: null, error: null } });

    await assignConversationToCampaign("conv-1", null, supabase);

    const update = calls(supabase, "update")[0];
    expect(update).toEqual({ campaign_id: null });
  });
});

describe("linkConversationToCampaign", () => {
  function makeConvRow(overrides: Partial<{
    project_id: string | null;
    campaign_id: string | null;
  }> = {}) {
    return {
      id: "conv-1",
      operator: "evan",
      title: "Test chat",
      status: "active",
      org_id: "org-conv",
      pinned_at: null,
      project_id: null,
      campaign_id: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      last_message_at: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  it("creates a project and updates conversation when projectId is null", async () => {
    // arc_conversations: first call = getConversation (returns row), second = update (returns null)
    // arc_projects: insert returns new project
    const supabase = createSupabaseQueryMock({
      arc_conversations: [
        { data: makeConvRow({ project_id: null }), error: null },
        { data: null, error: null },
      ],
      arc_projects: { data: { id: "proj-new", operator: "evan", name: "Fall Campaign", created_at: "t", updated_at: "t" }, error: null },
    });

    await linkConversationToCampaign("conv-1", "camp-1", "Fall Campaign", supabase);

    // createProject must have been called (arc_projects insert)
    expect(supabase.calls).toContainEqual(["from", "arc_projects"]);
    expect(supabase.calls).toContainEqual([
      "insert",
      { operator: "evan", name: "Fall Campaign", org_id: "org-conv" },
    ]);

    // Update must set both project_id and campaign_id
    const updateCalls = supabase.calls.filter(([m]) => m === "update").map(([, arg]) => arg as Record<string, unknown>);
    expect(updateCalls).toContainEqual(expect.objectContaining({ project_id: "proj-new", campaign_id: "camp-1" }));
  });

  it("reuses existing projectId without calling createProject", async () => {
    const supabase = createSupabaseQueryMock({
      arc_conversations: [
        { data: makeConvRow({ project_id: "pExisting" }), error: null },
        { data: null, error: null },
      ],
    });

    await linkConversationToCampaign("conv-1", "camp-2", "Unused Name", supabase);

    // No arc_projects interaction
    expect(supabase.calls).not.toContainEqual(["from", "arc_projects"]);

    // Update must use the existing project_id
    const updateCalls = supabase.calls.filter(([m]) => m === "update").map(([, arg]) => arg as Record<string, unknown>);
    expect(updateCalls).toContainEqual(expect.objectContaining({ project_id: "pExisting", campaign_id: "camp-2" }));
  });

  it("is a no-op when getConversation returns null", async () => {
    const supabase = createSupabaseQueryMock({
      arc_conversations: { data: null, error: null },
    });

    await linkConversationToCampaign("conv-missing", "camp-1", "Name", supabase);

    expect(supabase.calls).not.toContainEqual(["from", "arc_projects"]);
    const updateCalls = supabase.calls.filter(([m]) => m === "update");
    expect(updateCalls).toHaveLength(0);
  });
});

describe("completeArcMessage", () => {
  it("atomically merges final metadata and writes mentions when provided", async () => {
    const supabase = createSupabaseQueryMock({ "rpc:arc_complete_message": { data: true, error: null } });
    await completeArcMessage(
      {
        messageId: "m1",
        body: "done",
        metadata: { actions: [] },
        mentions: [{ type: "lead", id: "L1", label: "Dana", href: "/crm/leads/L1" }],
      },
      supabase,
    );
    expect(supabase.calls).toContainEqual([
      "rpc",
      "arc_complete_message",
      {
        p_message_id: "m1",
        p_body: "done",
        p_metadata: { actions: [] },
        p_mentions: [{ type: "lead", id: "L1", label: "Dana", href: "/crm/leads/L1" }],
      },
    ]);
  });

  it("passes null mentions when omitted so the atomic mutation does not clobber them", async () => {
    const supabase = createSupabaseQueryMock({ "rpc:arc_complete_message": { data: true, error: null } });
    await completeArcMessage({ messageId: "m1", body: "done" }, supabase);
    expect(supabase.calls).toContainEqual([
      "rpc",
      "arc_complete_message",
      { p_message_id: "m1", p_body: "done", p_metadata: {}, p_mentions: null },
    ]);
  });

  it("fails when the message is no longer pending", async () => {
    const supabase = createSupabaseQueryMock({ "rpc:arc_complete_message": { data: false, error: null } });
    await expect(completeArcMessage({ messageId: "m1", body: "done" }, supabase)).rejects.toThrow(
      "found no pending message",
    );
  });

  it("preserves streamed metadata when the migration is not applied yet", async () => {
    const supabase = createSupabaseQueryMock({
      "rpc:arc_complete_message": {
        data: null,
        error: { message: "Could not find the function public.arc_complete_message in the schema cache" },
      },
      arc_messages: [
        {
          data: {
            metadata: {
              steps: [{ label: "Researching", status: "done", at: "t" }],
              reasoning: "Compared records",
            },
            mentions: [{ type: "lead", id: "L1", label: "Dana" }],
          },
          error: null,
        },
        { data: { id: "m1" }, error: null },
      ],
    });

    await completeArcMessage(
      { messageId: "m1", body: "done", metadata: { actions: [], runDurationMs: 1450 } },
      supabase,
    );

    expect(calls(supabase, "update")[0]).toEqual({
      body: "done",
      status: "complete",
      metadata: {
        steps: [{ label: "Researching", status: "done", at: "t" }],
        reasoning: "Compared records",
        actions: [],
        runDurationMs: 1450,
      },
    });
    expect(supabase.calls).toContainEqual(["eq", "status", "pending"]);
  });

  it("does not hide genuine RPC failures behind the compatibility path", async () => {
    const supabase = createSupabaseQueryMock({
      "rpc:arc_complete_message": { data: null, error: { message: "permission denied" } },
    });

    await expect(completeArcMessage({ messageId: "m1", body: "done" }, supabase)).rejects.toThrow(
      "permission denied",
    );
    expect(supabase.calls).not.toContainEqual(["from", "arc_messages"]);
  });
});

describe("findPendingMessageByTask", () => {
  it("verifies the agent task belongs to the resolved Arc workspace before reading the pending message", async () => {
    const supabase = createSupabaseQueryMock({
      agent_tasks: { data: { id: "task-1" }, error: null },
      arc_messages: {
        data: {
          id: "m1",
          conversation_id: "c1",
          role: "arc",
          body: "",
          status: "pending",
          agent_task_id: "task-1",
          mentions: [],
          metadata: {},
          created_at: "t",
        },
        error: null,
      },
    });

    const pending = await findPendingMessageByTask("task-1", supabase, { orgId: "org-1", workspaceId: "workspace-1" });

    expect(pending?.id).toBe("m1");
    expect(supabase.calls).toContainEqual(["from", "agent_tasks"]);
    expect(supabase.calls).toContainEqual(["eq", "id", "task-1"]);
    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
    expect(supabase.calls).toContainEqual(["eq", "workspace_id", "workspace-1"]);
  });

  it("does not read arc_messages when the scoped task is missing", async () => {
    const supabase = createSupabaseQueryMock({
      agent_tasks: { data: null, error: null },
      arc_messages: {
        data: {
          id: "m1",
          conversation_id: "c1",
          role: "arc",
          body: "",
          status: "pending",
          agent_task_id: "task-1",
          mentions: [],
          metadata: {},
          created_at: "t",
        },
        error: null,
      },
    });

    await expect(findPendingMessageByTask("task-1", supabase, { orgId: "org-1", workspaceId: "workspace-1" })).resolves.toBeNull();

    expect(supabase.calls.filter((call) => call[0] === "from" && call[1] === "arc_messages")).toHaveLength(0);
  });
});

describe("appendArcStep", () => {
  it("verifies scope then uses the atomic database mutation for steps", async () => {
    const supabase = createSupabaseQueryMock({
      agent_tasks: { data: { id: "task-1" }, error: null },
      "rpc:arc_append_message_step": { data: true, error: null },
    });

    const applied = await appendArcStep(
      { agentTaskId: "task-1", label: "Checking leads", status: "running", at: "2026-06-19T12:00:00.000Z" },
      supabase,
      { orgId: "org-1", workspaceId: "workspace-1" },
    );

    expect(applied).toBe(true);
    expect(supabase.calls).toContainEqual(["from", "agent_tasks"]);
    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
    expect(supabase.calls).toContainEqual(["eq", "workspace_id", "workspace-1"]);
    expect(supabase.calls).toContainEqual([
      "rpc",
      "arc_append_message_step",
      {
        p_agent_task_id: "task-1",
        p_label: "Checking leads",
        p_status: "running",
        p_at: "2026-06-19T12:00:00.000Z",
        p_detail: null,
      },
    ]);
  });

  // A step carries the reasoning that led to it, so the chat can pair each
  // action with the thinking that preceded it rather than showing one
  // undifferentiated transcript beside an unrelated list of actions.
  it("passes the step's narration through to the database", async () => {
    const supabase = createSupabaseQueryMock({
      agent_tasks: { data: { id: "task-1" }, error: null },
      "rpc:arc_append_message_step": { data: true, error: null },
    });

    await appendArcStep(
      {
        agentTaskId: "task-1",
        label: "Checking leads",
        status: "running",
        at: "2026-06-19T12:00:00.000Z",
        detail: "I need the qualified list before I can rank anything.",
      },
      supabase,
      { orgId: "org-1", workspaceId: "workspace-1" },
    );

    expect(supabase.calls).toContainEqual([
      "rpc",
      "arc_append_message_step",
      {
        p_agent_task_id: "task-1",
        p_label: "Checking leads",
        p_status: "running",
        p_at: "2026-06-19T12:00:00.000Z",
        p_detail: "I need the qualified list before I can rank anything.",
      },
    ]);
  });
});

describe("streamArcMessageReasoning", () => {
  it("patches reasoning through the atomic database mutation", async () => {
    const supabase = createSupabaseQueryMock({
      "rpc:arc_stream_message_reasoning": { data: true, error: null },
    });

    await streamArcMessageReasoning(
      { agentTaskId: "task-1", reasoning: "Comparing the two audiences" },
      supabase,
    );

    expect(supabase.calls).toContainEqual([
      "rpc",
      "arc_stream_message_reasoning",
      { p_agent_task_id: "task-1", p_reasoning: "Comparing the two audiences" },
    ]);
    expect(supabase.calls.some(([method]) => method === "update")).toBe(false);
  });
});

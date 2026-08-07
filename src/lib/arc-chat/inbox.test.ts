import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock, type MockSupabase } from "@/lib/repos/__tests__/test-helpers";

import { cancelChatTask, claimChatTask, listQueuedChatTasks, reclaimStaleChatTasks, settleChatTask } from "./inbox";

function calls(supabase: MockSupabase, method: string): Array<Record<string, unknown>> {
  return supabase.calls.filter(([m]) => m === method).map(([, arg]) => arg as Record<string, unknown>);
}

function eqCalls(supabase: MockSupabase): Array<[string, ...unknown[]]> {
  return supabase.calls.filter(([m]) => m === "eq");
}

describe("claimChatTask", () => {
  it("atomically flips a queued chat task to running (claimed/processing)", async () => {
    const supabase = createSupabaseQueryMock({ agent_tasks: { data: { id: "t1" }, error: null } });

    const claimed = await claimChatTask("t1", supabase);

    expect(claimed).toBe(true);
    const update = calls(supabase, "update")[0];
    expect(update).toMatchObject({ status: "running" });
    expect(update.started_at).toEqual(expect.any(String));
    // Guarded on the task id AND a still-queued status so two workers can't both claim it.
    expect(eqCalls(supabase)).toContainEqual(["eq", "id", "t1"]);
    expect(eqCalls(supabase)).toContainEqual(["eq", "status", "queued"]);
  });

  it("scopes claims to the resolved Arc workspace", async () => {
    const supabase = createSupabaseQueryMock({ agent_tasks: { data: { id: "t1" }, error: null } });

    await claimChatTask("t1", supabase, { orgId: "org-1", workspaceId: "workspace-1" });

    expect(eqCalls(supabase)).toContainEqual(["eq", "org_id", "org-1"]);
    expect(eqCalls(supabase)).toContainEqual(["eq", "workspace_id", "workspace-1"]);
  });

  it("reports not claimed when no queued row matched (already claimed elsewhere)", async () => {
    const supabase = createSupabaseQueryMock({ agent_tasks: { data: null, error: null } });

    const claimed = await claimChatTask("t1", supabase);

    expect(claimed).toBe(false);
  });
});

describe("cancelChatTask", () => {
  it("cancels only an in-flight scoped run and closes its pending message", async () => {
    const row = { id: "t1", status: "running", agent_id: "agent-1", metadata: { source: "arc_chat" } };
    const supabase = createSupabaseQueryMock({
      agent_tasks: [{ data: row, error: null }, { data: { id: "t1" }, error: null }],
      arc_messages: [
        { data: { id: "m1", metadata: { steps: [{ label: "Searched CRM", status: "done" }] } }, error: null },
        { data: null, error: null },
      ],
      agent_run_logs: { data: null, error: null },
    });

    const result = await cancelChatTask(
      { agentTaskId: "t1", conversationId: "c1", canceledBy: "Operator" },
      supabase,
      { orgId: "org-1", workspaceId: "workspace-1" },
    );

    expect(result).toEqual({ ok: true });
    expect(calls(supabase, "update")).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "canceled" }),
      expect.objectContaining({
        status: "failed",
        metadata: expect.objectContaining({ steps: [{ label: "Searched CRM", status: "done" }], canceled: true }),
      }),
    ]));
    expect(eqCalls(supabase)).toContainEqual(["eq", "source_id", "c1"]);
    expect(eqCalls(supabase)).toContainEqual(["eq", "org_id", "org-1"]);
    expect(eqCalls(supabase)).toContainEqual(["eq", "workspace_id", "workspace-1"]);
  });
});

describe("listQueuedChatTasks", () => {
  it("only lists queued arc_chat_message tasks", async () => {
    const supabase = createSupabaseQueryMock({
      agent_tasks: {
        data: [
          {
            id: "t1",
            objective: "hi",
            metadata: { conversation_id: "c1", message_id: "m1", skill_id: "opportunity-discovery" },
            created_at: "t",
          },
        ],
        error: null,
      },
    });

    const items = await listQueuedChatTasks(20, supabase);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ agentTaskId: "t1", conversationId: "c1", skillId: "opportunity-discovery" });
    expect(eqCalls(supabase)).toContainEqual(["eq", "task_type", "arc_chat_message"]);
    expect(eqCalls(supabase)).toContainEqual(["eq", "status", "queued"]);
  });

  it("lists queued chat tasks only inside the resolved Arc workspace", async () => {
    const supabase = createSupabaseQueryMock({
      agent_tasks: { data: [], error: null },
    });

    await listQueuedChatTasks(20, supabase, { orgId: "org-1", workspaceId: "workspace-1" });

    expect(eqCalls(supabase)).toContainEqual(["eq", "org_id", "org-1"]);
    expect(eqCalls(supabase)).toContainEqual(["eq", "workspace_id", "workspace-1"]);
  });
});

describe("reclaimStaleChatTasks", () => {
  it("re-surfaces a running task past the cutoff and bumps its retry count", async () => {
    const supabase = createSupabaseQueryMock({
      agent_tasks: {
        data: [
          {
            id: "t1",
            objective: "hi",
            metadata: { conversation_id: "c1", skill_id: "company-research" },
            created_at: "t",
            retry_count: 1,
          },
        ],
        error: null,
      },
    });

    const items = await reclaimStaleChatTasks({ staleMs: 1000, maxRetries: 3, limit: 20 }, supabase);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ agentTaskId: "t1", conversationId: "c1", skillId: "company-research" });
    // Only stale (status='running', started_at < cutoff) tasks are considered.
    expect(eqCalls(supabase)).toContainEqual(["eq", "status", "running"]);
    expect(supabase.calls.some(([m, col]) => m === "lt" && col === "started_at")).toBe(true);
    // Re-stamp + bump retry without flipping status away from running.
    const restamp = calls(supabase, "update").find((u) => "retry_count" in u);
    expect(restamp).toMatchObject({ retry_count: 2 });
    expect(restamp?.started_at).toEqual(expect.any(String));
  });

  it("reclaims stale chat tasks only inside the resolved Arc workspace", async () => {
    const supabase = createSupabaseQueryMock({
      agent_tasks: {
        data: [{ id: "t1", objective: "hi", metadata: { conversation_id: "c1" }, created_at: "t", retry_count: 1 }],
        error: null,
      },
    });

    await reclaimStaleChatTasks({ staleMs: 1000, maxRetries: 3, limit: 20 }, supabase, { orgId: "org-1", workspaceId: "workspace-1" });

    expect(eqCalls(supabase).filter((call) => call[1] === "org_id" && call[2] === "org-1").length).toBeGreaterThanOrEqual(2);
    expect(eqCalls(supabase).filter((call) => call[1] === "workspace_id" && call[2] === "workspace-1").length).toBeGreaterThanOrEqual(2);
  });

  it("gives up on a task past the retry cap: fails the task and the pending bubble", async () => {
    const supabase = createSupabaseQueryMock({
      agent_tasks: {
        data: [{ id: "t1", objective: "hi", metadata: { conversation_id: "c1" }, created_at: "t", retry_count: 3 }],
        error: null,
      },
      arc_messages: {
        data: {
          id: "msg1",
          conversation_id: "c1",
          role: "arc",
          body: "",
          status: "pending",
          agent_task_id: "t1",
          mentions: [],
          metadata: {},
          created_at: "t",
        },
        error: null,
      },
    });

    const items = await reclaimStaleChatTasks({ staleMs: 1000, maxRetries: 3, limit: 20 }, supabase);

    expect(items).toHaveLength(0);
    // Both the task and its pending message are flipped to failed.
    expect(calls(supabase, "update").some((u) => u.status === "failed")).toBe(true);
  });
});

describe("settleChatTask", () => {
  it("settles only the task inside the resolved Arc workspace", async () => {
    const supabase = createSupabaseQueryMock({ agent_tasks: { data: null, error: null } });

    await settleChatTask("t1", "completed", supabase, { orgId: "org-1", workspaceId: "workspace-1" });

    expect(eqCalls(supabase)).toContainEqual(["eq", "id", "t1"]);
    expect(eqCalls(supabase)).toContainEqual(["eq", "org_id", "org-1"]);
    expect(eqCalls(supabase)).toContainEqual(["eq", "workspace_id", "workspace-1"]);
  });

  /**
   * Nothing else stamps it for chat: the runner never calls /tasks/[id]/complete,
   * so this settle is the only one a chat turn goes through. Measured on prod
   * 2026-08-07, all 54 completed arc_chat_message rows had a null completed_at,
   * leaving the most common task type with no duration data.
   */
  it("stamps completed_at so the turn has a duration", async () => {
    const supabase = createSupabaseQueryMock({ agent_tasks: { data: null, error: null } });

    await settleChatTask("t1", "completed", supabase);

    const update = calls(supabase, "update").find((u) => u.status === "completed");
    expect(update?.completed_at).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(String(update?.completed_at)))).toBe(false);
  });

  it("stamps it on a failed settle too — a failure still ended at a time", async () => {
    const supabase = createSupabaseQueryMock({ agent_tasks: { data: null, error: null } });

    await settleChatTask("t1", "failed", supabase);

    const update = calls(supabase, "update").find((u) => u.status === "failed");
    expect(update?.completed_at).toEqual(expect.any(String));
  });
});

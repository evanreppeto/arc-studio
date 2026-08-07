import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ArcConversation, ArcMessage } from "./persistence";

const mocks = vi.hoisted(() => ({
  isConfigured: vi.fn(),
  getViewer: vi.fn(),
  getOperator: vi.fn(),
  listConversations: vi.fn(),
  listMessages: vi.fn(),
  listActiveRuns: vi.fn(),
  listTaskStates: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: mocks.isConfigured,
}));
vi.mock("@/lib/auth/operator", () => ({ getOperatorActor: mocks.getOperator }));
vi.mock("./sharing", () => ({ getShareViewer: mocks.getViewer }));
vi.mock("./persistence", () => ({
  listConversationsForViewer: mocks.listConversations,
  listMessages: mocks.listMessages,
  listActiveArcRunConversationIds: mocks.listActiveRuns,
  listArcRunTaskStates: mocks.listTaskStates,
}));

import { getArcChatModel, getRecentArcConversations } from "./read-model";

const conversation: ArcConversation = {
  id: "conversation-1",
  operator: "Evan",
  title: "Growth plan",
  status: "active",
  pinnedAt: null,
  projectId: null,
  campaignId: null,
  ownerId: "user-1",
  workspaceId: "workspace-1",
  orgId: "org-1",
  visibility: "private",
  workspacePermission: "collaborate",
  createdAt: "2026-07-22T12:00:00.000Z",
  updatedAt: "2026-07-22T12:00:00.000Z",
  lastMessageAt: "2026-07-22T12:00:00.000Z",
  summary: null,
  summaryThroughMessageId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isConfigured.mockReturnValue(true);
  mocks.getViewer.mockResolvedValue({ userId: "user-1", workspaceIds: ["workspace-1"], enforce: true });
  mocks.getOperator.mockResolvedValue("Evan");
  mocks.listConversations.mockResolvedValue([conversation]);
  mocks.listMessages.mockResolvedValue([]);
  mocks.listActiveRuns.mockResolvedValue([]);
  mocks.listTaskStates.mockResolvedValue(new Map());
});

/** A `pending` Arc reply — the row shape a stranded turn leaves behind. */
function pendingReply(overrides: Partial<ArcMessage> = {}): ArcMessage {
  return {
    id: "message-1",
    conversationId: conversation.id,
    role: "arc",
    body: "",
    status: "pending",
    agentTaskId: "task-1",
    mentions: [],
    media: [],
    steps: [],
    feedback: null,
    actions: [],
    suggestions: [],
    attachments: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("getArcChatModel", () => {
  it("uses demo mode only when the real backend is not configured", async () => {
    mocks.isConfigured.mockReturnValue(false);

    // `not_configured`, not `unavailable`: nothing failed, there is no backend
    // to ask. /arc reads this exact status to fall back to the mock.
    await expect(getArcChatModel()).resolves.toEqual({ status: "not_configured" });
    expect(mocks.listConversations).not.toHaveBeenCalled();
  });

  it("keeps a configured workspace in live mode when history loading fails", async () => {
    mocks.listConversations.mockRejectedValue(new Error("temporary read failure"));

    await expect(getArcChatModel()).resolves.toMatchObject({
      status: "error",
      message: expect.stringContaining("No chats were changed"),
    });
  });

  it("opens a real blank composer while retaining the conversation rail", async () => {
    const model = await getArcChatModel(null, { startBlank: true });

    expect(model).toMatchObject({
      status: "live",
      activeConversationId: null,
      messages: [],
    });
    expect(model.status === "live" ? model.threadGroups[0]?.items[0]?.id : null).toBe(conversation.id);
    expect(mocks.listMessages).not.toHaveBeenCalled();
  });

  it("adds a compact semantic summary preview to conversation rows", async () => {
    mocks.listConversations.mockResolvedValue([{
      ...conversation,
      summary: "## Homeowner outreach\nDrafted a storm follow-up sequence. Awaiting review.",
    }]);

    const model = await getArcChatModel();

    expect(model.status === "live" ? model.threadGroups[0]?.items[0]?.preview : null)
      .toBe("Homeowner outreach Drafted a storm follow-up sequence.");
  });

  /**
   * The bug these cover: a turn whose runner died leaves `arc_messages.status`
   * at "pending" forever, so the bubble spun with no way out — and because the
   * row really was pending, reloading reproduced the spinner instead of
   * clearing it. The read model has to notice.
   */
  describe("stranded runs", () => {
    const messagesOf = (model: Awaited<ReturnType<typeof getArcChatModel>>) =>
      model.status === "live" ? model.messages : [];

    it("marks a pending reply whose task already settled", async () => {
      mocks.listMessages.mockResolvedValue([pendingReply()]);
      mocks.listTaskStates.mockResolvedValue(
        new Map([["task-1", { status: "failed", startedAt: new Date().toISOString(), createdAt: null }]]),
      );

      expect(messagesOf(await getArcChatModel())[0]).toMatchObject({
        status: "pending",
        stalled: true,
        stalledReason: "task_settled",
      });
    });

    it("leaves a run that is genuinely still working alone", async () => {
      mocks.listMessages.mockResolvedValue([pendingReply()]);
      mocks.listTaskStates.mockResolvedValue(
        new Map([["task-1", { status: "running", startedAt: new Date().toISOString(), createdAt: null }]]),
      );

      expect(messagesOf(await getArcChatModel())[0]?.stalled).toBeUndefined();
    });

    it("does not touch a settled reply, however old", async () => {
      mocks.listMessages.mockResolvedValue([
        pendingReply({ status: "complete", body: "Here you go.", createdAt: "2020-01-01T00:00:00.000Z" }),
      ]);

      expect(messagesOf(await getArcChatModel())[0]?.stalled).toBeUndefined();
      // No pending rows means no reason to ask the queue anything.
      expect(mocks.listTaskStates).not.toHaveBeenCalled();
    });

    it("leaves messages alone when the task lookup fails", async () => {
      // No evidence a run is dead is not evidence that it is. A spinner is a
      // smaller lie than a false "Arc stopped responding" on live work.
      mocks.listMessages.mockResolvedValue([pendingReply()]);
      mocks.listTaskStates.mockRejectedValue(new Error("queue read failed"));

      const model = await getArcChatModel();
      expect(model.status).toBe("live");
      expect(messagesOf(model)[0]?.stalled).toBeUndefined();
    });
  });
});

describe("getRecentArcConversations", () => {
  it("distinguishes an unavailable backend from an empty live workspace", async () => {
    mocks.isConfigured.mockReturnValue(false);

    await expect(getRecentArcConversations()).resolves.toBeNull();
    expect(mocks.listConversations).not.toHaveBeenCalled();
  });

  it("returns the newest access-scoped conversations with compact labels", async () => {
    mocks.listConversations.mockResolvedValue([
      conversation,
      {
        ...conversation,
        id: "conversation-2",
        title: "  ",
        lastMessageAt: "2026-07-22T13:30:00.000Z",
      },
    ]);

    await expect(getRecentArcConversations({
      limit: 2,
      nowMs: Date.parse("2026-07-22T14:00:00.000Z"),
      orgId: "org-1",
      workspaceId: "workspace-1",
    })).resolves.toEqual([
        { id: "conversation-2", title: "Untitled chat", when: "30m", running: false, pinned: false, defaultActive: false, campaignId: null, campaignName: null },
        { id: "conversation-1", title: "Growth plan", when: "2h", running: false, pinned: false, defaultActive: true, campaignId: null, campaignName: null },
      ]);
  });

  /**
   * The rail's first row is the chat `/arc` opens.
   *
   * These were two different threads: `defaultActive` came from the unsorted
   * access order (pinned first), while the rail displayed by recency alone — so
   * a pinned-but-older chat was marked active in second place while a newer one
   * sat above it looking like the current one. Pinning also visibly did nothing,
   * which is the whole of what pinning is for. Both orders are pinned-first now.
   */
  it("puts the thread /arc opens by default at the top of the rail", async () => {
    mocks.listConversations.mockResolvedValue([
      { ...conversation, id: "pinned", pinnedAt: "2026-07-20T00:00:00.000Z", lastMessageAt: "2026-07-21T00:00:00.000Z" },
      { ...conversation, id: "newest", lastMessageAt: "2026-07-22T13:00:00.000Z" },
    ]);

    const recents = await getRecentArcConversations({ nowMs: Date.parse("2026-07-22T14:00:00.000Z") });

    expect(recents?.map((r) => [r.id, r.defaultActive, r.pinned])).toEqual([
      ["pinned", true, true],
      ["newest", false, false],
    ]);
    expect(recents?.[0]?.defaultActive).toBe(true);
  });

  it("marks a thread with a fresh run as working and ignores a stale one", async () => {
    const nowMs = Date.parse("2026-07-22T14:00:00.000Z");
    mocks.listConversations.mockResolvedValue([
      conversation,
      { ...conversation, id: "conversation-2", lastMessageAt: "2026-07-22T13:00:00.000Z" },
    ]);
    mocks.listActiveRuns.mockResolvedValue([
      { conversationId: "conversation-1", since: "2026-07-22T13:59:30.000Z" },
      // Older than RUN_FRESHNESS_MS — a stuck task, not live work.
      { conversationId: "conversation-2", since: "2026-07-22T13:40:00.000Z" },
    ]);

    const recents = await getRecentArcConversations({ nowMs });

    expect(recents?.map((r) => [r.id, r.running])).toEqual([
      ["conversation-2", false],
      ["conversation-1", true],
    ]);
  });

  // A failing run read must cost the dots, not the whole section.
  it("still returns recents when the active-run read fails", async () => {
    mocks.listActiveRuns.mockRejectedValue(new Error("agent_tasks unavailable"));

    const recents = await getRecentArcConversations({ nowMs: Date.parse("2026-07-22T14:00:00.000Z") });

    expect(recents).toMatchObject([{ id: "conversation-1", running: false }]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ArcConversation } from "./persistence";

const mocks = vi.hoisted(() => ({
  isConfigured: vi.fn(),
  getViewer: vi.fn(),
  getOperator: vi.fn(),
  listConversations: vi.fn(),
  listMessages: vi.fn(),
  listActiveRuns: vi.fn(),
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
});

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
        { id: "conversation-2", title: "Untitled chat", when: "30m", running: false, defaultActive: false, campaignId: null, campaignName: null },
        { id: "conversation-1", title: "Growth plan", when: "2h", running: false, defaultActive: true, campaignId: null, campaignName: null },
      ]);
  });

  // The rail marks the open chat, and with no `?c=` /arc opens
  // listConversationsForViewer's first row — pinned-first, NOT newest-first.
  // Deriving it from the rail's own display order would mark the wrong row for
  // any workspace with a pinned chat.
  it("flags the thread /arc opens by default from the unsorted access order", async () => {
    mocks.listConversations.mockResolvedValue([
      { ...conversation, id: "pinned", pinnedAt: "2026-07-20T00:00:00.000Z", lastMessageAt: "2026-07-21T00:00:00.000Z" },
      { ...conversation, id: "newest", lastMessageAt: "2026-07-22T13:00:00.000Z" },
    ]);

    const recents = await getRecentArcConversations({ nowMs: Date.parse("2026-07-22T14:00:00.000Z") });

    expect(recents?.map((r) => [r.id, r.defaultActive])).toEqual([["newest", false], ["pinned", true]]);
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

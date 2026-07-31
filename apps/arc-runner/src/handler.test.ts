import { describe, expect, it, vi } from "vitest";

import type { ArcClient } from "./arc-client";
import type { Config } from "./config";
import { runArcCampaignTask, runArcOpportunityScan, runArcTurn } from "./arc";
import { handleCampaignTask, handleChatMessage, handleOpportunityScan } from "./handler";

vi.mock("./arc", () => ({
  runArcTurn: vi.fn(async () => ({
    body: "There are 200 leads.",
    actions: [],
    suggestions: [],
    sources: [],
    questions: [],
    drafts: [],
    memory: [],
    toolCalls: [],
    reasoning: null,
    usage: { model: "claude", inputTokens: 10, outputTokens: 5, detail: null },
  })),
  runArcCampaignTask: vi.fn(async () => ({
    body: "I drafted the first campaign assets.",
    actions: [{ kind: "draft", title: "Email", rows: [], flags: [] }],
    suggestions: ["Review the drafts"],
    sources: [],
    questions: [],
    memory: [],
    toolCalls: [],
  })),
  runArcOpportunityScan: vi.fn(async () => ({
    actions: [{ kind: "opportunity", title: "Dormant company", rows: [], flags: [] }],
    suggestions: [],
    sources: [],
    questions: [],
    memory: [],
    usage: { model: "claude", inputTokens: 10, outputTokens: 20, detail: null },
  })),
}));

function client() {
  return {
    postChatReply: vi.fn(async () => {}),
    apiPost: vi.fn(async () => ({})),
    postUsage: vi.fn(async () => {}),
  } as unknown as ArcClient & {
    postChatReply: ReturnType<typeof vi.fn>;
    apiPost: ReturnType<typeof vi.fn>;
    postUsage: ReturnType<typeof vi.fn>;
  };
}

describe("handleChatMessage", () => {
  it("records the runner-measured duration with the final reply", async () => {
    const fakeClient = client();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000));
    vi.mocked(runArcTurn).mockImplementationOnce(async () => {
      vi.setSystemTime(new Date(2_450));
      return {
        body: "There are 200 leads.",
        actions: [],
        suggestions: [],
        sources: [],
        questions: [],
        drafts: [],
        memory: [],
        toolCalls: [],
        reasoning: null,
        usage: { model: "claude", inputTokens: 10, outputTokens: 5, detail: null },
      };
    });

    await handleChatMessage(fakeClient, {} as Config, {
      type: "arc_chat_message",
      messageId: "message-1",
      conversationId: "conversation-1",
      projectId: null,
      campaignId: null,
      agentTaskId: "task-1",
      message: "Count the leads.",
      mentions: [],
      operator: "Operator",
      route: "fast",
      mode: "ask",
    });

    expect(runArcTurn).toHaveBeenCalled();
    expect(fakeClient.postChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ runDurationMs: 1_450 }),
      }),
    );
    vi.useRealTimers();
  });
});

describe("handleCampaignTask", () => {
  it("runs a campaign task in Arc and posts the reply to the linked conversation", async () => {
    const fakeClient = client();

    await handleCampaignTask(fakeClient, {} as Config, {
      type: "arc_campaign_task",
      agentTaskId: "task-1",
      campaignId: "campaign-1",
      conversationId: "conversation-1",
      message: "Build this campaign.",
      operator: "Operator",
      taskType: "campaign_brief_draft",
    });

    expect(runArcCampaignTask).toHaveBeenCalledWith(
      expect.objectContaining({
        agentTaskId: "task-1",
        campaignId: "campaign-1",
        conversationId: "conversation-1",
        taskType: "campaign_brief_draft",
      }),
      fakeClient,
    );
    expect(fakeClient.postChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        agentTaskId: "task-1",
        body: "I drafted the first campaign assets.",
        status: "complete",
        metadata: expect.objectContaining({
          actions: [expect.objectContaining({ title: "Email" })],
          suggestions: ["Review the drafts"],
        }),
      }),
    );
    expect(fakeClient.apiPost).not.toHaveBeenCalledWith(expect.stringContaining("/complete"), expect.anything());
  });

  it("completes a campaign task through the Operations API when no chat conversation is linked", async () => {
    const fakeClient = client();

    await handleCampaignTask(fakeClient, {} as Config, {
      type: "arc_campaign_task",
      agentTaskId: "task-2",
      campaignId: "campaign-1",
      conversationId: null,
      message: "Keep building this campaign.",
      operator: "Operator",
      taskType: "campaign_directive",
    });

    expect(fakeClient.postChatReply).not.toHaveBeenCalled();
    expect(fakeClient.apiPost).toHaveBeenCalledWith(
      "/api/v1/arc/tasks/task-2/complete",
      expect.objectContaining({
        summary: "I drafted the first campaign assets.",
        outputs: expect.objectContaining({
          actions: [expect.objectContaining({ title: "Email" })],
        }),
      }),
    );
  });

  it("writes the turn's tool calls to metadata.toolCalls", async () => {
    // BSR-618: the app has read this field on three surfaces since the chat
    // shipped, and no producer ever wrote it — invisible because the only
    // things that populated it were the app's own demo fixtures. This asserts
    // the producer, so removing the capture fails here rather than in prod.
    const fakeClient = client();

    vi.mocked(runArcCampaignTask).mockResolvedValueOnce({
      body: "I drafted campaign assets.",
      actions: [],
      suggestions: [],
      sources: [],
      questions: [],
      drafts: [],
      memory: [],
      toolCalls: [
        { name: "crm_search", status: "complete", input: '{"persona":"high_intent"}', output: "142 rows" },
        { name: "weather_lookup", status: "error", output: "timeout" },
      ],
      usage: { model: "claude-sonnet-4-5", inputTokens: null, outputTokens: null, detail: null },
    });

    await handleCampaignTask(fakeClient, {} as Config, {
      type: "arc_campaign_task",
      agentTaskId: "task-4",
      campaignId: "campaign-3",
      conversationId: "conversation-3",
      message: "Build this campaign.",
      operator: "Operator",
      taskType: "campaign_brief_draft",
    });

    expect(fakeClient.postChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          toolCalls: [
            expect.objectContaining({ name: "crm_search", status: "complete" }),
            expect.objectContaining({ name: "weather_lookup", status: "error" }),
          ],
        }),
      }),
    );
  });

  it("omits metadata.toolCalls entirely when the turn called nothing", async () => {
    // An empty array would make every ask-mode reply carry a field that says
    // nothing, and the app treats presence as meaningful.
    const fakeClient = client();

    await handleCampaignTask(fakeClient, {} as Config, {
      type: "arc_campaign_task",
      agentTaskId: "task-5",
      campaignId: "campaign-4",
      conversationId: "conversation-4",
      message: "Keep going.",
      operator: "Operator",
      taskType: "campaign_directive",
    });

    const call = fakeClient.postChatReply.mock.calls.at(-1)?.[0] as { metadata?: Record<string, unknown> };
    expect(call.metadata).not.toHaveProperty("toolCalls");
  });

  it("surfaces recalled memory as metadata.recall when memory items are present", async () => {
    const fakeClient = client();

    vi.mocked(runArcCampaignTask).mockResolvedValueOnce({
      body: "I drafted campaign assets using recalled memory.",
      actions: [],
      suggestions: [],
      sources: [],
      questions: [],
      drafts: [],
      memory: [{ label: "Landlord playbook", summary: null, kind: "note", confidence: 0.8, nodeId: "n1" }],
      toolCalls: [],
      usage: { model: "claude-sonnet-4-5", inputTokens: null, outputTokens: null, detail: null },
    });

    await handleCampaignTask(fakeClient, {} as Config, {
      type: "arc_campaign_task",
      agentTaskId: "task-3",
      campaignId: "campaign-2",
      conversationId: "conversation-2",
      message: "Build this campaign.",
      operator: "Operator",
      taskType: "campaign_brief_draft",
    });

    expect(fakeClient.postChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        agentTaskId: "task-3",
        metadata: expect.objectContaining({
          recall: [expect.objectContaining({ label: "Landlord playbook", confidence: 0.8 })],
        }),
      }),
    );
  });
});

describe("handleOpportunityScan", () => {
  it("settles the agent_task via /complete after a successful scan", async () => {
    const fakeClient = client();

    await handleOpportunityScan(fakeClient, {} as Config, {
      type: "arc_opportunity_scan",
      agentTaskId: "scan-1",
      message: "Survey the CRM and propose opportunities.",
      operator: "Scheduled scan",
    });

    expect(runArcOpportunityScan).toHaveBeenCalled();
    // The real defect this guards: the scan used to only post usage and never
    // settle the task, so it sat in the inbox as `queued` forever.
    expect(fakeClient.apiPost).toHaveBeenCalledWith(
      "/api/v1/arc/tasks/scan-1/complete",
      expect.objectContaining({
        outputs: expect.objectContaining({
          actions: [expect.objectContaining({ title: "Dormant company" })],
        }),
      }),
    );
  });

  it("blocks the task when the scan run throws", async () => {
    const fakeClient = client();
    vi.mocked(runArcOpportunityScan).mockRejectedValueOnce(new Error("boom"));

    await handleOpportunityScan(fakeClient, {} as Config, {
      type: "arc_opportunity_scan",
      agentTaskId: "scan-2",
      message: "Survey the CRM and propose opportunities.",
      operator: "Scheduled scan",
    });

    expect(fakeClient.apiPost).toHaveBeenCalledWith(
      "/api/v1/arc/tasks/scan-2/block",
      expect.objectContaining({ reason: expect.stringContaining("opportunity scan") }),
    );
  });
});

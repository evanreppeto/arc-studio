import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createArcClient } from "../../../../../../apps/arc-runner/src/arc-client";
import type { Config } from "../../../../../../apps/arc-runner/src/config";
import { applyArcStreamFrame, type ArcStreamFrame, type ArcStreamOverlay } from "@/lib/arc-chat/live-stream";

type FakePendingMessage = {
  id: string;
  conversationId: string;
  role: "arc";
  body: string;
  status: "pending";
  reasoning: string | null;
  steps: Array<{ label: string; status: "running" | "done"; at: string }>;
};

const streamState = vi.hoisted(() => ({
  frames: [] as Array<Record<string, unknown>>,
  database: null as FakePendingMessage | null,
}));

vi.mock("@/lib/auth/operator", () => ({
  requireOperator: vi.fn(async () => undefined),
}));
vi.mock("@/lib/arc-chat/sharing", () => ({
  assertConversationAccess: vi.fn(async () => ({})),
}));
vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: vi.fn(() => true),
  getSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/lib/auth/api-token", () => ({
  checkAgentBearer: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/api/v1/arc/_lib/http", () => ({
  arcGuard: vi.fn(async () => ({ ok: true, scope: { orgId: "org-1", workspaceId: "workspace-1" } })),
}));
vi.mock("@/lib/arc-chat/persistence", () => ({
  getPendingArcMessage: vi.fn(async () => streamState.frames.shift() ?? null),
  streamArcMessageBody: vi.fn(async ({ body }: { body: string }) => {
    streamState.database = { ...streamState.database!, body };
    streamState.frames.push(structuredClone(streamState.database));
  }),
  streamArcMessageReasoning: vi.fn(async ({ reasoning }: { reasoning: string }) => {
    streamState.database = { ...streamState.database!, reasoning };
    streamState.frames.push(structuredClone(streamState.database));
  }),
  appendArcStep: vi.fn(async ({ label, status, at }: { label: string; status: "running" | "done"; at: string }) => {
    const database = streamState.database!;
    const matchingRunning = [...database.steps]
      .map((step, index) => ({ step, index }))
      .reverse()
      .find(({ step }) => step.label === label && step.status === "running");
    const next = { label, status, at };
    streamState.database = {
      ...database,
      steps: status === "done" && matchingRunning
        ? database.steps.map((step, index) => index === matchingRunning.index ? next : step)
        : [...database.steps, next],
    };
    streamState.frames.push(structuredClone(streamState.database));
    return true;
  }),
}));

import { GET } from "./route";
import { POST as postBody } from "@/app/api/v1/arc/messages/[agentTaskId]/body/route";
import { POST as postReasoning } from "@/app/api/v1/arc/messages/[agentTaskId]/reasoning/route";
import { POST as postStep } from "@/app/api/v1/arc/messages/[agentTaskId]/steps/route";

const config: Config = {
  appApiBaseUrl: "https://app.example",
  arcAgentApiToken: "runner-token",
  webhookSecret: null,
  port: 8788,
  webhookPath: "/webhooks/growth-chat",
  maxConcurrentRuns: 4,
  maxConcurrentRunsPerWorkspace: 2,
  commit: null,
};

function baseMessage(): FakePendingMessage {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    role: "arc",
    body: "",
    status: "pending",
    reasoning: null,
    steps: [] as Array<{ label: string; status: "running" | "done"; at: string }>,
  };
}

async function readAll(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return text;
    text += decoder.decode(value, { stream: true });
  }
}

function dataFrames(body: string): ArcStreamFrame[] {
  return body
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => JSON.parse(block.slice("data: ".length)) as ArcStreamFrame);
}

beforeEach(() => {
  streamState.frames = [];
  streamState.database = baseMessage();

  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const agentTaskId = url.match(/\/messages\/([^/]+)\//u)?.[1] ?? "task-1";
    const request = new Request(url, {
      method: init?.method ?? "POST",
      headers: init?.headers,
      body: init?.body,
    });

    if (url.endsWith("/steps")) return postStep(request, { params: Promise.resolve({ agentTaskId }) });
    if (url.endsWith("/reasoning")) return postReasoning(request, { params: Promise.resolve({ agentTaskId }) });
    if (url.endsWith("/body")) return postBody(request, { params: Promise.resolve({ agentTaskId }) });
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Arc runner -> database -> SSE -> React stream contract", () => {
  it("preserves progressive reasoning and replaces cumulative text without duplication", async () => {
    const client = createArcClient(config, { orgId: "org-1", workspaceId: "workspace-1" });

    await client.postStep("task-1", "Searching campaign records", "running");
    await client.postChatThinking("task-1", "Comparing campaign performance");
    await client.postChatChunk("task-1", "The strongest ");
    await client.postChatChunk("task-1", "The strongest audience is past customers.");
    await client.postStep("task-1", "Searching campaign records", "done");

    const response = await GET(new Request("http://localhost/api/arc/stream/conversation-1"), {
      params: Promise.resolve({ conversationId: "conversation-1" }),
    });
    const wireBody = await readAll(response);
    const frames = dataFrames(wireBody);
    let overlay: ArcStreamOverlay | null = null;

    for (const frame of frames) overlay = applyArcStreamFrame(overlay, frame);

    expect(frames.length).toBeGreaterThanOrEqual(4);
    expect(overlay).toEqual({
      id: "message-1",
      body: "The strongest audience is past customers.",
      reasoning: "Comparing campaign performance",
      steps: [{ label: "Searching campaign records", status: "done", at: expect.any(String) }],
    });
    expect(overlay?.body).not.toContain("The strongest The strongest");
    expect(wireBody).toContain("event: done");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Arc must narrate its own phases, not just its tool calls.
 *
 * The regression this guards is a silent one: `step` was threaded into every
 * runner entry point and only ever called from `tools/*`. So a turn reported
 * nothing while it fetched context, nothing while the model reasoned, and — for
 * an ask-mode turn that uses no tools — nothing for its entire run. Everything
 * type-checked and every test passed; the chat just sat there saying "Thinking"
 * with an empty activity list.
 */

const sdkMessages: unknown[] = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: () => ({}),
  tool: (name: string, description: string, schema: unknown, handler: unknown) => ({ name, description, schema, handler }),
  query: () => (async function* () {
    for (const message of sdkMessages) yield message;
  })(),
}));

// Partial mock: only the network reads are stubbed, so the real formatHistory /
// prompt assembly still runs and this exercises the actual turn path.
vi.mock("./context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./context")>()),
  resolveBusinessContext: async () => ({}),
  resolveRecallMemory: async () => ({ facts: [], nodes: [] }),
}));
vi.mock("./conversation-context", () => ({
  fetchConversationContext: async () => ({ history: [], summary: null, overflow: [] }),
}));
vi.mock("./workspace-summary", () => ({ resolveWorkspaceSummary: async () => null }));
vi.mock("./connectors", () => ({
  fetchRemoteConnectors: async () => [],
  buildRemoteMcp: () => ({ mcpServers: {}, allowedTools: [] }),
  remoteConnectorsAllowedForMode: () => false,
}));
vi.mock("./media-config", () => ({
  fetchMediaConfig: async () => null,
  mediaConfigAllowedForMode: () => false,
}));

type StepCall = { label: string; status: "running" | "done" };

function makeClient(steps: StepCall[]) {
  return {
    apiGet: async () => ({}),
    apiPost: async () => ({}),
    apiPut: async () => ({}),
    postChatReply: async () => {},
    postStep: async (_taskId: string, label: string, status: "running" | "done") => {
      steps.push({ label, status });
    },
    postChatChunk: async () => {},
    postChatThinking: async () => {},
    postUsage: async () => {},
  };
}

const payload = {
  agentTaskId: "task-1",
  conversationId: "conv-1",
  messageId: "msg-1",
  message: "How many leads do we have?",
  mode: "ask",
  history: [],
  mentions: [],
  operator: "someone@example.test",
} as never;

describe("runArcTurn phase narration", () => {
  beforeEach(() => {
    sdkMessages.length = 0;
  });

  it("reports its own phases on a turn that calls no tools at all", async () => {
    sdkMessages.push(
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "You have 200." } } },
      { type: "assistant", message: { content: [{ type: "text", text: "You have 200." }] } },
      { type: "result", subtype: "success", result: "You have 200." },
    );

    const steps: StepCall[] = [];
    const { runArcTurn } = await import("./arc");
    await runArcTurn(payload, makeClient(steps) as never);

    const labels = steps.map((s) => s.label);
    // The phases the reader used to spend staring at an empty spinner.
    expect(labels).toContain("Reading your workspace");
    expect(labels).toContain("Working out an answer");
    expect(labels).toContain("Writing the reply");

    // Every phase that starts also finishes, so no row is left spinning.
    for (const label of new Set(labels)) {
      const forLabel = steps.filter((s) => s.label === label);
      expect(forLabel.at(0)?.status, `${label} should start as running`).toBe("running");
      expect(forLabel.at(-1)?.status, `${label} should end as done`).toBe("done");
    }
  });

  it("closes the reasoning phase when the turn streams no prose", async () => {
    sdkMessages.push({ type: "result", subtype: "success", result: "" });

    const steps: StepCall[] = [];
    const { runArcTurn } = await import("./arc");
    await runArcTurn(payload, makeClient(steps) as never);

    // Never entered the writing phase...
    expect(steps.some((s) => s.label === "Writing the reply")).toBe(false);
    // ...so reasoning is the phase that has to be closed, or it spins forever.
    const reasoning = steps.filter((s) => s.label === "Working out an answer");
    expect(reasoning.at(-1)?.status).toBe("done");
  });
});

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

type StepCall = { label: string; status: "running" | "done"; detail?: string | null };

function makeClient(steps: StepCall[]) {
  return {
    apiGet: async () => ({}),
    apiPost: async () => ({}),
    apiPut: async () => ({}),
    postChatReply: async () => {},
    postStep: async (_taskId: string, label: string, status: "running" | "done", detail?: string | null) => {
      steps.push({ label, status, detail });
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
    // Narration entries are excluded: they are a line Arc wrote, not a unit of
    // work, so they are emitted once as `done` and have no running edge.
    for (const label of new Set(labels.filter((label) => label !== "Arc"))) {
      const forLabel = steps.filter((s) => s.label === label);
      expect(forLabel.at(0)?.status, `${label} should start as running`).toBe("running");
      expect(forLabel.at(-1)?.status, `${label} should end as done`).toBe("done");
    }

    const narration = steps.filter((s) => s.label === "Arc");
    expect(narration.every((s) => s.status === "done")).toBe(true);
  });

  // The gap this closes: every phase opened before the model had thought
  // anything, so quoting only on the opening edge left them all as bare labels —
  // the narration feature was invisible on a turn that used no tools.
  it("reports the reasoning a phase produced, not just its label", async () => {
    sdkMessages.push(
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "The CRM looks empty, so I should say that plainly rather than guess." } } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "It's empty." } } },
      { type: "assistant", message: { content: [{ type: "text", text: "It's empty." }] } },
      { type: "result", subtype: "success", result: "It's empty." },
    );

    const steps: StepCall[] = [];
    const { runArcTurn } = await import("./arc");
    await runArcTurn(payload, makeClient(steps) as never);

    const reasoningClose = steps.find((s) => s.label === "Working out an answer" && s.status === "done");
    expect(reasoningClose?.detail).toContain("say that plainly");

    // The phases that run before the model does still carry nothing — there is
    // genuinely no reasoning behind them, and inventing some would be worse.
    const contextOpen = steps.find((s) => s.label === "Reading your workspace" && s.status === "running");
    expect(contextOpen?.detail ?? null).toBeNull();
  });

  // BSR-574. Arc's thinking is redacted and always arrives empty (BSR-573), so
  // the narration source is the prose Arc writes before it acts — verified
  // against a real run before this was built: a turn's blocks read
  // "… text / tool_use / tool_use / text …".
  it("emits Arc's prose as its own ordered trace entry", async () => {
    sdkMessages.push(
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "x" } } },
      { type: "assistant", message: { content: [{ type: "text", text: "The CRM is the only live source here, so I'll search it before answering." }] } },
      { type: "result", subtype: "success", result: "It's empty." },
    );

    const steps: StepCall[] = [];
    const { runArcTurn } = await import("./arc");
    await runArcTurn(payload, makeClient(steps) as never);

    // Emitted in place, as its own entry, rather than handed to a step — the
    // previous approach needed the text to be processed before the tool that
    // follows it reported, and it isn't, so a whole run's tool steps came back
    // with no narration at all.
    const narrated = steps.filter((s) => s.label === "Arc" && s.detail?.includes("search it before answering"));
    expect(narrated).toHaveLength(1);
    expect(narrated[0]!.status).toBe("done");
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

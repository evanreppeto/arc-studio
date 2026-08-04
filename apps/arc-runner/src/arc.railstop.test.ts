import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A turn that trips one of our own runaway rails must not throw away the answer.
 *
 * The regression: `maxTurns`/`maxBudgetUsd` are reported by the SDK as an error
 * result, which unwinds the whole run — so on 2026-08-04 a Studio question spent
 * its 12 fast-tier turns reading the workspace and the operator got "Arc hit an
 * error generating a reply. Check the runner logs." Everything Arc had written
 * went with the exception, including the part that answered the question.
 */

const sdkMessages: unknown[] = [];
/** Thrown by the mocked stream after the messages above are yielded. */
let sdkError: Error | null = null;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: () => ({}),
  tool: (name: string, description: string, schema: unknown, handler: unknown) => ({ name, description, schema, handler }),
  query: () => (async function* () {
    for (const message of sdkMessages) yield message;
    if (sdkError) throw sdkError;
  })(),
}));

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

function makeClient() {
  return {
    apiGet: async () => ({}),
    apiPost: async () => ({}),
    apiPut: async () => ({}),
    postChatReply: async () => {},
    postStep: async () => {},
    postChatChunk: async () => {},
    postChatThinking: async () => {},
    postUsage: async () => {},
  };
}

const payload = {
  route: "fast" as const,
  agentTaskId: "task-1",
  conversationId: "conv-1",
  messageId: "msg-1",
  message: "can you put our logo on the side of the car please",
  mode: "act",
  history: [],
  mentions: [],
  operator: "someone@example.test",
} as never;

const MAX_TURNS_ERROR = new Error("Claude Code returned an error result: Reached maximum number of turns (12)");

describe("a run that stops on a runaway rail", () => {
  beforeEach(() => {
    sdkMessages.length = 0;
    sdkError = null;
  });

  it("returns what Arc had already written, and says it was cut short", async () => {
    sdkMessages.push({
      type: "assistant",
      message: { content: [{ type: "text", text: "Your logo is composited on top, not painted into the scene." }] },
    });
    sdkError = MAX_TURNS_ERROR;

    const { runArcTurn } = await import("./arc");
    const result = await runArcTurn(payload, makeClient() as never);

    expect(result.body).toContain("composited on top");
    // Names the limit and the tier: "Arc hit an error" left the operator with
    // no next move, and the same request often finishes with more room.
    expect(result.body).toMatch(/\d+-step limit/);
    expect(result.body).toContain("Arc Spark");
    expect(result.body).toContain("Arc Forge");
  });

  it("still fails the turn when the rail was hit before Arc wrote anything", async () => {
    sdkError = MAX_TURNS_ERROR;

    const { runArcTurn } = await import("./arc");
    // Nothing to salvage — an empty bubble would be worse than the error.
    await expect(runArcTurn(payload, makeClient() as never)).rejects.toThrow(/maximum number of turns/);
  });

  it("does not swallow a failure that is not one of our rails", async () => {
    sdkMessages.push({ type: "assistant", message: { content: [{ type: "text", text: "Partial answer." }] } });
    sdkError = new Error("socket hang up");

    const { runArcTurn } = await import("./arc");
    await expect(runArcTurn(payload, makeClient() as never)).rejects.toThrow(/socket hang up/);
  });
});

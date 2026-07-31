import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The runner must record what Arc actually called (BSR-618).
 *
 * `persistence.ts` in the app documented a "RUNNER CONTRACT" for
 * `metadata.toolCalls` since the chat shipped, and nothing wrote it. A prod
 * census found zero rows carrying the field on any day the table had existed,
 * while three surfaces read it. It type-checked and every test passed, because
 * the only things that ever populated `toolCalls` were the app's demo fixtures.
 *
 * These tests run the real SDK loop against a scripted stream, so they fail if
 * the capture is removed — which is the guard the ticket asked for, and the one
 * a parser test can never be.
 */

const sdkMessages: unknown[] = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: () => ({}),
  tool: (name: string, description: string, schema: unknown, handler: unknown) => ({ name, description, schema, handler }),
  query: () => (async function* () {
    for (const message of sdkMessages) yield message;
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

const client = {
  apiGet: async () => ({}),
  apiPost: async () => ({}),
  apiPut: async () => ({}),
  postChatReply: async () => {},
  postStep: async () => {},
  postChatChunk: async () => {},
  postChatThinking: async () => {},
  postUsage: async () => {},
} as never;

const payload = {
  agentTaskId: "task-1",
  conversationId: "conv-1",
  messageId: "msg-1",
  message: "How many high-intent accounts do we have?",
  mode: "ask",
  history: [],
  mentions: [],
  operator: "someone@example.test",
} as never;

/** One completed call, as the SDK actually delivers it: the `tool_use` on an
 *  assistant turn, the `tool_result` on the synthetic user turn that follows. */
function scriptCall(id: string, name: string, input: unknown, output: unknown, isError = false) {
  return [
    { type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: output, is_error: isError }] } },
  ];
}

describe("runArcTurn tool-call capture", () => {
  beforeEach(() => {
    sdkMessages.length = 0;
  });

  it("records a tool call, its arguments, and what came back", async () => {
    sdkMessages.push(
      ...scriptCall("t1", "crm_search", { persona: "high_intent", limit: 25 }, "142 accounts matched"),
      { type: "assistant", message: { content: [{ type: "text", text: "You have 142." }] } },
      { type: "result", subtype: "success", result: "You have 142." },
    );

    const { runArcTurn } = await import("./arc");
    const result = await runArcTurn(payload, client);

    expect(result.toolCalls).toEqual([
      {
        name: "crm_search",
        status: "complete",
        input: '{"persona":"high_intent","limit":25}',
        output: "142 accounts matched",
      },
    ]);
  });

  it("records a failed tool as an error, so a broken run cannot read as a clean one", async () => {
    sdkMessages.push(
      ...scriptCall("t1", "weather_lookup", { region: "chicago" }, "weather_lookup failed: timeout", true),
      { type: "result", subtype: "success", result: "I could not reach the weather service." },
    );

    const { runArcTurn } = await import("./arc");
    const result = await runArcTurn(payload, client);

    expect(result.toolCalls[0]).toMatchObject({ name: "weather_lookup", status: "error" });
  });

  it("keeps several calls in the order they ran", async () => {
    sdkMessages.push(
      ...scriptCall("t1", "crm_search", {}, "142 rows"),
      ...scriptCall("t2", "score_lead", {}, "scored"),
      ...scriptCall("t3", "create_campaign_draft", {}, "draft-1"),
      { type: "result", subtype: "success", result: "Done." },
    );

    const { runArcTurn } = await import("./arc");
    const result = await runArcTurn(payload, client);

    expect(result.toolCalls.map((call) => call.name)).toEqual(["crm_search", "score_lead", "create_campaign_draft"]);
    expect(result.toolCalls.every((call) => call.status === "complete")).toBe(true);
  });

  it("flattens a result delivered as content blocks", async () => {
    sdkMessages.push(
      ...scriptCall("t1", "brand_read", {}, [{ type: "text", text: "Brand voice: plain, direct." }]),
      { type: "result", subtype: "success", result: "Read the brand kit." },
    );

    const { runArcTurn } = await import("./arc");
    const result = await runArcTurn(payload, client);

    expect(result.toolCalls[0]!.output).toBe("Brand voice: plain, direct.");
  });

  it("returns an empty record for a turn that called nothing, not a missing field", async () => {
    // ask-mode turns often use no tools at all. The field must still be present
    // and iterable — the app spreads it into run rows.
    sdkMessages.push(
      { type: "assistant", message: { content: [{ type: "text", text: "About 200." }] } },
      { type: "result", subtype: "success", result: "About 200." },
    );

    const { runArcTurn } = await import("./arc");
    const result = await runArcTurn(payload, client);

    expect(result.toolCalls).toEqual([]);
  });

  it("leaves a call whose result never arrived as running", async () => {
    sdkMessages.push(
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "media_generate", input: {} }] } },
      { type: "result", subtype: "success", result: "Started the render." },
    );

    const { runArcTurn } = await import("./arc");
    const result = await runArcTurn(payload, client);

    expect(result.toolCalls[0]).toMatchObject({ name: "media_generate", status: "running" });
  });

  it("redacts a credential that reaches a tool argument", async () => {
    sdkMessages.push(
      ...scriptCall("t1", "connector_call", { apiKey: "sk-live-secret", region: "chicago" }, "ok"),
      { type: "result", subtype: "success", result: "Done." },
    );

    const { runArcTurn } = await import("./arc");
    const result = await runArcTurn(payload, client);

    expect(result.toolCalls[0]!.input).not.toContain("sk-live-secret");
    expect(result.toolCalls[0]!.input).toContain("[redacted]");
    expect(result.toolCalls[0]!.input).toContain("chicago");
  });
});

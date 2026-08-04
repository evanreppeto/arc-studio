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

/**
 * Ordered record of steps AND the setup fetches, so a test can assert which
 * happened first. The phase has to OPEN before the work it describes, or the
 * status line has nothing running to name and falls back to a bare "Thinking".
 */
const timeline: string[] = [];
/** Work modes gate the connector + media reads; flip per test. */
let workModesOn = false;

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
  fetchRemoteConnectors: async () => {
    timeline.push("fetch:connectors");
    return [];
  },
  buildRemoteMcp: () => ({ mcpServers: {}, allowedTools: [] }),
  remoteConnectorsAllowedForMode: () => workModesOn,
}));
vi.mock("./media-config", () => ({
  fetchMediaConfig: async () => {
    timeline.push("fetch:media");
    return null;
  },
  mediaConfigAllowedForMode: () => workModesOn,
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
      timeline.push(`step:${label}(${status})`);
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
    timeline.length = 0;
    workModesOn = false;
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

  // Option 2: the trace owns Arc's commentary, the reply owns the answer.
  // The hazard is withholding too much — assembleReplyBody exists because a turn
  // that answered, called a tool, then closed was reporting only its closing
  // next-steps and losing the finding.
  it("moves pre-tool commentary into the trace but never withholds the closing message", async () => {
    sdkMessages.push(
      { type: "assistant", message: { content: [{ type: "text", text: "First up: CRM contacts — let me pull the live list." }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "search_contacts", input: {} }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "Confirmed empty: zero contacts on file." }] } },
      { type: "result", subtype: "success", result: "Confirmed empty: zero contacts on file." },
    );

    const steps: StepCall[] = [];
    const { runArcTurn } = await import("./arc");
    const result = await runArcTurn(payload, makeClient(steps) as never);

    // The commentary moved to the trace...
    const narration = steps.filter((s) => s.label === "Arc").map((s) => s.detail ?? "");
    expect(narration.some((n) => n.includes("let me pull the live list"))).toBe(true);
    // ...and out of the reply, so it isn't read twice.
    expect(result.body).not.toContain("let me pull the live list");
    // ...but the closing message is still the answer.
    expect(result.body).toContain("Confirmed empty");
  });

  // The prod regression: withholding every pre-tool chunk left the reply as a
  // closing fragment while the findings sat in the trace.
  it("keeps a mid-run finding in the reply even though a tool follows it", async () => {
    sdkMessages.push(
      { type: "assistant", message: { content: [{ type: "text", text: "**CRM contacts: confirmed empty.** search_contacts returns total: 0.\n\nNow the campaigns." }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "list_campaigns", input: {} }] } },
      { type: "result", subtype: "success", result: "All three reads are done." },
    );

    const steps: StepCall[] = [];
    const { runArcTurn } = await import("./arc");
    const result = await runArcTurn(payload, makeClient(steps) as never);

    expect(result.body).toContain("confirmed empty");
    expect(result.body).toContain("All three reads are done");
  });

  // What is typed must match what lands. A lead-in used to be streamed into the
  // answer and then disappear when the reply was assembled without it.
  it("streams the same body the reply will end up being", async () => {
    const posted: string[] = [];
    sdkMessages.push(
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "First up: CRM contacts." } } },
      { type: "assistant", message: { content: [{ type: "text", text: "First up: CRM contacts." }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "search_contacts", input: {} }] } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Zero contacts on file." } } },
      { type: "assistant", message: { content: [{ type: "text", text: "Zero contacts on file." }] } },
      { type: "result", subtype: "success", result: "Zero contacts on file." },
    );

    const steps: StepCall[] = [];
    const client = makeClient(steps) as unknown as Record<string, unknown>;
    client.postChatChunk = async (_id: string, body: string) => { posted.push(body); };

    const { runArcTurn } = await import("./arc");
    const result = await runArcTurn(payload, client as never);

    // The last thing streamed matches the reply — no content vanishes at the end.
    expect(posted.at(-1)).toBe(result.body);
    // And the lead-in is not in either.
    expect(result.body).not.toContain("First up");
    expect(posted.at(-1) ?? "").not.toContain("First up");
  });

  it("keeps the reply intact when no tool follows the prose", async () => {
    sdkMessages.push(
      { type: "assistant", message: { content: [{ type: "text", text: "The CRM has 200 leads, 52 qualified." }] } },
      { type: "result", subtype: "success", result: "The CRM has 200 leads, 52 qualified." },
    );

    const steps: StepCall[] = [];
    const { runArcTurn } = await import("./arc");
    const result = await runArcTurn(payload, makeClient(steps) as never);

    // Nothing followed it, so it was the answer all along.
    expect(result.body).toContain("200 leads");
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

  // BSR-566's last silent window. The workspace phase used to open AFTER the
  // connector and media reads, so those two network calls ran with no row in
  // `running` and the header fell back to "Thinking · Ns" for exactly as long
  // as they took. Ordering is the whole assertion here — that both fetches
  // happen and the phase closes is not enough.
  it("opens the workspace phase before the connector and media reads", async () => {
    workModesOn = true;
    sdkMessages.push(
      { type: "assistant", message: { content: [{ type: "text", text: "Done." }] } },
      { type: "result", subtype: "success", result: "Done." },
    );

    const steps: StepCall[] = [];
    const { runArcTurn } = await import("./arc");
    await runArcTurn(payload, makeClient(steps) as never);

    const opened = timeline.indexOf("step:Checking what's active right now(running)");
    const connectors = timeline.indexOf("fetch:connectors");
    const media = timeline.indexOf("fetch:media");

    expect(opened, "the workspace phase should be reported").toBeGreaterThanOrEqual(0);
    expect(connectors, "connectors should be fetched in a work mode").toBeGreaterThanOrEqual(0);
    expect(media, "media config should be fetched in a work mode").toBeGreaterThanOrEqual(0);
    expect(opened).toBeLessThan(connectors);
    expect(opened).toBeLessThan(media);
  });

  it("keeps the context and workspace phases adjacent in the step sequence", async () => {
    // NB this one passes against the pre-fix code too, and is not evidence for
    // it: the connector reads emitted no steps either way, so the two phases
    // were always neighbours in the ARRAY. BSR-566 was about a gap in TIME —
    // the test above is the one that proves it. This guards a different thing:
    // that nothing later slips a phase between them.
    workModesOn = true;
    sdkMessages.push(
      { type: "assistant", message: { content: [{ type: "text", text: "Done." }] } },
      { type: "result", subtype: "success", result: "Done." },
    );

    const steps: StepCall[] = [];
    const { runArcTurn } = await import("./arc");
    await runArcTurn(payload, makeClient(steps) as never);

    const phases = steps.filter((s) => s.label !== "Arc");
    const contextDone = phases.findIndex((s) => s.label === "Reading your workspace" && s.status === "done");
    const workspaceOpen = phases.findIndex((s) => s.label === "Checking what's active right now" && s.status === "running");
    expect(contextDone).toBeGreaterThanOrEqual(0);
    expect(workspaceOpen).toBe(contextDone + 1);
  });
});

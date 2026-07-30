import { createSdkMcpServer, query } from "@anthropic-ai/claude-agent-sdk";

import { resolveBusinessContext } from "./business-context";
import { resolveWorkspaceSummary } from "./workspace-summary";
import { buildTurnContentAsync } from "./attachments";
import { buildRecallQuery, resolveRecallMemory, type RecallItem } from "./recall";
import { buildSystemPrompt, formatHistory, type ArcTurnContext } from "./context";
import { buildQueryOptions, inferenceForRoute, type InferenceSettings } from "./inference";
import type { ArcClient } from "./arc-client";
import { ARC_SYSTEM_PROMPT } from "./prompt";
import { allowedToolNames, toolsForMode, type ArcMode, type ToolContext } from "./tools";
import { buildRemoteMcp, fetchRemoteConnectors, remoteConnectorsAllowedForMode } from "./connectors";
import { fetchMediaConfig, mediaConfigAllowedForMode } from "./media-config";
import { fetchConversationContext, persistConversationSummary, type HistoryOverflow } from "./conversation-context";
import { summarizeConversation } from "./summarize";
import { promoteConversationMemory } from "./extract-memory";
import { resolveArcSkill, type ArcSkill } from "./skills";
import { reviewTurnDrafts } from "./critic";
import { createCumulativeStreamBuffer } from "./live-stream-buffer";
import type {
  ArcActionCard,
  ArcCampaignTaskPayload,
  ArcMention,
  ArcOpportunityDraftPayload,
  ArcOpportunityScanPayload,
  ArcQuestion,
  DraftForReview,
  MarkChatMessagePayload,
} from "./types";
import type { StepFn, TurnSink } from "./tools/helpers";

/** What one Arc turn produces: the reply text plus what it attached (cards, suggestions, sources, questions). */
export type ArcTurnResult = {
  body: string;
  actions: ArcActionCard[];
  suggestions: string[];
  sources: ArcMention[];
  questions: ArcQuestion[];
  memory: RecallItem[];
  /** Approval-gated drafts this turn created, with full copy — the critic's work list. */
  drafts: DraftForReview[];
  /** The model's extended-thinking transcript for this turn, preserved so the
   *  completed reply keeps the "Thought for Ns" trace. Null when none was emitted. */
  reasoning?: string | null;
  usage: { model: string; inputTokens: number | null; outputTokens: number | null };
};

/**
 * Run one Arc turn via the Claude Agent SDK and return the final reply text.
 *
 * Stateless per call: all scope/context comes from `payload`, nothing is held in
 * module state, so concurrent chats are independent runs. Memory is the bounded
 * `payload.history` injected as a prompt preamble. The model is chosen by
 * `payload.route`; the system prompt is composed from the business context, the
 * operator's mode, behavior hints, conversation scope, and any @-mentions.
 *
 * Tools: the tool surface is gated by `payload.mode` (ask = read-only; act/draft
 * add CRM-interaction + brain writes). Each tool reports a running -> done step
 * to the chat bubble, producing the live trace. Outbound has no tool in any mode.
 */
const REPLY_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "were", "with",
]);

function replyTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1 && !REPLY_STOP_WORDS.has(token)),
  );
}

function isSubstantiallyRepeated(text: string, finalText: string): boolean {
  if (text === finalText) return true;
  const tokens = replyTokens(text);
  if (tokens.size === 0) return false;
  const finalTokens = replyTokens(finalText);
  let shared = 0;
  for (const token of tokens) if (finalTokens.has(token)) shared += 1;
  return shared / tokens.size >= 0.55;
}

/**
 * Build one final reply without discarding substantive pre-tool findings or
 * repeating a confirmation the model restated after its tool call. The SDK's
 * `result` is the canonical closing message; earlier assistant messages survive
 * only when they add materially distinct information.
 */
export function assembleReplyBody(assistantChunks: string[], resultText: string): string {
  const chunks = assistantChunks.map((chunk) => chunk.trim()).filter(Boolean);
  const finalText = resultText.trim() || chunks.at(-1) || "";
  if (!finalText) return "";
  const distinctEarlier = chunks.filter((chunk) => !isSubstantiallyRepeated(chunk, finalText));
  return [...distinctEarlier, finalText].join("\n\n");
}

/**
 * Is this a lead-in — "I'll check the CRM first" — rather than a finding?
 *
 * Withholding every pre-tool chunk from the reply was too blunt. Arc reports as
 * it goes, so a turn that checked three things wrote its findings in the chunks
 * *between* tool calls: withholding them left a 143-character reply reading
 * "All three reads are done — nothing changed. Summary above" while the summary
 * itself sat in the trace. That is the failure `assembleReplyBody` exists to
 * prevent, arrived at from the other direction.
 *
 * A lead-in is short and unstructured: one breath before acting. Anything with
 * length, line breaks, bullets, or headings is doing real work and stays in the
 * reply — where, being present, the chat's own suppression keeps it from also
 * being read in the trace.
 *
 * Wrong in the safe direction by construction: misjudging a lead-in as a finding
 * shows one extra line in the answer; the reverse deletes findings.
 */
const LEAD_IN_MAX_CHARS = 200;

export function isLeadIn(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > LEAD_IN_MAX_CHARS) return false;
  // Structure means it is presenting something, not announcing something.
  return !/\n|^[-*#>|]|\d\./m.test(trimmed);
}

/** Fresh per-turn collectors plus the sink that feeds them. */
function makeSink() {
  const actions: ArcActionCard[] = [];
  const suggestions: string[] = [];
  const sources: ArcMention[] = [];
  const questions: ArcQuestion[] = [];
  const drafts: DraftForReview[] = [];
  const sink: TurnSink = {
    card: (card) => actions.push(card),
    suggestion: (text) => suggestions.push(text),
    source: (mention) => sources.push(mention),
    question: (question) => questions.push(question),
    draft: (draft) => drafts.push(draft),
  };
  return { actions, suggestions, sources, questions, drafts, sink };
}

/**
 * Drive one Agent SDK query loop and assemble the ArcTurnResult. Shared by
 * runArcTurn (chat) and runArcOpportunityDraft (opportunity drafting): both
 * build their own ctx/prompt/tools, then hand off the same machinery here.
 */
/** Min gap between live partial-body posts, so streaming doesn't hammer the app
 *  endpoint. Kept just under the app's active poll (~120ms) so a chunk is usually
 *  waiting when the poll fires, rather than landing a full poll-interval late; the
 *  posts are awaited serially, so an app round-trip slower than this is the real
 *  floor. The client typewriter smooths between chunks either way. */
const STREAM_THROTTLE_MS = 90;

/**
 * The run's own phases, reported the same way tool calls already are.
 *
 * Each label names what the code is actually doing at that moment. That
 * constraint is the point: a trace that invents plausible-sounding activity is
 * worse than one that says nothing, because it can't be caught being wrong.
 * Keep them plain, present-tense, and free of internal vocabulary — the reader
 * is waiting on an answer, not reading our call stack.
 */
const STEP_CONTEXT = "Reading your workspace";
const STEP_WORKSPACE = "Checking what's active right now";
const STEP_REASONING = "Working out an answer";
const STEP_WRITING = "Writing the reply";
/** A line of Arc's own prose, carried as a trace entry rather than a phase. The
 *  chat renders these as prose and shows no label, so this string is a fallback
 *  that only surfaces if that rendering is ever missed. */
const STEP_NARRATION = "Arc";

/** The model input for a turn: a plain string, or content blocks for multimodal. */
type TurnContent = Awaited<ReturnType<typeof buildTurnContentAsync>>;

/** Adapt our turn content into the SDK's prompt input. A plain string stays a
 *  string (unchanged path); content blocks are wrapped in a single streamed
 *  user message so images/documents/text reach the model. */
function promptInput(content: TurnContent, sessionId: string) {
  if (typeof content === "string") return content;
  async function* once() {
    yield {
      type: "user" as const,
      session_id: sessionId,
      parent_tool_use_id: null,
      message: { role: "user" as const, content },
    };
  }
  return once();
}

async function runArcQuery(opts: {
  step: StepFn;
  mode: ArcMode;
  ctx: ArcTurnContext;
  client: ArcClient;
  content: TurnContent;
  inference: InferenceSettings;
  toolContext?: ToolContext;
  skill?: ArcSkill | null;
  /** Live partial reply text, posted as the model streams (chat-turn only). */
  onPartial?: (text: string) => void | Promise<void>;
  /** Live partial reasoning, posted as the model thinks (chat-turn only). */
  onThinking?: (text: string) => void | Promise<void>;
}): Promise<ArcTurnResult> {
  const { actions, suggestions, sources, questions, drafts, sink } = makeSink();

  // Interleaving of block arrivals and step() calls. The previous attempt
  // assumed a text block would be processed before the tool that follows it
  // reported — it wasn't, and nothing in the code said so. This records the
  // real order, bounded so a long turn can't flood the log.
  const timeline: string[] = [];
  const startedAtMs = Date.now();
  const mark = (what: string) => {
    if (timeline.length < 24) timeline.push(`+${Date.now() - startedAtMs}ms ${what}`);
  };

  // Live-thinking buffer, accumulated from thinking-token deltas. It feeds the
  // "Thinking…" stream, and — because it is declared before the tools — it also
  // lets each reported step carry the reasoning that led to it.
  const thinkingStream = createCumulativeStreamBuffer({
    onEmit: opts.onThinking,
    throttleMs: STREAM_THROTTLE_MS,
  });

  /**
   * Report a step, quoting the thinking that happened since the previous one.
   *
   * This is the honest version of the narration Codex shows: not a summary
   * invented after the fact, and not the thinking transcript sliced arbitrarily,
   * but the actual reasoning that ran between the last action and this one.
   * Closing a step passes nothing — the stored narration is preserved.
   */
  /**
   * The prose Arc wrote just before it acted — the narration source.
   *
   * Confirmed against a real run before this was built: a turn's block sequence
   * reads `… thinking / text / tool_use / tool_use / thinking / text / tool_use …`,
   * so Arc genuinely writes an explanation and then acts on it. That text is
   * what Codex shows; the private thinking it appeared to show is redacted and
   * arrives empty (BSR-573).
   *
   * This is only ever *copied* to the step. It is never removed from the reply:
   * pre-tool text is sometimes substantive answer content — `assembleReplyBody`
   * exists precisely because a turn that answered, called a tool, then closed
   * was losing its finding — so withholding by position would trade a silent
   * empty trace for a silently truncated answer. The chat suppresses narration
   * that also appears in the answer, which degrades the trace rather than the
   * reply.
   */
  let narratedUpTo = 0;
  const step: StepFn = async (label, status, detail) => {
    // Both edges quote, because which edge holds the reasoning depends on the
    // step. A tool call is decided *before* it runs, so its "why" is on the
    // opening edge and nothing new accrues while the model waits on the result.
    // A phase like working out an answer is the opposite: it opens before the
    // model has thought anything at all, and everything worth reporting happens
    // inside it — quoting only on open left those phases as bare labels.
    //
    // The cursor advances either way, so a passage is reported once. A close
    // with nothing new passes null, and the stored opening narration stands.
    const thinking = thinkingStream.value();
    const segment = thinking.slice(narratedUpTo).trim();
    narratedUpTo = thinking.length;
    // Prose first — it is the source that actually has content. Thinking stays
    // as a fallback so this keeps working if these models stop redacting it.
    mark(`step:${label}(${status})`);
    return opts.step(label, status, detail ?? (segment || null));
  };

  const tools = toolsForMode(opts.mode, opts.client, step, sink, { ...(opts.toolContext ?? {}), skill: opts.skill });
  const arcServer = createSdkMcpServer({ name: "arc", version: "1.0.0", tools });

  // Opened BEFORE the connector fetch, not after it (BSR-566).
  //
  // These three reads — connectors, media config, workspace summary — are one
  // phase from the reader's side: Arc working out what this workspace has. The
  // step used to open only around the last of them, so the two network calls
  // below ran with no row in `running`, and the status line fell back to a bare
  // "Thinking · Ns" for exactly as long as they took. That was the last of the
  // silent windows BSR-566 was filed about; the rest were closed by BSR-574.
  //
  // Deliberately NOT a fourth label. run-phases.ts makes the case: these are our
  // plumbing, and three rows telling someone we fetched our own config says
  // nothing about their business. One line that stays honest while the work
  // moves is the shape being asked for.
  await step(STEP_WORKSPACE, "running");

  // Remote MCP connectors (e.g. Higgsfield) and the operator's media-model
  // defaults both only matter in work modes; fetch them together, best-effort, so
  // neither a connector outage nor a config miss ever breaks a turn.
  const workModes = remoteConnectorsAllowedForMode(opts.mode);
  const [remote, mediaConfig] = await Promise.all([
    workModes ? fetchRemoteConnectors(opts.client) : Promise.resolve([]),
    mediaConfigAllowedForMode(opts.mode) ? fetchMediaConfig(opts.client) : Promise.resolve(null),
  ]);
  const { mcpServers: remoteServers, allowedTools: remoteAllowed } = buildRemoteMcp(remote);

  const workspaceState = await resolveWorkspaceSummary(opts.client);
  const system = buildSystemPrompt(ARC_SYSTEM_PROMPT, { ...opts.ctx, workspaceState, mediaConfig });
  await step(STEP_WORKSPACE, "done");

  // Every assistant message's text, in order. Kept per-message (not one string)
  // so they can be rejoined with a blank line — the model ends a message without
  // trailing whitespace, so concatenating raw runs the last word of one into the
  // first word of the next.
  const assistantChunks: string[] = [];
  /**
   * Chunks that turned out to be narration — prose Arc wrote and then acted on.
   *
   * Whether a text block is narration or answer is only knowable in hindsight:
   * it is narration if a tool call follows it. So chunks are collected as
   * normal and marked here when the next `tool_use` arrives, then withheld from
   * the reply at assembly time.
   *
   * The closing text block is never marked, because nothing follows it. That
   * matters: `assembleReplyBody` exists because a turn that answered, called a
   * tool, then closed was reporting only its closing next-steps and losing the
   * finding. Withholding narration moves that finding into the trace, where it
   * is displayed above the answer — but it must never withhold the closing
   * message, or the reply would be empty.
   */
  const narrationChunks = new Set<number>();
  let lastTextChunk: number | null = null;
  /** Text for the block currently streaming — not yet a chunk. */
  let streamingText = "";
  /**
   * The reply as it stands right now, composed the way `assembleReplyBody`
   * composes the final one: settled chunks minus anything reclassified as
   * narration, plus whatever is being typed.
   *
   * Streaming raw deltas meant a lead-in was typed into the answer and then
   * disappeared when the run settled and the reply was assembled without it.
   * Composing instead means it leaves the answer at the moment it is classified
   * — which is the moment it appears in the trace — so the sentence moves
   * somewhere visible rather than vanishing.
   */
  const composeLiveBody = () =>
    [...assistantChunks.filter((_, index) => !narrationChunks.has(index)), streamingText]
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n");
  let resultText = "";
  // Live-streaming buffer, accumulated from token deltas purely for the typing
  // effect. The final body is assembled below, so if partial events are
  // unavailable the reply is unchanged — streaming is additive.
  const partialStream = createCumulativeStreamBuffer({
    onEmit: opts.onPartial,
    throttleMs: STREAM_THROTTLE_MS,
  });
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  // Diagnostic for BSR-573: Arc had never captured a character of reasoning in
  // production, and nothing in the code path said why — the thinking branch
  // reads a defensively-typed field, so a shape change or an absent event fails
  // silently. Record which stream events actually arrive so the next real run
  // answers it from the logs instead of from guesswork.
  const seenEventShapes = new Set<string>();
  // What a thinking_delta actually carries. The SDK notes that during a
  // redacted-thinking phase these frames stream only token estimates — no text —
  // which would explain thinking_delta arriving on every run while nothing is
  // ever captured. Record the field names once so this stops being a guess.
  let thinkingDeltaKeys: string | null = null;
  // Does Arc actually write prose before it calls a tool? BSR-574 proposes using
  // that text as the narration, and BSR-573 is a lesson in not building on an
  // unverified source. Record the block order per assistant message, and how
  // much text precedes the first tool call.
  const blockSequences: string[] = [];
  let preToolTextChars = 0;
  // The model phase, split where the reader can actually see it change: reasoning
  // until the first token of prose, then writing. Tool calls report themselves in
  // between, so the trace reads as a sequence of real phases rather than a gap.
  let writing = false;
  const beginWriting = async () => {
    if (writing) return;
    writing = true;
    await step(STEP_REASONING, "done");
    await step(STEP_WRITING, "running");
  };

  await step(STEP_REASONING, "running");

  for await (const message of query({
    prompt: promptInput(opts.content, opts.ctx.scope.conversationId ?? "arc-turn"),
    options: buildQueryOptions({
      inference: opts.inference,
      systemPrompt: system,
      mcpServers: { arc: arcServer, ...remoteServers },
      allowedTools: [...allowedToolNames(opts.mode, opts.skill), ...remoteAllowed],
    }),
  })) {
    if (message.type === "stream_event") {
      const event = message.event;
      seenEventShapes.add(
        event.type === "content_block_delta"
          ? `content_block_delta:${(event.delta as { type?: string }).type ?? "?"}`
          : event.type === "content_block_start"
            ? `content_block_start:${((event as { content_block?: { type?: string } }).content_block)?.type ?? "?"}`
            : event.type,
      );
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        await beginWriting();
        streamingText += event.delta.text;
        // Awaited (not fire-and-forget) so throttled posts stay ordered;
        // postChatChunk swallows its own errors, so this never breaks the run.
        await partialStream.set(composeLiveBody());
      } else if (event.type === "content_block_delta" && event.delta.type === "thinking_delta") {
        // Extended-thinking tokens — streamed to the "Thinking…" trace. Typed as
        // unknown on some SDK versions, so read the field defensively.
        thinkingDeltaKeys ??= Object.keys(event.delta as object).join("+");
        const thinking = (event.delta as { thinking?: unknown }).thinking;
        if (typeof thinking === "string") {
          await thinkingStream.append(thinking);
        }
      }
    } else if (message.type === "assistant") {
      let text = "";
      const shape: string[] = [];
      let sawTool = false;
      for (const block of message.message.content) {
        shape.push(block.type);
        if (block.type === "tool_use") sawTool = true;
        else if (block.type === "text" && !sawTool) preToolTextChars += (block as { text?: string }).text?.length ?? 0;
      }
      if (shape.length) blockSequences.push(shape.join(">"));
      for (const type of shape) mark(`block:${type}`);
      for (const block of message.message.content) {
        if (block.type === "text") {
          text += block.text;
          const prose = block.text.trim();
          // Emit the prose as its own entry in the trace, in the order it was
          // written, rather than trying to hand it to a step.
          //
          // Attaching it to a step needed the text to be processed before the
          // tool that follows it reported — and it isn't. A whole run's tool
          // steps came back with no narration because of that assumption. Order
          // in the steps array is append order, which we control, so emitting
          // the prose directly sidesteps the correlation problem entirely: the
          // trace reads prose, action, prose, action, which is the shape the
          // reference actually has.
          //
          // Every text block is emitted, including the closing answer. The chat
          // suppresses narration the answer already contains, so the final block
          // disappears there rather than needing to be predicted here.
          if (prose) await step(STEP_NARRATION, "done", prose);
        }
        // Second, independent capture path. The delta stream was the only way
        // reasoning was ever collected, so a delta that carries no text — which
        // is exactly what a redacted-thinking phase sends — lost it completely
        // and silently. A settled thinking block, when the model emits one, has
        // the full text and no shape ambiguity.
        else if (block.type === "thinking") {
          const settled = (block as { thinking?: unknown }).thinking;
          if (typeof settled === "string" && settled.trim() && !thinkingStream.value().includes(settled.trim())) {
            await thinkingStream.append((thinkingStream.value() ? "\n\n" : "") + settled.trim());
          }
        }
      }
      if (text.trim()) {
        assistantChunks.push(text);
        lastTextChunk = assistantChunks.length - 1;
        streamingText = "";
      }
      // A tool call means the text before it introduced work about to happen —
      // but only a lead-in is safe to withhold. Arc also reports findings
      // mid-run, between tool calls, and those belong in the reply.
      if (sawTool && lastTextChunk !== null) {
        if (isLeadIn(assistantChunks[lastTextChunk] ?? "")) {
          narrationChunks.add(lastTextChunk);
          // Pull it out of the live reply now, as the trace entry for it appears.
          await partialStream.set(composeLiveBody());
        }
        lastTextChunk = null;
      }
    } else if (message.type === "result" && message.subtype === "success") {
      resultText = message.result;
      const usage = (message as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
      if (usage) {
        inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : inputTokens;
        outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : outputTokens;
      }
    }
  }

  // Close whichever model phase is still open. A turn that produced no streamed
  // text (tools only, or an empty reply) never entered the writing phase, so the
  // reasoning step is the one left running.
  await step(writing ? STEP_WRITING : STEP_REASONING, "done");

  // The reply is the closing message plus anything substantive that wasn't
  // commentary on work in progress. Narration lives in the trace instead, shown
  // above the answer in the order Arc wrote it.
  const replyChunks = assistantChunks.filter((_, index) => !narrationChunks.has(index));
  const body = assembleReplyBody(replyChunks, resultText);
  const reasoning = thinkingStream.value().trim() || null;
  console.log(
    `[arc-runner] stream shapes: ${[...seenEventShapes].sort().join(", ") || "none"} | thinking_delta fields: ${thinkingDeltaKeys ?? "none"} | reasoning chars: ${reasoning?.length ?? 0} | blocks: ${blockSequences.join(" / ") || "none"} | pre-tool text chars: ${preToolTextChars} | narration chunks: ${narrationChunks.size}/${assistantChunks.length} | timeline: ${timeline.join(" ")}`,
  );

  // The last SDK deltas commonly land inside the throttle window. Flush the
  // canonical values before the completion write so the pending bubble reaches
  // the exact final text/reasoning instead of visibly jumping on reconciliation.
  await thinkingStream.flush(reasoning ?? "");
  await partialStream.flush(body);

  return {
    body,
    actions,
    suggestions: suggestions.slice(0, 4),
    sources,
    questions: questions.slice(0, 4),
    memory: opts.ctx.memory ?? [],
    drafts,
    reasoning,
    usage: { model: opts.inference.model, inputTokens, outputTokens },
  };
}

export async function runArcTurn(payload: MarkChatMessagePayload, client: ArcClient): Promise<ArcTurnResult> {
  const step = (label: string, status: "running" | "done", detail?: string | null) =>
    client.postStep(payload.agentTaskId, label, status, detail);

  const skill = resolveArcSkill(payload.skillId);
  const contextStartedAt = Date.now();
  // These reads are independent. Running them serially made every turn pay the
  // sum of three network round trips before the model could emit a first token.
  //
  // Narrate them. Until now the only steps Arc reported came from tool calls, so
  // a turn spent these seconds — and an ask-mode turn that uses no tools, its
  // entire run — reporting nothing at all while the reader watched a spinner.
  await step(STEP_CONTEXT, "running");
  const [business, memory, memoryCtx] = await Promise.all([
    resolveBusinessContext(client),
    resolveRecallMemory(client, buildRecallQuery(payload.history, payload.message)),
    fetchConversationContext(client, payload.conversationId, payload.messageId),
  ]);
  await step(STEP_CONTEXT, "done");
  console.log(`[arc-runner] context ready for task ${payload.agentTaskId} in ${Date.now() - contextStartedAt}ms`);
  const ctx: ArcTurnContext = {
    business,
    mode: payload.mode,
    scope: {
      conversationId: payload.conversationId,
      projectId: payload.projectId,
      campaignId: payload.campaignId,
      operator: payload.operator,
    },
    mentions: payload.mentions,
    memory,
    assistantTone: payload.assistantTone,
    assistantResponseStyle: payload.assistantResponseStyle,
    approvalStrictness: payload.approvalStrictness,
    skill,
  };

  // Compaction-aware memory: the rolling summary of earlier turns + the recent
  // turns verbatim, fetched per turn (the live wake doesn't carry history). This is
  // what gives Arc chat memory; `overflow` is the older turns to compact after.
  const preamble = formatHistory(memoryCtx.history, memoryCtx.summary);
  const text = preamble ? `${preamble}\n\nCurrent message:\n${payload.message}` : payload.message;
  const content = await buildTurnContentAsync(text, payload.attachments);

  const result = await runArcQuery({
    step,
    mode: payload.mode,
    ctx,
    client,
    content,
    inference: inferenceForRoute(payload.route),
    // Thread the turn's level so media tools tell the generate endpoints which
    // tier (Swift=fast / Studio=standard) to resolve image/video models from.
    // Also thread conversationId so draft tools can link the chat to the campaign.
    toolContext: { level: payload.route, conversationId: payload.conversationId },
    skill,
    // Type the reply out live into the pending bubble as the model streams.
    onPartial: (text) => client.postChatChunk(payload.agentTaskId, text),
    // Stream the thinking live so the pending bubble shows the thought forming.
    onThinking: (text) => client.postChatThinking(payload.agentTaskId, text),
  });

  // Two best-effort, fire-and-forget passes; neither delays or breaks the reply.
  //
  // Compaction stays gated on overflow — folding evicted turns into the rolling
  // summary is the only reason it exists. Memory promotion deliberately does NOT:
  // these were coupled, and since overflow needs the conversation to outgrow a
  // 24k-token budget, promotion never fired on a normal chat (zero `learning` nodes
  // in prod since seeding). It also meant the only turns ever mined were the oldest
  // ones. Promotion now reads the exchange that just happened, every turn.
  if (memoryCtx.overflow) {
    void compactConversation(client, payload.conversationId, memoryCtx.summary, memoryCtx.overflow);
  }
  void promoteConversationMemory(
    client,
    [
      ...memoryCtx.history,
      { role: "operator", body: payload.message },
      { role: "arc", body: result.body },
    ],
    memoryCtx.summary,
  );
  // Critique any drafts this turn created, after the reply — chat is interactive,
  // and a claims review is far too slow to hold a reply behind. The asset stays
  // pending_approval + dispatch_locked meanwhile, so the human gate holds; the
  // card simply has no critique on it until this lands.
  void reviewTurnDrafts(result.drafts, client, step, business.businessName);
  return result;
}

/** Summarize the overflow into the rolling summary and persist it. Best-effort —
 *  any failure just leaves the prior summary in place to retry next turn. */
async function compactConversation(
  client: ArcClient,
  conversationId: string,
  priorSummary: string | null,
  overflow: HistoryOverflow,
): Promise<void> {
  try {
    const updated = await summarizeConversation(priorSummary, overflow.turns);
    if (updated && updated.trim()) {
      await persistConversationSummary(client, conversationId, {
        summary: updated,
        summaryThroughMessageId: overflow.throughMessageId,
      });
    }
  } catch {
    // swallow — compaction never breaks a turn
  }
}

/**
 * Run an Arc turn for an `arc_opportunity_draft` wake: DRAFT mode, the briefing
 * `message` used verbatim as the prompt (no history/preamble), and the
 * opportunityId threaded into the draft tool so the created campaign asset links
 * back to the opportunity. Standard route (Opus) — drafting is heavier work.
 */
export async function runArcOpportunityDraft(
  payload: ArcOpportunityDraftPayload,
  client: ArcClient,
): Promise<ArcTurnResult> {
  const step = (label: string, status: "running" | "done", detail?: string | null) =>
    client.postStep(payload.agentTaskId, label, status, detail);

  const business = await resolveBusinessContext(client);
  const memory = await resolveRecallMemory(client, payload.message);
  const skill = resolveArcSkill(payload.skillId);
  const ctx: ArcTurnContext = {
    business,
    mode: "draft",
    scope: {
      conversationId: payload.opportunityId,
      projectId: null,
      campaignId: null,
      operator: payload.operator,
    },
    mentions: [],
    memory,
    skill,
  };

  const result = await runArcQuery({
    step,
    mode: "draft",
    ctx,
    client,
    content: payload.message,
    inference: inferenceForRoute("standard"),
    toolContext: { opportunityId: payload.opportunityId },
    skill,
  });
  // Background wake — nobody is waiting on a reply, so the critique runs inline
  // and the drafts reach the queue already reviewed.
  await reviewTurnDrafts(result.drafts, client, step, business.businessName);
  return result;
}

/**
 * Run an Arc turn for an `arc_opportunity_scan` wake: scan tool set (read tools +
 * propose_opportunity only), the scan briefing used verbatim as the prompt. Arc
 * proposes pending opportunities; nothing drafts or goes outbound.
 */
export async function runArcOpportunityScan(
  payload: ArcOpportunityScanPayload,
  client: ArcClient,
): Promise<ArcTurnResult> {
  const step = (label: string, status: "running" | "done", detail?: string | null) =>
    client.postStep(payload.agentTaskId, label, status, detail);

  const business = await resolveBusinessContext(client);
  const memory = await resolveRecallMemory(client, payload.message);
  const skill = resolveArcSkill(payload.skillId);
  const ctx: ArcTurnContext = {
    business,
    mode: "scan",
    scope: {
      conversationId: payload.agentTaskId,
      projectId: null,
      campaignId: null,
      operator: payload.operator,
    },
    mentions: [],
    memory,
    skill,
  };

  return runArcQuery({
    step,
    mode: "scan",
    ctx,
    client,
    content: payload.message,
    inference: inferenceForRoute("standard"),
    skill,
  });
}

/**
 * Run an Arc turn for a campaign task wake. This is the production path for
 * "Ask Arc to build" and "Hand to Arc": DRAFT mode, fixed campaign scope, and
 * a prompt that keeps all work approval-gated.
 */
export async function runArcCampaignTask(
  payload: ArcCampaignTaskPayload,
  client: ArcClient,
): Promise<ArcTurnResult> {
  const step = (label: string, status: "running" | "done", detail?: string | null) =>
    client.postStep(payload.agentTaskId, label, status, detail);

  const business = await resolveBusinessContext(client);
  const memory = await resolveRecallMemory(client, payload.message);
  const skill = resolveArcSkill(payload.skillId);
  const ctx: ArcTurnContext = {
    business,
    mode: "draft",
    scope: {
      conversationId: payload.conversationId ?? payload.agentTaskId,
      projectId: null,
      campaignId: payload.campaignId,
      operator: payload.operator,
    },
    mentions: [],
    memory,
    skill,
  };

  const prompt = [
    `Campaign task: ${payload.taskType}.`,
    `Work only on campaign_id "${payload.campaignId}". When creating campaign drafts, attach them to that campaign_id.`,
    "Create approval-gated draft assets only. Do not send, publish, launch, approve, unlock dispatch, or spend.",
    "",
    payload.message,
  ].join("\n");

  const result = await runArcQuery({
    step,
    mode: "draft",
    ctx,
    client,
    content: prompt,
    inference: inferenceForRoute("standard"),
    toolContext: { campaignId: payload.campaignId, conversationId: payload.conversationId },
    skill,
  });
  // Background wake — the critique runs inline, so a "Hand to Arc" package lands
  // in the queue with its claims already checked.
  await reviewTurnDrafts(result.drafts, client, step, business.businessName);
  return result;
}

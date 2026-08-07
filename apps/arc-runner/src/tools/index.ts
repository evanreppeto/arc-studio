import type { ArcClient } from "../arc-client";
import { crmReadTools } from "./crm";
import { customFieldReadTools, customFieldWriteTools } from "./custom-fields";
import { customObjectReadTools, customObjectWriteTools } from "./custom-objects";
import { brainReadTools, brainWriteTools } from "./brain";
import { campaignReadTools, campaignReviseTools } from "./campaigns";
import { approvalReadTools, approvalWriteTools } from "./approvals";
import { performanceReadTools } from "./performance";
import { intelligenceTools } from "./intelligence";
import { interactionWriteTools } from "./interactions";
import { crmWriteTools } from "./crm-write";
import { emitCardTool } from "./cards";
import { draftWorkProductTools } from "./drafts";
import { mediaTools } from "./media";
import { variantsTools } from "./variants";
import { libraryReadTools, libraryDraftTools, libraryWriteTools } from "./library";
import { suggestFollowupsTool, citeSourcesTool, askOperatorTool } from "./reply-meta";
import { brandTools } from "./brand";
import { proposeOpportunityTool } from "./opportunities";
import { competitorIntelTool } from "./competitor-intel";
import { appMapTools } from "./app-map";
import { settingsReadTools } from "./settings";
import type { StepFn, TurnSink } from "./helpers";
import type { ArcSkill } from "../skills";

export type ArcMode = "ask" | "act" | "draft" | "scan";

/** Extra per-turn context threaded into work-product tools (e.g. the active campaign/opportunity a draft links back to, the Arc level driving media models). */
export type ToolContext = {
  opportunityId?: string;
  level?: "fast" | "standard";
  conversationId?: string | null;
  campaignId?: string | null;
  /** The operator's engine-qualified media-model pick for this turn, or null for
   *  Auto. Sent verbatim to the media endpoints, which re-resolve it against the
   *  roster — the runner never decides what it means. */
  mediaModel?: string | null;
  skill?: ArcSkill | null;
};

/** Read app state + reply-shaping tools (cards, suggestions, sources). Available in every mode. */
function readTools(client: ArcClient, step: StepFn, sink: TurnSink) {
  return [
    ...appMapTools(client, step),
    ...settingsReadTools(client, step),
    ...crmReadTools(client, step),
    // The workspace's own record types, discovery-first: the keys are
    // per-workspace, so there is nothing to hardcode against.
    ...customObjectReadTools(client, step),
    ...customFieldReadTools(client, step),
    ...brainReadTools(client, step),
    ...campaignReadTools(client, step),
    ...approvalReadTools(client, step),
    ...performanceReadTools(client, step),
    ...intelligenceTools(client, step),
    ...libraryReadTools(client, step),
    emitCardTool(sink.card),
    suggestFollowupsTool(sink.suggestion),
    citeSourcesTool(sink.source),
    askOperatorTool(sink.question),
  ];
}

/** Direct CRM writes + interactions + brain observations + library organization. act/draft only. */
function writeTools(client: ArcClient, step: StepFn) {
  return [
    ...crmWriteTools(client, step),
    ...customObjectWriteTools(client, step),
    ...customFieldWriteTools(client, step),
    ...brainWriteTools(client, step),
    ...interactionWriteTools(client, step),
    ...libraryWriteTools(client, step),
    ...approvalWriteTools(client, step),
  ];
}

/** Draft work products: create approval-gated campaign assets + brand learning. act + draft modes (they share capabilities). */
function draftTools(client: ArcClient, step: StepFn, sink: TurnSink, ctx: ToolContext) {
  return [
    ...draftWorkProductTools(client, step, sink, ctx),
    ...campaignReviseTools(client, step, sink),
    ...mediaTools(client, step, sink.card, ctx),
    ...variantsTools(client, step, sink.card, ctx),
    ...libraryDraftTools(client, step, sink.card, ctx),
    ...brandTools(client, step, sink.card),
  ];
}

/**
 * The reply-assembly tools, which must never be deferred behind tool search.
 *
 * The SDK defers every MCP tool by default once tool search is on, and Arc has
 * ~50 of them — deferring is right for almost all of it. It is wrong for these
 * three: `prompt.ts` documents them in prose, so Arc calls them from that prose
 * without fetching a schema first, fills the arguments in from memory, and is
 * rejected by argument validation. Prod run 7631013c is the shape — `emit_card`,
 * `cite_sources` and `suggest_followups` all failed on "expected …, received
 * undefined", then Arc called `ToolSearch` and completed all three.
 *
 * Nothing was lost, because Arc recovers on its own. What it costs is three
 * wasted calls and a round-trip in the reply-assembly phase — on the critical
 * path to the operator seeing an answer — every run that ends this way.
 *
 * Deferring them buys close to nothing anyway: Arc is told to call all three on
 * essentially every turn, so their schemas are loaded on essentially every turn
 * regardless. The other ~47 stay deferred, which is where tool search earns its
 * keep. `ask_operator` is deliberately NOT here — it fires only when Arc needs a
 * decision, so it is a genuine candidate for deferral.
 *
 * BSR-737. Enforced by a test, because a dropped `alwaysLoad` fails nothing.
 */
export const ALWAYS_LOADED_REPLY_TOOLS = ["emit_card", "cite_sources", "suggest_followups"] as const;

function filterToolsForSkill<T extends { name: string }>(tools: T[], skill: ArcSkill | null | undefined): T[] {
  if (!skill) return tools;
  const allowed = new Set(skill.allowedTools);
  return tools.filter((tool) => allowed.has(tool.name));
}

/**
 * The tool set for a turn, gated by operator mode:
 *   ask         → read + reply-shaping (emit_card, suggest_followups, cite_sources) only
 *   scan        → read + proactive capture (propose_opportunity, record_competitor_intel)
 *   act / draft → + writes (CRM interactions, brain observations)
 *                 + draft work products (create approval-gated campaign assets, generate images)
 * Act and draft share the same capabilities — both "create approval-ready records"
 * (matching the Act mode label); they differ only in how Arc is framed to work.
 * Outbound has no tool in any mode; every work product stays approval-gated.
 */
export function toolsForMode(
  mode: ArcMode,
  client: ArcClient,
  step: StepFn,
  sink: TurnSink,
  ctx: ToolContext = {},
) {
  // Fresh arrays via spread (not push) so the element type widens to the union of
  // tool definitions — the SDK tool types are invariant in their Zod schema, so
  // pushing differently-typed tools into a narrowed array won't compile.
  const read = readTools(client, step, sink);
  if (mode === "ask") return filterToolsForSkill([...read], ctx.skill);
  if (mode === "scan")
    return filterToolsForSkill([...read, proposeOpportunityTool(client, step), competitorIntelTool(client, step)], ctx.skill);
  const write = writeTools(client, step);
  return filterToolsForSkill([...read, ...write, ...draftTools(client, step, sink, ctx)], ctx.skill);
}

/** The `allowedTools` list the SDK expects — each tool namespaced under the `arc` MCP server. */
export function allowedToolNames(mode: ArcMode, skill?: ArcSkill | null): string[] {
  // Build from the same source of truth; dummies are fine — we only read names.
  const noop = (async () => {}) as StepFn;
  const placeholder = {} as ArcClient;
  const sink: TurnSink = { card: () => {}, suggestion: () => {}, source: () => {}, question: () => {}, draft: () => {} };
  return toolsForMode(mode, placeholder, noop, sink, { skill }).map((t) => `mcp__arc__${t.name}`);
}

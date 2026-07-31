/**
 * The conversation workspace's view model.
 *
 * BSR-562 settled the division of labor: the inline trace narrates the turn in
 * front of the operator; the panel owns what a single turn cannot show. What it
 * did with that was list every step and tool call from every run end to end —
 * conversation-wide, but still a transcript, and one nobody reads at forty rows.
 *
 * This module digests the same messages into the three things the panel is for:
 *
 *  - **Runs** as navigation — one summary line per run (what was asked, how long
 *    it took, how much it touched), expandable to that run's activity.
 *  - **Evidence** — the records, memory, context and tools behind the answers,
 *    which is what an operator actually re-opens the panel to check.
 *  - Deliverables stay in `workspace-scope.ts`, which already de-duplicates them.
 *
 * Pure: no I/O, no view types, no React.
 */

import type { ArcActionCard, ArcStepKind } from "@/domain";

import type { ArcMessage } from "./persistence";
import { formatToolName, getToolKind } from "./tool-labels";

export type ArcWorkspaceActivityRow = {
  id: string;
  label: string;
  detail?: string;
  status: "queued" | "running" | "done" | "error";
  kind: ArcStepKind;
};

export type ArcWorkspaceRunState = "working" | "complete" | "failed";

export type ArcWorkspaceRun = {
  id: string;
  /** 1-based position in the conversation, so "Run 3" counts what the operator sent. */
  index: number;
  /** The request that opened the run, trimmed to a single line. */
  request: string;
  state: ArcWorkspaceRunState;
  stepCount: number;
  toolCount: number;
  durationMs: number | null;
  rows: ArcWorkspaceActivityRow[];
};

export type ArcWorkspaceEvidenceItem = { label: string; detail?: string; href?: string };
export type ArcWorkspaceEvidenceGroup = { id: string; label: string; items: ArcWorkspaceEvidenceItem[] };

const REQUEST_MAX = 96;

function toRequestLine(body: string): string {
  const line = body.replace(/\s+/g, " ").trim();
  if (!line) return "Untitled request";
  return line.length > REQUEST_MAX ? `${line.slice(0, REQUEST_MAX - 1).trimEnd()}…` : line;
}

/** A run whose message settled cannot still be mid-step: a row left "running" by
 *  a dropped frame would otherwise keep the panel reporting live work forever. */
function settleRow(row: ArcWorkspaceActivityRow, settled: boolean): ArcWorkspaceActivityRow {
  if (!settled) return row;
  return row.status === "running" || row.status === "queued" ? { ...row, status: "done" } : row;
}

export function buildArcWorkspaceRuns(messages: ArcMessage[]): ArcWorkspaceRun[] {
  const runs: ArcWorkspaceRun[] = [];
  let pendingRequest = "";

  for (const message of messages) {
    if (message.role === "operator") {
      pendingRequest = message.body;
      continue;
    }
    if (message.role !== "arc") continue;

    const toolCalls = message.toolCalls ?? [];
    const settled = message.status === "complete" || message.status === "failed";
    const rows: ArcWorkspaceActivityRow[] = [
      ...message.steps.map((step, index) => settleRow({
        id: `${message.id}-step-${index}`,
        label: step.label,
        detail: step.detail?.join(" · "),
        status: step.status === "done" ? "done" : "running",
        kind: step.kind ?? "think",
      }, settled)),
      ...toolCalls.map((tool, index) => settleRow({
        id: `${message.id}-tool-${index}`,
        label: formatToolName(tool.name),
        detail: tool.output ?? tool.input,
        status: tool.status === "complete" ? "done" : tool.status === "error" ? "error" : "running",
        kind: getToolKind(tool.name),
      }, settled && tool.status !== "error")),
    ];

    const failed = message.status === "failed" || toolCalls.some((tool) => tool.status === "error");
    runs.push({
      id: message.id,
      index: runs.length + 1,
      request: toRequestLine(pendingRequest),
      state: message.status === "pending" ? "working" : failed ? "failed" : "complete",
      stepCount: message.steps.length,
      toolCount: toolCalls.length,
      durationMs: message.runDurationMs ?? null,
      rows,
    });
    pendingRequest = "";
  }

  return runs;
}

function pushUnique(items: ArcWorkspaceEvidenceItem[], seen: Set<string>, item: ArcWorkspaceEvidenceItem) {
  const key = item.label.toLocaleLowerCase();
  if (!key || seen.has(key)) return;
  seen.add(key);
  items.push(item);
}

const AUDIENCE_ROW = /(audience|persona|segment)/i;

/** Strip the MCP transport prefix a tool name carries on the wire.
 *  `mcp__arc__get_workspace_settings` is plumbing spelled out loud; the operator
 *  wants to know Arc read the workspace settings. */
const ACRONYMS = /\b(crm|sms|url|api|ai|seo|mcp|csv|pdf|id)\b/gi;

function toolLabel(name: string): string {
  const bare = name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "").replace(/^mcp__/, "");
  const spaced = formatToolName(bare || name);
  // Sentence case, not Title Case: "Get workspace settings" reads as an action,
  // "Get Workspace Settings" reads as a menu item. Acronyms are restored after,
  // because lowercasing turns CRM into "Crm", which reads as a typo.
  const sentence = spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
  return sentence.replace(ACRONYMS, (match) => match.toUpperCase());
}

/** Two memories are the same memory if they say the same thing. Prod's brain
 *  holds five separate nodes all stating the CRM is empty (BSR-531 is the fix
 *  at the source); until then the panel must not print the same sentence five
 *  times. Compared on words, so punctuation and dates do not defeat it. */
function factKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * What Arc worked from, grouped by where it came from. Ordered by how much an
 * operator can act on it: the records and memory behind a claim first, the
 * mechanics of the run last.
 *
 * Deliberately NOT here: the turn's context scopes. They were shown as "Context
 * you selected" and were nothing of the kind — the app sends all four on every
 * turn, so the group listed the same four defaults forever and implied the
 * operator had made a choice. A row that is always identical is not evidence.
 */
export function buildArcWorkspaceEvidence(
  messages: ArcMessage[],
  cards: ArcActionCard[] = [],
): ArcWorkspaceEvidenceGroup[] {
  const groups: ArcWorkspaceEvidenceGroup[] = [];

  const add = (id: string, label: string, items: ArcWorkspaceEvidenceItem[]) => {
    if (items.length > 0) groups.push({ id, label, items });
  };

  const records: ArcWorkspaceEvidenceItem[] = [];
  const recordSeen = new Set<string>();
  for (const message of messages) {
    for (const mention of message.mentions) {
      pushUnique(records, recordSeen, { label: mention.label, detail: mention.type, href: mention.href });
    }
  }
  add("records", "Records referenced", records);

  // Lead with the fact in Arc's own words. `label` is the brain's node key —
  // `crm_contacts_empty` — which identifies a row and tells a human nothing.
  const memory: ArcWorkspaceEvidenceItem[] = [];
  const memorySeen = new Set<string>();
  const confidences = new Set<number>();
  for (const message of messages) {
    for (const item of message.recall ?? []) {
      if (typeof item.confidence === "number") confidences.add(item.confidence);
    }
  }
  // A figure that is identical on every item measures nothing — prod returns
  // 0.5 across the board — and rendering it as "50% match" dresses a constant
  // up as precision. Show it only when it actually separates one from another.
  const confidenceVaries = confidences.size > 1;
  for (const message of messages) {
    for (const item of message.recall ?? []) {
      const fact = item.summary?.trim() || item.label;
      const key = factKey(fact);
      if (memorySeen.has(key)) continue;
      memorySeen.add(key);
      memory.push({
        label: fact,
        ...(confidenceVaries && typeof item.confidence === "number"
          ? { detail: `${Math.round(item.confidence * 100)}% match` }
          : {}),
      });
    }
  }
  add("memory", "What Arc remembered", memory);

  const audience: ArcWorkspaceEvidenceItem[] = [];
  const audienceSeen = new Set<string>();
  for (const card of cards) {
    for (const row of card.rows) {
      if (!AUDIENCE_ROW.test(row.name)) continue;
      pushUnique(audience, audienceSeen, { label: row.meta ?? row.badge ?? row.name, detail: card.channel ?? card.title });
    }
  }
  add("audience", "Audience and personas", audience);

  const toolCounts = new Map<string, number>();
  for (const message of messages) {
    for (const tool of message.toolCalls ?? []) {
      const label = toolLabel(tool.name);
      toolCounts.set(label, (toolCounts.get(label) ?? 0) + 1);
    }
  }
  add("tools", "What Arc checked", [...toolCounts.entries()].map(([label, count]) => ({
    label,
    ...(count > 1 ? { detail: `${count} times` } : {}),
  })));

  return groups;
}

/** "38s" / "2m 04s" — the run's measured wall clock, never an inferred one. */
export function formatRunDuration(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

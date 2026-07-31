/**
 * Capture what Arc actually called (BSR-618).
 *
 * `persistence.ts` in the app has documented a runner contract since the chat
 * shipped — the agent writes `arc_messages.metadata.toolCalls` as
 * `[{ name, status, input?, output? }]` — and nothing ever honored it. A prod
 * census on 2026-07-31 found zero rows carrying the field on any day the table
 * has existed, while three surfaces read it: the inline run trace's tool rows,
 * and the workspace panel's run history and "Tools Arc ran" evidence group. All
 * three render empty in production and full in the offline preview, because the
 * demo fixtures populate what the runner never did.
 *
 * Capture happens at the SDK stream, not inside `runTool`, for two reasons: the
 * SDK sees remote MCP connector calls (Higgsfield) that never pass through the
 * app's own tool wrappers, and it carries the `tool_use_id` that pairs a call
 * with its result. `runTool`'s step bookend is untouched — steps are the
 * human-readable phase narration, this is the structured record of the work.
 *
 * Pure and synchronous: no I/O, no SDK types. The caller feeds it blocks.
 */

/** Mirrors `ArcToolCall` in the app (src/lib/arc-chat/persistence.ts). Duplicated,
 *  not imported, so the runner stays an independent service. */
export type ArcToolCall = {
  name: string;
  status: "running" | "complete" | "error";
  input?: string;
  output?: string;
};

/** Long enough to identify what a call did, short enough that forty of them do
 *  not bloat the message row. The chat renders these as one line anyway. */
const MAX_TEXT = 400;

/** A ceiling on the record, not on the run. A turn that calls hundreds of tools
 *  should not write a megabyte of metadata; what was dropped is reported rather
 *  than silently truncated. */
const MAX_CALLS = 40;

const SECRET_KEY = /(token|secret|password|api[_-]?key|authorization|credential|bearer)/i;

/** Redact anything that looks like a credential before it is rendered. Tool
 *  inputs are business parameters today, but this record is persisted and read
 *  back by an operator UI — a key leaking into it would be permanent. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(item, depth + 1);
  }
  return out;
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat;
}

/** Render a tool's input or result as the pre-rendered string the app contract
 *  asks for. Strings pass through; anything else is JSON. Never throws — a
 *  circular or unserializable value degrades to a placeholder rather than
 *  taking down the turn that produced it. */
export function renderToolText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return clip(value) || undefined;
  // The SDK delivers a tool result's content as either a string or an array of
  // content blocks; flatten the text blocks so the record reads as the result
  // rather than as its envelope.
  if (Array.isArray(value) && value.every((item) => item && typeof item === "object")) {
    const texts = value
      .map((item) => (item as { type?: string; text?: unknown }))
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text as string);
    if (texts.length > 0) return clip(texts.join(" ")) || undefined;
  }
  try {
    return clip(JSON.stringify(redact(value)) ?? "") || undefined;
  } catch {
    return "[unserializable]";
  }
}

export type ToolCallLog = {
  /** A `tool_use` block: the call is now in flight. */
  start(id: string, name: string, input?: unknown): void;
  /** A `tool_result` block: pair it with its call and settle the status. */
  settle(id: string, output?: unknown, isError?: boolean): void;
  /** The record, in call order. */
  value(): ArcToolCall[];
  /** Calls beyond the cap, so the run can say so instead of implying it made fewer. */
  dropped(): number;
};

export function createToolCallLog(): ToolCallLog {
  const calls = new Map<string, ArcToolCall>();
  const order: string[] = [];
  let dropped = 0;

  return {
    start(id, name, input) {
      if (!id || !name) return;
      if (calls.has(id)) return;
      if (order.length >= MAX_CALLS) {
        dropped += 1;
        return;
      }
      order.push(id);
      const rendered = renderToolText(input);
      calls.set(id, { name, status: "running", ...(rendered ? { input: rendered } : {}) });
    },
    settle(id, output, isError) {
      // A result for a call that was dropped by the cap, or that arrived without
      // its `tool_use`, has nothing to attach to. Ignore it rather than
      // inventing a call whose name we never saw.
      const call = calls.get(id);
      if (!call) return;
      call.status = isError ? "error" : "complete";
      const rendered = renderToolText(output);
      if (rendered) call.output = rendered;
    },
    value() {
      return order.map((id) => calls.get(id)!).filter(Boolean);
    },
    dropped() {
      return dropped;
    },
  };
}

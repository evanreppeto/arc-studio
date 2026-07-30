import type { ArcActionCard, ArcMention, ArcQuestion, DraftForReview } from "../types";

/** Step reporter signature shared by every tool (running -> done live trace). */
/**
 * Report an activity step. `detail` is the reasoning that led to this step —
 * supplied when a step opens, so the transcript can pair each action with the
 * thinking that preceded it. Omit it when closing a step; the stored narration
 * is carried over.
 */
export type StepFn = (label: string, status: "running" | "done", detail?: string | null) => Promise<void>;

/** Per-turn collectors for everything Arc attaches to its reply beyond text. */
export type TurnSink = {
  card: (card: ArcActionCard) => void;
  suggestion: (text: string) => void;
  source: (mention: ArcMention) => void;
  question: (question: ArcQuestion) => void;
  /** Every approval-gated draft the turn created, with its full copy — the
   *  critic's work list. Collected here rather than re-fetched because the
   *  drafting tool already holds the body it just persisted. */
  draft: (draft: DraftForReview) => void;
};

/** SDK tool result shape. */
export type ToolResult = { content: Array<{ type: "text"; text: string }> };

const MAX_TOOL_TEXT = 8000;

const SLICE_NOTE =
  "\n\n[TRUNCATED: this result was cut mid-way to fit the tool-text budget. It is PARTIAL — do not treat it as a complete answer, and do not infer any total or count from it.]";

const DROP_NOTE =
  "Elements were dropped from this list to fit the tool-text budget. The list is PARTIAL: use `total` for counts, and narrow your filters or fetch a single record for detail. Do NOT infer a count from the elements returned here.";

/**
 * Wrap a string as an SDK text result, bounded so a huge payload can't blow
 * context.
 *
 * A cut is always ANNOUNCED. Silently slicing was the trap: the model cannot see
 * that text is missing, so a truncated result reads as a complete one. Prefer
 * `jsonResult` for structured payloads — it drops whole elements instead of
 * cutting mid-token.
 */
export function textResult(text: string): ToolResult {
  if (text.length <= MAX_TOOL_TEXT) {
    return { content: [{ type: "text", text }] };
  }
  const body = text.slice(0, MAX_TOOL_TEXT - SLICE_NOTE.length);
  return { content: [{ type: "text", text: body + SLICE_NOTE }] };
}

/**
 * Serialize a tool payload as JSON text within the tool-text budget.
 *
 * An over-budget payload is trimmed by dropping whole ELEMENTS from its longest
 * list and recording what went, so the text stays valid JSON and carries a
 * `_truncated` marker. Slicing the JSON text instead is what made `search_leads`
 * lie: a full lead row is ~833 chars, so an 8000-char cut through 200 of them
 * left 10 rows that read as a complete list — Arc reported 64 leads against a
 * real 200 and burned a turn's budget re-querying to make up the difference.
 */
export function jsonResult(data: unknown): ToolResult {
  const full = JSON.stringify(data) ?? "null";
  if (full.length <= MAX_TOOL_TEXT) {
    return { content: [{ type: "text", text: full }] };
  }
  // Falls through to textResult's announced slice when there's no list to trim
  // (or when even the empty envelope is over budget).
  return textResult(trimLongestList(data) ?? full);
}

/**
 * Re-serialize `data` with its longest array shortened to the most elements that
 * fit the budget, plus a `_truncated` marker. Returns null when the payload has
 * no array to trim, or when the envelope alone still doesn't fit.
 */
function trimLongestList(data: unknown): string | null {
  if (data === null || typeof data !== "object") return null;

  // A bare array is wrapped so the marker has somewhere to live.
  const envelope: Record<string, unknown> = Array.isArray(data)
    ? { items: data }
    : { ...(data as Record<string, unknown>) };

  let listKey: string | null = null;
  let longest = -1;
  for (const [key, value] of Object.entries(envelope)) {
    if (Array.isArray(value) && value.length > longest) {
      listKey = key;
      longest = value.length;
    }
  }
  if (listKey === null) return null;

  const list = envelope[listKey] as unknown[];
  const serialize = (keep: number) =>
    JSON.stringify({
      ...envelope,
      [listKey]: list.slice(0, keep),
      _truncated: { returned: keep, dropped: list.length - keep, note: DROP_NOTE },
    });

  // Binary search the largest prefix that fits.
  let low = 0;
  let high = list.length;
  let best: string | null = null;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const text = serialize(mid);
    if (text.length <= MAX_TOOL_TEXT) {
      best = text;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

/**
 * Run a tool's work with the live-trace bookend and uniform error handling:
 * emit `running`, run `fn`, emit `done` (even on error), and return the result
 * as JSON text (or a `<label> failed: <reason>` message). Never throws — the
 * SDK should receive a tool result, not an exception.
 */
export async function runTool(step: StepFn, label: string, fn: () => Promise<unknown>): Promise<ToolResult> {
  await step(label, "running");
  try {
    const data = await fn();
    await step(label, "done");
    return jsonResult(data);
  } catch (error) {
    await step(label, "done");
    const reason = error instanceof Error ? error.message : "unknown error";
    return textResult(`${label} failed: ${reason}`);
  }
}

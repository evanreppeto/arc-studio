import "server-only";

import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { unavailableRead, type UnavailableResult } from "@/lib/observability/unavailable";

import { type ArcRecall } from "@/domain";

import { getArcMessage, type ArcMessage, type ArcStep, type ArcToolCall } from "./persistence";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One Arc run, assembled for an operator to diagnose (BSR-509).
 *
 * Diagnosing a wrong or empty answer used to mean reading runner logs and
 * querying tables by hand, and that cost is a large part of why silent failures
 * survived so long.
 *
 * ── What this is built ON, and what it deliberately is not ───────────────────
 * `agent_run_logs` and `agent_outputs` LOOK like the natural sources — there is
 * even an unwired `getAgentTaskDetail` that reads them. They are dead: nine rows
 * each, nothing written since 2026-07-06. A view built on them would render an
 * authoritative-looking empty page, which is the failure mode this whole
 * milestone exists to kill.
 *
 * The live sources, verified against prod on 2026-07-31:
 *
 *   arc_messages.metadata   steps (27 rows) · recall (47) · context_scopes (48)
 *                           mode/route (48) · runDurationMs (40) · toolCalls (1)
 *   ai_usage_events         69 rows, every one carrying task_id, joined on
 *                           arc_messages.agent_task_id — all 50 task-bearing
 *                           messages resolve.
 *
 * `toolCalls` is honestly reported as thin rather than hidden: the writer only
 * started landing rows on 2026-07-31, so most runs have none, and the view says
 * so instead of implying the run made no tool calls.
 */

export type ArcRunCost = {
  inputTokens: number;
  outputTokens: number;
  cents: number;
  models: string[];
  events: number;
};

export type ArcRunInspection = {
  id: string;
  conversationId: string;
  /** The operator's question that opened this run, when it can be found. */
  request: string | null;
  answer: string;
  status: ArcMessage["status"];
  createdAt: string;
  mode?: string;
  route?: string;
  contextScopes: string[];
  durationMs: number | null;
  steps: ArcStep[];
  toolCalls: ArcToolCall[];
  recall: ArcRecall[];
  /** Null when the runner recorded no usage for this run at all. */
  cost: ArcRunCost | null;
  /**
   * Plain-language reasons this run is suspect, most serious first. Empty for a
   * healthy run. This is what turns "the answer looked wrong" into a specific
   * step without opening a database.
   */
  concerns: string[];
};

export type ArcRunInspectionResult =
  | { status: "live"; run: ArcRunInspection }
  | { status: "not_found" }
  | UnavailableResult;

type UsageRow = {
  input_tokens: number | null;
  output_tokens: number | null;
  cost_estimate_cents: number | null;
  model: string | null;
};

/**
 * Fetch one run, scoped to `orgId`.
 *
 * `getArcMessage` takes NO scope and uses the service-role client, so a raw id
 * lookup would read across tenants. The conversation is checked first and a
 * message outside the org is reported as `not_found` rather than `forbidden`:
 * "this run exists but is not yours" is itself a disclosure.
 */
export async function getArcRunInspection(
  messageId: string,
  orgId: string,
  client?: SupabaseClient,
): Promise<ArcRunInspectionResult> {
  if (!client && !isSupabaseAdminConfigured()) {
    // The offline preview serves demo fixtures, and a page that can only ever
    // render its empty state is a page nobody has actually seen. Demo mode is
    // opt-in (ARC_DEMO_DATA) so a real, unconfigured deployment still gets the
    // honest "could not be loaded" answer rather than invented data.
    if (isDemoDataEnabled()) return { status: "live", run: demoRun(messageId) };
    return { status: "unavailable", message: "Supabase is not configured." };
  }
  const supabase = client ?? getSupabaseAdminClient();

  let message: ArcMessage | null;
  try {
    message = await getArcMessage(messageId, supabase);
  } catch (error) {
    return unavailableRead("arc-chat.getArcRunInspection", orgId, error, {
      surface: "primary",
      fallbackMessage: "This run could not be loaded.",
    });
  }
  if (!message) return { status: "not_found" };

  // Scope gate. Everything below is reached only for a run this org owns.
  const conversation = await supabase
    .from("arc_conversations")
    .select("id")
    .eq("id", message.conversationId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (conversation.error) {
    return unavailableRead("arc-chat.getArcRunInspection.scope", orgId, conversation.error, { surface: "primary" });
  }
  if (!conversation.data) return { status: "not_found" };

  const [request, cost] = await Promise.all([
    findRequest(supabase, message, orgId),
    loadCost(supabase, message.agentTaskId, orgId),
  ]);
  if (cost.status === "unavailable") return cost;

  const recall = message.recall ?? [];
  const toolCalls = message.toolCalls ?? [];

  return {
    status: "live",
    run: {
      id: message.id,
      conversationId: message.conversationId,
      request,
      answer: message.body,
      status: message.status,
      createdAt: message.createdAt,
      mode: message.mode,
      route: message.route,
      contextScopes: message.contextScopes ?? [],
      durationMs: message.runDurationMs ?? null,
      steps: message.steps ?? [],
      toolCalls,
      recall,
      cost: cost.cost,
      concerns: describeConcerns(message, recall, toolCalls),
    },
  };
}

/**
 * The operator turn that opened this run. Best-effort: an older row may have no
 * preceding operator message, and a missing question is not worth failing the
 * whole view over.
 */
async function findRequest(supabase: SupabaseClient, message: ArcMessage, _orgId: string): Promise<string | null> {
  const { data } = await supabase
    .from("arc_messages")
    .select("body")
    .eq("conversation_id", message.conversationId)
    .eq("role", "operator")
    .lt("created_at", message.createdAt)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ body: string }>();
  return data?.body ?? null;
}

async function loadCost(
  supabase: SupabaseClient,
  taskId: string | null,
  orgId: string,
): Promise<{ status: "ok"; cost: ArcRunCost | null } | UnavailableResult> {
  if (!taskId) return { status: "ok", cost: null };

  const { data, error } = await supabase
    .from("ai_usage_events")
    .select("input_tokens, output_tokens, cost_estimate_cents, model")
    .eq("task_id", taskId)
    // Defence in depth: the task id already belongs to a scoped conversation.
    .eq("org_id", orgId);

  if (error) {
    return unavailableRead("arc-chat.getArcRunInspection.cost", orgId, error, { surface: "secondary" });
  }
  const rows = (data ?? []) as UsageRow[];
  if (!rows.length) return { status: "ok", cost: null };

  return {
    status: "ok",
    cost: {
      inputTokens: rows.reduce((sum, r) => sum + (r.input_tokens ?? 0), 0),
      outputTokens: rows.reduce((sum, r) => sum + (r.output_tokens ?? 0), 0),
      cents: rows.reduce((sum, r) => sum + (r.cost_estimate_cents ?? 0), 0),
      models: [...new Set(rows.map((r) => r.model).filter((m): m is string => Boolean(m)))],
      events: rows.length,
    },
  };
}

/**
 * Turn the run's own record into plain-language concerns, most serious first.
 *
 * "A run that retrieved zero context is obvious at a glance" is the acceptance
 * criterion this serves — an empty recall is stated as a finding rather than
 * left as an empty panel the reader has to notice.
 */
function describeConcerns(message: ArcMessage, recall: ArcRecall[], toolCalls: ArcToolCall[]): string[] {
  const concerns: string[] = [];

  if (message.status === "failed") {
    concerns.push("The run failed — Arc did not finish this reply.");
  }

  const errored = toolCalls.filter((t) => t.status === "error");
  for (const tool of errored) {
    const detail = (tool.output ?? "").split("\n").find((line) => line.trim()) ?? "";
    concerns.push(`Tool \`${tool.name}\` reported an error${detail ? `: ${detail.slice(0, 160)}` : "."}`);
  }

  if (!recall.length) {
    // The highest-value signal in the whole view.
    concerns.push("Nothing was recalled from the Brain — this answer had no retrieved memory behind it.");
  }

  const unfinished = message.steps.filter((step) => step.status === "running");
  if (unfinished.length) {
    concerns.push(
      `${unfinished.length} step${unfinished.length > 1 ? "s" : ""} never completed: ${unfinished
        .map((s) => s.label)
        .join(", ")}.`,
    );
  }

  if (!message.body.trim() && message.status !== "pending") {
    concerns.push("Arc produced an empty answer.");
  }

  return concerns;
}

/**
 * A demo run for the offline preview, mirroring the shape the live path
 * returns. Deliberately a HEALTHY run with one unfinished step, so the page
 * shows both a populated retrieval panel and a real concern rather than an
 * implausibly perfect example.
 */
function demoRun(messageId: string): ArcRunInspection {
  const at = "2026-07-14T09:35:00.000Z";
  return {
    id: messageId,
    conversationId: "demo-conversation",
    request: "Which accounts should we reach first after the pricing-page surge?",
    answer:
      "142 accounts hit pricing repeatedly and still haven't booked a demo — about 23% of the active pipeline.",
    status: "complete",
    createdAt: at,
    mode: "ask",
    route: "chat",
    contextScopes: ["crm", "brand"],
    durationMs: 8400,
    steps: [
      { label: "Reading the pricing-page signal", status: "done", at },
      { label: "Scoring intent across the account list", status: "done", at },
      { label: "Drafting the recommendation", status: "running", at },
    ],
    toolCalls: [{ name: "search_leads", status: "complete", output: '{"leads":[…],"total":142}' }],
    recall: [
      { label: "demo_beats_discount", summary: "Leading with a demo outperforms a discount offer on high-intent accounts.", confidence: 0.86, kind: "learning" },
      { label: "trial_books_faster", summary: "Accounts in an active trial book a demo faster than cold accounts.", confidence: 0.72, kind: "learning" },
      { label: "three_visits_signal", summary: "Three or more pricing-page visits in a week is the strongest near-term buying signal.", confidence: 0.81, kind: "signal" },
    ],
    cost: { inputTokens: 18_420, outputTokens: 1_180, cents: 34, models: ["claude-opus-5"], events: 3 },
    concerns: ["1 step never completed: Drafting the recommendation."],
  };
}

import { runArcCampaignTask, runArcOpportunityDraft, runArcOpportunityScan, runArcTurn } from "./arc";
import { captureRunnerError } from "./observability";
import type { Config } from "./config";
import type { ArcClient } from "./arc-client";
import type { ArcCampaignTaskPayload, ArcOpportunityDraftPayload, ArcOpportunityScanPayload, MarkChatMessagePayload } from "./types";

/**
 * Handle one operator chat message: run it through Arc (Claude Agent SDK) and
 * post the reply back to the app, which resolves the pending bubble in /mark.
 * Outbound stays locked — this only records a chat reply.
 */
export async function handleChatMessage(
  client: ArcClient,
  _config: Config,
  payload: MarkChatMessagePayload,
): Promise<void> {
  console.log(`[arc-runner] wake received → running Arc for task ${payload.agentTaskId} (route=${payload.route}, mode=${payload.mode})`);
  const started = Date.now();
  try {
    const result = await runArcTurn(payload, client);
    const reply = result.body;
    const metadata: Record<string, unknown> = {};
    if (result.actions.length > 0) metadata.actions = result.actions;
    if (result.suggestions.length > 0) metadata.suggestions = result.suggestions;
    if (result.questions.length > 0) metadata.questions = result.questions;
    if (result.memory.length > 0) metadata.recall = result.memory;
    if (result.toolCalls?.length) metadata.toolCalls = result.toolCalls;
    if (result.reasoning) metadata.reasoning = result.reasoning;
    metadata.runDurationMs = Math.max(0, Date.now() - started);
    await client.postChatReply({
      agentTaskId: payload.agentTaskId,
      body: reply || "(Arc returned an empty reply.)",
      status: reply ? "complete" : "failed",
      metadata,
      ...(result.sources.length > 0 ? { mentions: result.sources } : {}),
    });
    await client.postUsage({
      model: result.usage.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      detail: result.usage.detail,
      actorUser: payload.operator ?? null,
      taskId: payload.agentTaskId,
    });
    console.log(`[arc-runner] replied to task ${payload.agentTaskId} in ${Date.now() - started}ms`);
  } catch (error) {
    console.error("[arc-runner] Arc run failed:", error);
    // The operator only sees "Arc hit an error… check the runner logs" — this is
    // what makes the cause reach someone without them going to look.
    captureRunnerError(error, { run: "chat", agentTaskId: payload.agentTaskId });
    await client
      .postChatReply({
        agentTaskId: payload.agentTaskId,
        status: "failed",
        body: "Arc hit an error generating a reply. Check the runner logs.",
      })
      .catch(() => undefined);
  }
}

/**
 * Handle an `arc_opportunity_draft` wake: run Arc in DRAFT mode against the
 * briefing to produce an approval-gated campaign package. The draft links back
 * to the opportunity via opportunity_id (threaded into create_campaign_draft),
 * and the draft-asset endpoint flips the opportunity to "drafted" — that link is
 * the real outcome, so there is no separate task-completion call here (the
 * ArcClient exposes none and we don't fabricate endpoints). Outbound stays
 * locked; everything Arc produces awaits human approval.
 */
export async function handleOpportunityDraft(
  client: ArcClient,
  _config: Config,
  payload: ArcOpportunityDraftPayload,
): Promise<void> {
  console.log(
    `[arc-runner] opportunity-draft wake received → drafting for opportunity ${payload.opportunityId} (task ${payload.agentTaskId}, lead ${payload.leadId})`,
  );
  const started = Date.now();
  try {
    const result = await runArcOpportunityDraft(payload, client);
    console.log(
      `[arc-runner] opportunity ${payload.opportunityId} drafted in ${Date.now() - started}ms (${result.actions.length} card(s))`,
    );
    await client.postUsage({
      model: result.usage.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      detail: result.usage.detail,
      actorUser: payload.operator ?? null,
      taskId: payload.agentTaskId,
    });
  } catch (error) {
    console.error(`[arc-runner] opportunity-draft run failed for ${payload.opportunityId}:`, error);
    captureRunnerError(error, { run: "opportunity-draft", opportunityId: payload.opportunityId });
  }
}

/** Longest of Arc's own words to inline in the task summary; the full text is kept in outputs. */
const SCAN_REASON_CHARS = 400;

/**
 * One line describing what a scan did, for the task record.
 *
 * A scan that proposes nothing is the case this exists for. On 2026-08-04 Arc
 * read the CRM, personas, activity, companies and settings, proposed nothing,
 * and wrote 1,471 characters explaining why — which the runner then discarded,
 * because only `actions.length` was ever recorded. From the outside that is
 * indistinguishable from a scan that crashed, and working out which took an hour
 * of log archaeology. Arc's reason belongs on the record.
 *
 * Pure and exported so the wording is assertable.
 */
export function scanCompletionSummary(cardCount: number, body: string | null | undefined): string {
  const count = `Opportunity scan complete — proposed ${cardCount} opportunity(ies).`;
  if (cardCount > 0) return count;

  const reason = (body ?? "").trim().replace(/\s+/g, " ");
  if (!reason) {
    // Silence here is itself the finding: nothing was proposed AND nothing was
    // said, which is a different problem from a considered "nothing to add".
    return `${count} Arc gave no reason.`;
  }
  const clipped = reason.length > SCAN_REASON_CHARS ? `${reason.slice(0, SCAN_REASON_CHARS - 1).trim()}…` : reason;
  return `${count} Arc's reason: ${clipped}`;
}

/**
 * Handle an `arc_opportunity_scan` wake: run Arc in SCAN mode to survey CRM /
 * personas / brand / activity and propose pending opportunities. Everything stays
 * approval-gated — the scan tool set has no outbound or draft tools beyond
 * propose_opportunity (status=pending). Outbound stays locked.
 */
export async function handleOpportunityScan(
  client: ArcClient,
  _config: Config,
  payload: ArcOpportunityScanPayload,
): Promise<void> {
  console.log(`[arc-runner] opportunity-scan wake received → scanning (task ${payload.agentTaskId})`);
  const started = Date.now();
  try {
    const result = await runArcOpportunityScan(payload, client);
    console.log(`[arc-runner] opportunity scan finished in ${Date.now() - started}ms (${result.actions.length} card(s))`);
    await client.postUsage({
      model: result.usage.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      detail: result.usage.detail,
      actorUser: payload.operator ?? null,
      taskId: payload.agentTaskId,
    });
    // Settle the agent_task so the scan doesn't sit in the inbox as `queued`
    // forever (the proposed opportunities are the real outcome). Lifecycle-only —
    // `/complete` never unlocks outbound. Mirrors handleCampaignTask's background
    // (no-conversation) branch.
    await client.apiPost(`/api/v1/arc/tasks/${payload.agentTaskId}/complete`, {
      summary: scanCompletionSummary(result.actions.length, result.body),
      // `reply` is Arc's full account of the pass — the part that used to be
      // thrown away. `toolCalls` says what it actually looked at, which is how
      // you tell "read everything, judged there was nothing new" apart from
      // "barely looked".
      outputs: { actions: result.actions, reply: result.body ?? "", toolCalls: result.toolCalls },
    });
  } catch (error) {
    console.error(`[arc-runner] opportunity-scan run failed (task ${payload.agentTaskId}):`, error);
    captureRunnerError(error, { run: "opportunity-scan", agentTaskId: payload.agentTaskId });
    // Name the error on the record. "Check the runner logs" is what this said
    // before, and on 2026-08-04 that sent the diagnosis to Cloud Logging for an
    // hour to recover one line that was already in hand here.
    const detail = error instanceof Error ? error.message : String(error);
    await client
      .apiPost(`/api/v1/arc/tasks/${payload.agentTaskId}/block`, {
        reason: `Arc hit an error running the opportunity scan: ${detail}`,
      })
      .catch(() => undefined);
  }
}

/**
 * Handle a campaign task wake: run Arc in draft mode against a fixed campaign.
 * Chat-originated tasks resolve their pending bubble; background handoffs update
 * the agent task directly. Outbound remains locked in both paths.
 */
export async function handleCampaignTask(
  client: ArcClient,
  _config: Config,
  payload: ArcCampaignTaskPayload,
): Promise<void> {
  console.log(
    `[arc-runner] campaign-task wake received -> ${payload.taskType} for campaign ${payload.campaignId} (task ${payload.agentTaskId})`,
  );
  const started = Date.now();

  // Claim first, always. Two reasons, and the second is the load-bearing one:
  //
  //  1. It de-duplicates. A wake racing an operator's Retry both point at this
  //     task; the claim is a compare-and-set, so exactly one wins and the loser
  //     drops out here instead of running the instruction a second time.
  //  2. It makes `queued` mean something. Campaign tasks used to run without
  //     ever leaving `queued` — only the final /complete moved them — so a task
  //     mid-run looked identical to one whose wake was dropped. Nothing could
  //     tell the two apart, which is why stranded revisions were unrecoverable
  //     rather than merely retryable (BSR-695).
  //
  // A claim failure is NOT a reason to skip the work: if the app is briefly
  // unreachable the operator's revision still matters more than the bookkeeping,
  // and the retry path is guarded by its own re-read. So log and continue.
  try {
    const claimed = await client.claimTask(payload.agentTaskId);
    if (!claimed) {
      console.log(`[arc-runner] campaign task ${payload.agentTaskId} already claimed elsewhere — skipping duplicate run`);
      return;
    }
  } catch (error) {
    console.warn(`[arc-runner] could not claim campaign task ${payload.agentTaskId}, running anyway:`, error);
  }

  try {
    const result = await runArcCampaignTask(payload, client);
    const reply = result.body || "(Arc returned an empty campaign update.)";
    const metadata: Record<string, unknown> = {};
    if (result.actions.length > 0) metadata.actions = result.actions;
    if (result.suggestions.length > 0) metadata.suggestions = result.suggestions;
    if (result.questions.length > 0) metadata.questions = result.questions;
    if (result.memory.length > 0) metadata.recall = result.memory;
    if (result.toolCalls?.length) metadata.toolCalls = result.toolCalls;

    if (payload.conversationId) {
      await client.postChatReply({
        agentTaskId: payload.agentTaskId,
        body: reply,
        status: "complete",
        metadata,
        ...(result.sources.length > 0 ? { mentions: result.sources } : {}),
      });
    } else {
      await client.apiPost(`/api/v1/arc/tasks/${payload.agentTaskId}/complete`, {
        summary: reply,
        outputs: {
          actions: result.actions,
          suggestions: result.suggestions,
          questions: result.questions,
          sources: result.sources,
        },
      });
    }

    console.log(`[arc-runner] campaign task ${payload.agentTaskId} finished in ${Date.now() - started}ms`);
  } catch (error) {
    console.error(`[arc-runner] campaign-task run failed for ${payload.agentTaskId}:`, error);
    captureRunnerError(error, { run: "campaign-task", agentTaskId: payload.agentTaskId });
    if (payload.conversationId) {
      await client
        .postChatReply({
          agentTaskId: payload.agentTaskId,
          status: "failed",
          body: "Arc hit an error building this campaign. Check the runner logs.",
        })
        .catch(() => undefined);
    } else {
      await client
        .apiPost(`/api/v1/arc/tasks/${payload.agentTaskId}/block`, {
          reason: "Arc hit an error building this campaign. Check the runner logs.",
        })
        .catch(() => undefined);
    }
  }
}

import { createHmac } from "node:crypto";

import { type ArcMention } from "@/domain";
import { type ApprovalStrictness, type AssistantResponseStyle, type AssistantTone } from "@/lib/settings/store";

import { resolveAgentConnection } from "@/lib/agent/connection";
import { recordTestResult } from "@/lib/agent/health";
import { resolveWebhookSecret } from "@/lib/agent/secret";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { ARC_SKILL_IDS, type ArcSkillId } from "@/lib/arc-skills/catalog";
import { type ArcAttachment } from "./persistence";
import { type WakeHistoryTurn } from "./history";

export type ArcNotifyPayload = {
  /** The operator message row that triggered this wake (arc_messages.id). */
  messageId: string;
  conversationId: string;
  /** The conversation's project, if any — enables project-scoped context for Arc. */
  projectId: string | null;
  /** The conversation's linked campaign, if any — grounds the chat. */
  campaignId: string | null;
  /** The queued agent_task Arc settles when it posts its reply back. */
  agentTaskId: string;
  message: string;
  mentions: ArcMention[];
  operator: string;
  /**
   * Model-routing hint for the external runner. Routine chat rides the cheap/fast
   * path ("fast"); reserve "standard" for heavier work. The app holds no model
   * keys — this is only advisory metadata for Arc's own router.
   */
  route: "fast" | "standard";
  /** Operator stance (ask/act/draft); advisory for Arc's worker. */
  mode: "ask" | "act" | "draft";
  /** Operator-selected behavior hints from Settings -> Agent behavior. */
  assistantTone?: AssistantTone;
  assistantResponseStyle?: AssistantResponseStyle;
  approvalStrictness?: ApprovalStrictness;
  /** Structured slash command id (e.g. "find-leads"), or null for plain chat. */
  command?: string | null;
  /** Optional generic runner skill that narrows tools and adds playbook instructions. */
  skillId?: ArcSkillId | null;
  /** Operator-uploaded reference images (GCS signed read URLs) for Arc to use. */
  attachments?: ArcAttachment[];
  /** Workspace source groups the operator selected in the composer. */
  contextScopes?: string[];
  /** Bounded prior turns (oldest → newest), excluding the current message. */
  history?: WakeHistoryTurn[];
};

/**
 * Wake Arc the moment a chat message is sent — push, not poll (Telegram-style).
 * POSTs the message to ARC_RUNNER_URL (Arc's Arc Agent webhook route; the
 * legacy ARC_WEBHOOK_URL is still honored as a fallback). Arc turns the
 * payload into a prompt, runs Arc, and Arc posts his
 * reply back to POST /api/v1/arc/messages. The agent runs only when there's
 * something to answer — idle costs nothing.
 *
 * Auth matches Arc' generic webhook validator: an `X-Webhook-Signature`
 * header holding the raw HMAC-SHA256 hex digest of the request body, keyed by
 * the route secret (ARC_WEBHOOK_SECRET). If no secret is set, the header is
 * omitted (only valid against a Arc route using INSECURE_NO_AUTH on loopback).
 *
 * Best-effort: never throws and uses a short timeout, so a slow or unreachable
 * agent can't block or fail the operator's send (the message is already queued
 * and Arc can still pull it from the inbox as a fallback).
 *
 * Returns whether the wake was delivered (a 2xx from the webhook). The caller
 * uses this to decide whether to claim the task now (push path) or leave it
 * queued for the inbox fallback.
 *
 * Env:
 *   ARC_RUNNER_URL      — Arc/Arc runner webhook route, e.g.
 *                          https://host:8644/webhooks/growth-chat. (Legacy alias:
 *                          ARC_WEBHOOK_URL — read as a fallback for back-compat.)
 *   ARC_WEBHOOK_SECRET  — the route's secret (used to HMAC-sign the body)
 */
export async function notifyArcWebhook(payload: ArcNotifyPayload): Promise<boolean> {
  return postArcWake({ type: "arc_chat_message", ...payload });
}

export type ArcOpportunityDraftWake = {
  opportunityId: string;
  agentTaskId: string;
  message: string;
  leadId: string;
  operator: string;
  skillId?: ArcSkillId | null;
};

/** Best-effort wake for an opportunity draft — same transport/signing as the chat wake. */
export async function notifyArcOpportunityDraft(payload: ArcOpportunityDraftWake): Promise<boolean> {
  return postArcWake({ type: "arc_opportunity_draft", skillId: ARC_SKILL_IDS.approvalGatedDrafting, ...payload });
}

export type ArcOpportunityScanWake = {
  agentTaskId: string;
  message: string;
  operator: string;
  skillId?: ArcSkillId | null;
};

/** Best-effort wake for an operator-triggered opportunity scan — same transport/signing as the chat wake. */
export async function notifyOpportunityScan(payload: ArcOpportunityScanWake): Promise<boolean> {
  return postArcWake({ type: "arc_opportunity_scan", skillId: ARC_SKILL_IDS.opportunityDiscovery, ...payload });
}

export type ArcCampaignTaskWake = {
  agentTaskId: string;
  campaignId: string;
  /**
   * The specific asset being revised. Only set for `campaign_asset_revision` —
   * without it Arc knows the campaign but not which of its assets the operator
   * asked to change, and a campaign with more than one asset makes that a guess.
   */
  assetId?: string | null;
  conversationId: string | null;
  message: string;
  operator: string;
  taskType: "campaign_brief_draft" | "campaign_directive" | "campaign_asset_revision";
  skillId?: ArcSkillId | null;
};

/** Best-effort wake for campaign generation/revision work — same transport/signing as chat. */
export async function notifyArcCampaignTask(payload: ArcCampaignTaskWake): Promise<boolean> {
  return postArcWake({ type: "arc_campaign_task", skillId: ARC_SKILL_IDS.approvalGatedDrafting, ...payload });
}

/**
 * Shared transport for every Arc wake: resolve the agent connection (webhook url +
 * secret), HMAC-sign the already-formed body, and POST it with a short timeout.
 * Best-effort — never throws; records reachability so the connection pill reflects
 * whether the runner actually answered.
 */
/**
 * An un-stamped wake makes the runner omit ARC_WORKSPACE_HEADER, which pushes its
 * callbacks onto arcGuard's session-less fallback. Returns the empty identity so
 * the wake still goes out — but never without a record of why it was blind.
 */
function warnUnstampedWake(reason: string): Record<string, never> {
  console.warn(
    `[arc-notify] waking Arc without tenant identity: ${reason}. The runner will omit ${"x-arc-workspace-id"} and its ` +
      "callbacks will fall back to sole-workspace resolution, which fails once this deployment has more than one.",
  );
  return {};
}

async function postArcWake(body: Record<string, unknown>): Promise<boolean> {
  const connection = await resolveAgentConnection();
  const url = connection.webhookUrl;
  if (!url) return false;
  if (!connection.enabled) return false;

  // Stamp the wake with the authoritative tenant identity so a shared runner can
  // echo it back on its callbacks (ARC_WORKSPACE_HEADER) and act as the right
  // workspace, instead of collapsing every callback to the default one.
  //
  // A wake that goes out WITHOUT identity is the one case that still reaches the
  // session-less fallback in arcGuard, so it must not fail quietly: this used to
  // be `.catch(() => null)`, which turned "we could not tell who this is" into an
  // ordinary unstamped wake and left no trace anywhere. It is survivable today
  // only because a single-org, single-workspace deployment has exactly one
  // answer for the fallback to find; the moment a second workspace exists the
  // same silence becomes a 409 with nothing in the logs explaining it. Degrade,
  // but say so.
  const identity = await getCurrentWorkspaceContext()
    .then((context) =>
      context.orgId && context.workspaceId
        ? { orgId: context.orgId, workspaceId: context.workspaceId }
        : warnUnstampedWake(`workspace context resolved without a workspaceId (org "${context.orgSlug}")`),
    )
    .catch((error: unknown) => warnUnstampedWake(error instanceof Error ? error.message : String(error)));

  const serialized = JSON.stringify({ ...body, ...identity });
  const headers: Record<string, string> = { "content-type": "application/json" };

  const secret = await resolveWebhookSecret(connection.webhookSecretRef);
  if (secret) {
    headers["x-webhook-signature"] = createHmac("sha256", secret).update(serialized).digest("hex");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(url, { method: "POST", headers, body: serialized, signal: controller.signal });
    // The wake doubles as a reachability probe: record the outcome so the connection
    // pill reflects whether the runner actually answered, not just whether a URL is
    // configured. It is telemetry, not part of message acceptance, so do not hold
    // the chat response behind another database write.
    void recordTestResult({ status: res.ok ? "ok" : "error", error: res.ok ? null : `HTTP ${res.status}` });
    return res.ok;
  } catch {
    // Best-effort wake-up; intentionally swallow errors and let the inbox catch it.
    void recordTestResult({ status: "unreachable", error: "Wake request failed." });
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

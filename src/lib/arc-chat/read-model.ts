import "server-only";
import { reportDegraded } from "@/lib/observability/report-degraded";

import { getOperatorActor } from "@/lib/auth/operator";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

import {
  listActiveArcRunConversationIds,
  listConversationsForViewer,
  listMessages,
  type ArcConversation,
  type ArcMessage,
} from "./persistence";
import { getShareViewer } from "./sharing";

/** A run older than this is treated as stale (an orphaned/stuck task) and no
 *  longer shows a "working" indicator — mirrors the client's awaiting-reply cap. */
const RUN_FRESHNESS_MS = 120_000;

/**
 * Page-facing read-model for the `/arc` chat screen. Resolves the current
 * viewer + operator, lists the conversations they may see, and loads the active
 * conversation's messages. Mirrors the vault/campaigns shape: a status union so
 * the UI can degrade gracefully.
 *
 * - "live"        — real conversations exist; render them.
 * - "empty"       — backend is configured but the workspace has no Arc chats yet
 *                   (fresh workspace) → the UI shows its illustrative mock.
 * - "error"       — a configured workspace could not load chat history. Keep
 *                   the real composer visible; never masquerade as demo data.
 * - "unavailable" — no Supabase backend (local demo preview) → the UI shows
 *                   its illustrative mock.
 */
export type ArcChatModel =
  | {
      status: "live";
      operator: string;
      conversations: ArcConversation[];
      /** null when starting a brand-new chat (rail stays, composer opens blank). */
      activeConversationId: string | null;
      messages: ArcMessage[];
      /** Rail sections, grouped server-side (keeps the impure `now` read out of the page component). */
      threadGroups: ArcThreadGroupVM[];
    }
  | { status: "empty"; operator: string }
  | { status: "error"; message: string }
  | { status: "unavailable" };

export async function getArcChatModel(
  requestedConversationId?: string | null,
  opts?: { startBlank?: boolean },
): Promise<ArcChatModel> {
  if (!isSupabaseAdminConfigured()) return { status: "unavailable" };

  try {
    const [viewer, operator] = await Promise.all([getShareViewer(), getOperatorActor()]);
    const conversations = await listConversationsForViewer(viewer, operator);
    if (conversations.length === 0) return { status: "empty", operator };

    const nowMs = Date.now();
    // Conversations with a genuinely in-flight Arc run — powers the "working"
    // indicator on other threads. Unscoped read is safe: we only mark rows the
    // viewer already sees (runningIds is intersected with their conversations).
    const activeRuns = await listActiveArcRunConversationIds().catch(() => []);
    const runningIds = new Set(activeRuns.filter((run) => nowMs - Date.parse(run.since) < RUN_FRESHNESS_MS).map((run) => run.conversationId));

    // "New chat": keep the rail (real threads) but open a blank composer. The
    // first send creates the conversation.
    if (opts?.startBlank) {
      return {
        status: "live",
        operator,
        conversations,
        activeConversationId: null,
        messages: [],
        threadGroups: groupThreadsForRail(conversations, null, nowMs, runningIds),
      };
    }

    // Honor the requested conversation only if it's one the viewer may see;
    // otherwise fall back to the most recent (listConversationsForViewer returns
    // pinned-first, then last_message_at desc).
    const active =
      (requestedConversationId
        ? conversations.find((c) => c.id === requestedConversationId)
        : undefined) ?? conversations[0];

    const messages = await listMessages(active.id);
    return {
      status: "live",
      operator,
      conversations,
      activeConversationId: active.id,
      messages,
      threadGroups: groupThreadsForRail(conversations, active.id, nowMs, runningIds),
    };
  } catch (error) {
    // Degrade, but not silently — this read IS the screen, so an empty
    // state here is indistinguishable from an outage (BSR-544).
    reportDegraded(error, { scope: "arc-chat.getArcChatModel", surface: "primary" });
    return {
      status: "error",
      message: "We couldn't load conversation history. No chats were changed; refresh to try again.",
    };
  }
}

/** One thread as the rail renders it. `pinned`/`active` drive the visual state. */
export type ArcThreadVM = {
  id: string;
  title: string;
  /** Compact semantic preview from Arc's rolling conversation summary. */
  preview?: string | null;
  pinned: boolean;
  active: boolean;
  /** True while an Arc run is genuinely in flight for this thread — drives the
   *  "working" indicator so a run started here is visible from any other thread. */
  running: boolean;
  /** Short relative-time label (e.g. "2h", "Jun 24") for the row's meta line. */
  when: string;
  campaignId?: string | null;
};

export type ArcThreadGroupVM = { group: string; items: ArcThreadVM[] };

/** Compact conversation link for shared app-shell navigation. */
export type ArcRecentConversationVM = {
  id: string;
  title: string;
  when: string;
};

const DAY_MS = 86_400_000;

/** Short, stable relative-time label. `nowMs` is passed in so callers stay pure. */
function relativeWhen(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, nowMs - then);
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < DAY_MS) return `${Math.floor(diff / 3_600_000)}h`;
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Lightweight, access-scoped conversation read for the shared app shell.
 *
 * `null` means no backend is configured, which lets the offline demo use its
 * illustrative threads without ever masking a configured workspace read error.
 */
export async function getRecentArcConversations(
  {
    limit = 3,
    nowMs = Date.now(),
    orgId,
    workspaceId,
  }: {
    limit?: number;
    nowMs?: number;
    orgId?: string;
    workspaceId?: string | null;
  } = {},
): Promise<ArcRecentConversationVM[] | null> {
  if (!isSupabaseAdminConfigured()) return null;

  try {
    const [viewer, operator] = await Promise.all([getShareViewer(), getOperatorActor()]);
    const conversations = await listConversationsForViewer(viewer, operator);
    const safeLimit = Math.max(0, Math.min(limit, 5));

    return [...conversations]
      .filter((conversation) => !orgId || conversation.orgId === orgId)
      .filter((conversation) => !workspaceId || !conversation.workspaceId || conversation.workspaceId === workspaceId)
      .sort((left, right) => Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt))
      .slice(0, safeLimit)
      .map((conversation) => ({
        id: conversation.id,
        title: conversation.title.trim() || "Untitled chat",
        when: relativeWhen(conversation.lastMessageAt, nowMs),
      }));
  } catch {
    return [];
  }
}

function bucket(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "Earlier";
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  if (then >= todayMs) return "Today";
  if (then >= todayMs - DAY_MS) return "Yesterday";
  if (then >= todayMs - 7 * DAY_MS) return "Previous 7 days";
  return "Earlier";
}

const GROUP_ORDER = ["Pinned", "Today", "Yesterday", "Previous 7 days", "Earlier"];

function summaryPreview(summary: string | null) {
  if (!summary) return null;
  const clean = summary
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  const sentence = clean.split(/(?<=[.!?])\s+/)[0] ?? clean;
  return sentence.length <= 96 ? sentence : `${sentence.slice(0, 95).trimEnd()}…`;
}

/**
 * Group conversations into the rail's sections (Pinned / Today / Yesterday /
 * Previous 7 days / Earlier). Pure: pass `nowMs` from the caller so the server
 * component controls "now" and there's no hidden clock read.
 */
export function groupThreadsForRail(
  conversations: ArcConversation[],
  activeConversationId: string | null,
  nowMs: number,
  runningIds: ReadonlySet<string> = new Set(),
): ArcThreadGroupVM[] {
  const groups = new Map<string, ArcThreadVM[]>();
  for (const c of conversations) {
    const group = c.pinnedAt ? "Pinned" : bucket(c.lastMessageAt, nowMs);
    const item: ArcThreadVM = {
      id: c.id,
      title: c.title?.trim() || "Untitled chat",
      preview: summaryPreview(c.summary),
      pinned: Boolean(c.pinnedAt),
      active: c.id === activeConversationId,
      running: runningIds.has(c.id),
      when: relativeWhen(c.lastMessageAt, nowMs),
      campaignId: c.campaignId,
    };
    const list = groups.get(group);
    if (list) list.push(item);
    else groups.set(group, [item]);
  }
  return GROUP_ORDER.filter((g) => groups.has(g)).map((group) => ({ group, items: groups.get(group)! }));
}

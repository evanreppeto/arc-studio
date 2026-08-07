import "server-only";
import { decideArcRunStalled, flattenArcMarkdown } from "@/domain";
import { reportDegraded } from "@/lib/observability/report-degraded";

import { getOperatorActor } from "@/lib/auth/operator";
import { notConfigured } from "@/lib/observability/unavailable";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import {
  listActiveArcRunConversationIds,
  listArcRunTaskStates,
  listConversationsForViewer,
  listMessages,
  type ArcConversation,
  type ArcMessage,
} from "./persistence";
import { RAIL_LOOSE_LIMIT, selectRailConversations } from "./rail-sections";
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
 * - "not_configured" — no Supabase backend (local demo preview) → the UI shows
 *                   its illustrative mock. Named apart from a failure on
 *                   purpose: nothing broke, so nothing should be reported.
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
  /** No backend configured (the local backend-less preview). An answer, not
   *  an outage — `/arc` reads this to fall back to the mock conversation. */
  | { status: "not_configured" };

/**
 * Flag in-flight replies whose run has actually died.
 *
 * Without this a stranded turn renders `pending` forever — and because the row
 * really is `pending`, reloading the page reproduces the spinner rather than
 * clearing it. Marking it here is read-side only: the row is untouched, so if a
 * slow reply does eventually land it simply renders as the reply it is.
 *
 * Best-effort by design. A failed task lookup means we can't prove a run is
 * dead, and the safe reading of "no evidence" is to leave the messages alone —
 * a spinner is a smaller lie than a false "Arc stopped responding" on a run
 * that is still working.
 */
async function markStalledRuns(messages: ArcMessage[], nowMs: number): Promise<ArcMessage[]> {
  const pending = messages.filter((message) => message.role === "arc" && message.status === "pending");
  if (pending.length === 0) return messages;

  const taskStates = await listArcRunTaskStates(
    pending.map((message) => message.agentTaskId).filter((id): id is string => Boolean(id)),
  ).catch((error) => {
    reportDegraded(error, { scope: "arc-chat.markStalledRuns", surface: "secondary" });
    return null;
  });
  if (!taskStates) return messages;

  return messages.map((message) => {
    if (message.role !== "arc" || message.status !== "pending") return message;
    const verdict = decideArcRunStalled({
      status: message.status,
      createdAt: message.createdAt,
      task: message.agentTaskId ? taskStates.get(message.agentTaskId) ?? null : null,
      nowMs,
    });
    return verdict.stalled ? { ...message, stalled: true, stalledReason: verdict.reason } : message;
  });
}

export async function getArcChatModel(
  requestedConversationId?: string | null,
  opts?: { startBlank?: boolean },
): Promise<ArcChatModel> {
  if (!isSupabaseAdminConfigured()) return notConfigured();

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

    const messages = await markStalledRuns(await listMessages(active.id), nowMs);
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
  /** True while an Arc run is genuinely in flight for this thread. The rail is
   *  on every screen, so this is what makes "Arc is still working" survive
   *  navigating away from /arc. */
  running: boolean;
  /** The thread `/arc` opens when the URL names no conversation, so the rail can
   *  mark the current chat the way it marks the current destination. */
  defaultActive: boolean;
  /** The campaign this chat belongs to, when it has one — the folder the rail
   *  files it under. 5 of prod's 25 conversations carry one, which is why the
   *  folders get a reserved budget instead of competing on recency. */
  campaignId?: string | null;
  campaignName?: string | null;
  /** Pinned to the top of the list. The rail's row menu can toggle this now
   *  that it is the conversation sidebar — the control used to live only in the
   *  drawer's copy of this list, which no longer exists. */
  pinned: boolean;
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
 *
 * Returns a flat list, still — the rail groups it into campaign folders on the
 * client. What travels is chosen by `selectRailConversations`, so the payload
 * stays bounded (folders + unattached chats) no matter how many conversations a
 * workspace has: this ships inside the layout, on every route.
 */
export async function getRecentArcConversations(
  {
    limit = RAIL_LOOSE_LIMIT,
    nowMs = Date.now(),
    orgId,
    workspaceId,
  }: {
    /** Cap on UNATTACHED chats. Campaign folders carry their own budget. */
    limit?: number;
    nowMs?: number;
    orgId?: string;
    workspaceId?: string | null;
  } = {},
): Promise<ArcRecentConversationVM[] | null> {
  if (!isSupabaseAdminConfigured()) return null;

  try {
    const [viewer, operator] = await Promise.all([getShareViewer(), getOperatorActor()]);
    const [conversations, activeRuns] = await Promise.all([
      listConversationsForViewer(viewer, operator),
      // Never let the "working" indicator take the rail down with it: a failed
      // run read means no dots, not a shell without recent chats.
      listActiveArcRunConversationIds().catch(() => []),
    ]);
    const looseLimit = Math.max(0, Math.min(limit, RAIL_LOOSE_LIMIT));
    // Mirrors getArcChatModel's own fallback: with no `?c=` in the URL, /arc
    // opens listConversationsForViewer's first row (pinned first, then newest).
    // Read from the unsorted list so the two screens can never disagree.
    const defaultActiveId = conversations[0]?.id ?? null;
    // Same freshness cap the /arc thread rail applies — past it a task is stuck,
    // not live, and a permanent spinner in the shell is worse than no spinner.
    const runningIds = new Set(
      activeRuns
        .filter((run) => nowMs - Date.parse(run.since) < RUN_FRESHNESS_MS)
        .map((run) => run.conversationId),
    );

    const visible = [...conversations]
      .filter((conversation) => !orgId || conversation.orgId === orgId)
      .filter((conversation) => !workspaceId || !conversation.workspaceId || conversation.workspaceId === workspaceId)
      // Pinned first, then newest — the order `listConversationsForViewer`
      // already documents and `/arc` already opens by. Sorting on recency alone
      // meant pinning a chat in the rail changed nothing about where it sat,
      // which is the entire point of pinning it. It feeds the selection below
      // rather than replacing it: order within each part, budget across them.
      .sort((left, right) =>
        (right.pinnedAt ? 1 : 0) - (left.pinnedAt ? 1 : 0)
        || Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt));

    // Campaign folders get their own budget rather than competing with recency.
    // Under the old flat top-5 the rail's grouping had literally never rendered
    // on prod — the newest five chats carry no campaign, and the ones that do
    // sit further down than the cap ever reached. See rail-sections.ts.
    const rows = selectRailConversations(visible, { looseLimit, pinnedIds: [defaultActiveId] })
      .map((conversation) => ({
        id: conversation.id,
        title: conversation.title.trim() || "Untitled chat",
        when: relativeWhen(conversation.lastMessageAt, nowMs),
        running: runningIds.has(conversation.id),
        defaultActive: conversation.id === defaultActiveId,
        campaignId: conversation.campaignId,
        campaignName: null as string | null,
        pinned: Boolean(conversation.pinnedAt),
      }));

    // Names for the handful of campaigns actually referenced — one query, and
    // only when a row needs it. A failed lookup leaves the label off rather than
    // dropping the chat: the link still works without knowing the campaign.
    const campaignIds = [...new Set(rows.map((row) => row.campaignId).filter((id): id is string => Boolean(id)))];
    if (campaignIds.length > 0) {
      const { data } = await getSupabaseAdminClient()
        .from("campaigns")
        .select("id, name")
        .in("id", campaignIds);
      const names = new Map((data ?? []).map((row: { id: string; name: string | null }) => [row.id, row.name]));
      for (const row of rows) {
        if (row.campaignId) row.campaignName = names.get(row.campaignId) ?? null;
      }
    }

    return rows;
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
  // Shared with message search so the two can't quote the same text differently.
  const clean = flattenArcMarkdown(summary, { dropCodeBlocks: true });
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

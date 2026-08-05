"use client";

// The two full-conversation renderers — LiveConversation (server-backed messages)
// and DemoConversation (the offline preview) — plus the new-chat launcher. Both
// compose the shared primitives from ./arc-messages; the container (arc-view.tsx)
// renders these.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, Bookmark, Brain, Check, CircleAlert, ClipboardCheck, Copy, CornerUpLeft, Database, Link2, MessageSquareText, PanelRightOpen, PencilLine, RefreshCcw, RotateCcw, ShieldCheck, Target, X, Zap } from "lucide-react";
import ReactMarkdown from "react-markdown";

import { WORK_STATE_LABEL } from "@/domain";
import type { ArcActionCard, ArcAssetStatus, ArcMention, ArcMode, ArcRecall, ArcRoute } from "@/domain";
import type { ArcMessage, ArcStep } from "@/lib/arc-chat/persistence";
import { buildArcLauncherRecommendation } from "@/lib/arc-chat/launcher-state";
import { buildArcOutcomeView, type ArcOutcomeBadge } from "@/lib/arc-chat/outcome-view";
import { buildArcRunContract, type ArcRunContract } from "@/lib/arc-chat/run-contract";
import { buildArcRunProfile } from "@/lib/arc-chat/run-profile";
import type { ArcAssetBody } from "@/lib/campaigns/read-model";

import { ArcAnswer, MARKDOWN_COMPONENTS, REHYPE_HIGHLIGHT_PLUGINS, REMARK_PLUGINS } from "./arc-markdown";
import {
  ArcDraftCard,
  AssistantMessage,
  assetStatusMeta,
  copyMessageText,
  MessageActions,
  operatorMessageBefore,
  OperatorMessage,
  RecallRow,
  RunTrace,
  SourcesRow,
  useMessageContextMenu,
  type MessageMenuItem,
} from "./arc-messages";
import { DeliverablePackageHead, InlineDeliverable } from "./arc-deliverable";
import { decideArcDraftAction, saveArcMessageAction, saveArcMessageToBrainAction } from "../actions";
import {
  buildDemoLiveWork,
  DEMO_ATTACHMENTS,
  DEMO_BREAKDOWN_MD,
  DEMO_DRAFT_CARD,
  DEMO_PACKAGE_CARDS,
  DEMO_RECALL,
  DEMO_SOURCES,
  DEMO_STEPS,
  DEMO_TOOLS,
} from "./arc-demo-data";
import type { ArcWaiting, DemoTurn } from "./arc-view.types";

export const LAUNCHER_SHORTCUTS: Array<{ icon: typeof Target; label: string; prompt: string }> = [
  { icon: Target, label: "Find priority leads", prompt: "Which accounts should we reach first right now, and why?" },
  { icon: MessageSquareText, label: "Draft a campaign", prompt: "Draft a multi-channel campaign for our highest-priority segment." },
  { icon: ShieldCheck, label: "Review approvals", prompt: "What's waiting for my approval right now?" },
  { icon: Zap, label: "Check new signals", prompt: "What changed in my workspace, and what deserves attention now?" },
];

export type OptimisticArcTurn = {
  body: string;
  mode: ArcMode;
  route: ArcRoute;
  contextScopes: string[];
};

function OutcomeBadgeIcon({ badge }: { badge: ArcOutcomeBadge }) {
  if (badge.kind === "sources") return <Database size={12} />;
  if (badge.kind === "memory") return <Brain size={12} />;
  if (badge.kind === "created") return <ClipboardCheck size={12} />;
  return <CircleAlert size={12} />;
}

/**
 * Everything we can say *about* a reply — the safety label, the evidence badges,
 * the sources Arc read, and the memory it recalled — collected below the answer
 * at metadata scale.
 *
 * This used to sit *above* the response as an uppercase kicker, a safety label,
 * a generated serif headline, and a badge row: four rows of app-authored chrome
 * before the reader reached Arc's first word, with the most prominent line on
 * screen being a sentence Arc never wrote. The evidence is worth keeping — the
 * "Nothing sent" guarantee especially, given nothing here goes outbound without
 * a human — it just isn't more important than the answer.
 */
function ResponseMeta({
  outcome,
  mentions,
  recall,
  onMentionContextMenu,
  onRecallContextMenu,
}: {
  outcome: { safetyLabel: string; badges: ArcOutcomeBadge[] } | null;
  mentions: ArcMention[];
  recall: ArcRecall[];
  onMentionContextMenu?: (event: React.MouseEvent, mention: ArcMention) => void;
  onRecallContextMenu?: (event: React.MouseEvent, item: ArcRecall) => void;
}) {
  const badges = outcome?.badges ?? [];
  const safetyLabel = outcome?.safetyLabel ?? null;
  if (!safetyLabel && badges.length === 0 && mentions.length === 0 && recall.length === 0) return null;
  return (
    <div className="arc-response-evidence">
      {safetyLabel || badges.length > 0 ? (
        <div className="arc-answer-meta" aria-label="Result details">
          {safetyLabel ? <span className="arc-answer-safety"><ShieldCheck size={12} />{safetyLabel}</span> : null}
          {badges.map((badge) => (
            <span key={`${badge.kind}-${badge.label}`} className="arc-answer-badge" data-kind={badge.kind}>
              <OutcomeBadgeIcon badge={badge} />{badge.label}
            </span>
          ))}
        </div>
      ) : null}
      {mentions.length > 0 ? <SourcesRow mentions={mentions} onMentionContextMenu={onMentionContextMenu} /> : null}
      {recall.length > 0 ? <RecallRow recall={recall} onRecallContextMenu={onRecallContextMenu} /> : null}
    </div>
  );
}

/* ── Right-click item builders shared by the live and demo conversations ── */

async function copyAppLink(href: string): Promise<string> {
  return (await copyMessageText(`${window.location.origin}${href}`)) === "Copied" ? "Link copied" : "Copy failed";
}

/** Right-click items for a source citation chip. */
function mentionMenuItems(mention: ArcMention, navigate: (href: string) => void): MessageMenuItem[] {
  if (!mention.href?.startsWith("/")) {
    return [{ kind: "item", label: "Copy source name", icon: <Copy size={14} />, onSelect: () => copyMessageText(mention.label) }];
  }
  const href = mention.href;
  return [
    { kind: "item", label: `Open ${mention.label}`, icon: <ArrowUpRight size={14} />, onSelect: () => navigate(href) },
    { kind: "item", label: "Copy link", icon: <Link2 size={14} />, onSelect: () => copyAppLink(href) },
  ];
}

/** Right-click items for a recalled-memory chip. */
function recallMenuItems(item: ArcRecall, navigate: (href: string) => void): MessageMenuItem[] {
  const items: MessageMenuItem[] = [];
  if (item.nodeId) {
    const href = `/brain?node=${encodeURIComponent(item.nodeId)}`;
    items.push(
      { kind: "item", label: "Open in Brain", icon: <Brain size={14} />, onSelect: () => navigate(href) },
      { kind: "item", label: "Copy link", icon: <Link2 size={14} />, onSelect: () => copyAppLink(href) },
    );
  }
  items.push({ kind: "item", label: "Copy fact", icon: <Copy size={14} />, onSelect: () => copyMessageText(item.label) });
  return items;
}

/** Approve/decline straight from the card menu — the same server action the
 * review workspace uses, so the human gate and its audit trail are identical. */
async function decideAssetViaMenu(
  card: ArcActionCard,
  decision: "approved" | "declined",
  onAssetStatus: (assetId: string, status: ArcAssetStatus) => void,
): Promise<string> {
  const approval = card.approval;
  if (!approval) return "This asset has no approval record.";
  const result = await decideArcDraftAction({ campaignId: approval.campaignId, assetId: approval.assetId, decision });
  if (!result.ok) return result.error;
  onAssetStatus(approval.assetId, decision === "approved" ? "approved" : "rejected");
  const label = decision === "approved" ? "Approved" : "Declined";
  return result.persisted ? label : `Preview — ${label.toLowerCase()}, not saved`;
}

/** Right-click items for a single-asset receipt card. Revision stays a
 * workspace affordance because it needs a typed instruction. */
function receiptMenuItems({
  card,
  status,
  onOpen,
  onAssetStatus,
}: {
  card: ArcActionCard;
  status: ArcAssetStatus | null;
  onOpen: () => void;
  onAssetStatus: (assetId: string, status: ArcAssetStatus) => void;
}): MessageMenuItem[] {
  const decided = status === "approved" || status === "rejected";
  const decidedHint = decided ? assetStatusMeta(status).label : undefined;
  const items: MessageMenuItem[] = [
    { kind: "item", label: "Open in review workspace", icon: <PanelRightOpen size={14} />, onSelect: onOpen },
  ];
  if (card.approval) {
    items.push(
      { kind: "separator" },
      { kind: "item", label: "Approve", icon: <Check size={14} />, disabled: decided, hint: decidedHint, onSelect: () => decideAssetViaMenu(card, "approved", onAssetStatus) },
      { kind: "item", label: "Request revision…", icon: <PencilLine size={14} />, disabled: decided, hint: decidedHint, onSelect: onOpen },
      { kind: "item", label: "Decline", icon: <X size={14} />, disabled: decided, hint: decidedHint, onSelect: () => decideAssetViaMenu(card, "declined", onAssetStatus) },
    );
  }
  return items;
}

/** Right-click items for a multi-asset package card. */
function packageMenuItems({
  cards,
  statusOf,
  onOpen,
  onAssetStatus,
}: {
  cards: ArcActionCard[];
  statusOf: (card: ArcActionCard) => ArcAssetStatus | null;
  onOpen: () => void;
  onAssetStatus: (assetId: string, status: ArcAssetStatus) => void;
}): MessageMenuItem[] {
  const remaining = cards.filter((card) => card.approval && statusOf(card) !== "approved" && statusOf(card) !== "rejected");
  return [
    { kind: "item", label: "Review assets", icon: <PanelRightOpen size={14} />, onSelect: onOpen },
    { kind: "separator" },
    {
      kind: "item",
      label: remaining.length > 0 ? `Approve remaining (${remaining.length})` : "Approve remaining",
      icon: <Check size={14} />,
      disabled: remaining.length === 0,
      hint: remaining.length === 0 ? "All decided" : undefined,
      onSelect: async () => {
        let approved = 0;
        let preview = false;
        for (const card of remaining) {
          const outcome = await decideAssetViaMenu(card, "approved", onAssetStatus);
          if (outcome.includes("Approved") || outcome.includes("approved")) {
            approved += 1;
            preview = preview || outcome.startsWith("Preview");
          }
        }
        if (approved === 0) return "Nothing approved";
        return preview ? `Preview — ${approved} approved, not saved` : `${approved} approved`;
      },
    },
  ];
}

function ReviewableWork({ children }: { children: ReactNode }) {
  return (
    <section className="arc-response-output" aria-label="Reviewable work">
      {/* The right-hand label used to read "Ready for review" while the pill on
          the card inside said "Needs review" — one card, two states, saying
          opposite things (BSR-656). Both are the queue label now. */}
      <div className="arc-response-output-label">
        <span><ClipboardCheck size={13} />Created by Arc</span>
        <b>{WORK_STATE_LABEL.needs_you}</b>
      </div>
      {children}
    </section>
  );
}

function AssetStatusUpdate({
  cards,
  statuses,
}: {
  cards: ArcActionCard[];
  statuses: Record<string, ArcAssetStatus>;
}) {
  const decided = cards.flatMap((card) => {
    const assetId = card.approval?.assetId;
    const current = (assetId ? statuses[assetId] : undefined) ?? card.status ?? null;
    return current === "approved" || current === "rejected" ? [{ card, current }] : [];
  });
  if (decided.length === 0) return null;

  const label = decided.length === 1
    ? `${decided[0]!.card.title} · ${assetStatusMeta(decided[0]!.current).label}`
    : `${decided.length} final decisions are reflected below`;

  return (
    <div className="arc-status-update" role="status">
      <RefreshCcw size={13} />
      <span><b>Current status</b>{label}</span>
    </div>
  );
}

/** The new-conversation "work launcher": a time-of-day greeting and tappable
 *  workflow starters that prefill the composer, so a blank chat proposes work
 *  instead of a bare prompt. */
export function ArcLauncher({ greetName, waiting, onPick }: { greetName: string; waiting?: ArcWaiting | null; onPick: (prompt: string) => void }) {
  // Neutral on the server, resolved to the local time-of-day after mount — keeps
  // SSR/client markup identical (no hydration mismatch) and greets by the reader's
  // own clock, not the server's.
  const [greeting, setGreeting] = useState("Hello");
  useEffect(() => {
    const hour = new Date().getHours();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing to the browser clock is exactly what this effect is for
    setGreeting(hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");
  }, []);

  const pick = (prompt: string) => {
    onPick(prompt);
    requestAnimationFrame(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(".arc-composer textarea");
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(prompt.length, prompt.length);
      }
    });
  };
  const recommendation = buildArcLauncherRecommendation(waiting);
  const hasWaitingStatus = Boolean(waiting && (waiting.approvals > 0 || waiting.opportunities > 0));
  const shortcuts = recommendation.mode === "review"
    ? LAUNCHER_SHORTCUTS.filter((shortcut) => shortcut.label !== "Review approvals")
    : recommendation.mode === "quiet"
      ? [...LAUNCHER_SHORTCUTS].reverse().slice(0, 3)
      : LAUNCHER_SHORTCUTS.slice(0, 3);

  return (
    <div className="arc-launcher" data-mode={recommendation.mode}>
      <h2>{greeting}, {greetName}</h2>
      <p>{recommendation.mode === "review"
        ? "Finished work is waiting on you. Clear the queue or start something focused."
        : recommendation.mode === "urgent"
          ? "There’s a time-sensitive signal worth handling before routine work."
          : "Start with the work Arc recommends, or choose a focused task below."}</p>
      {hasWaitingStatus && waiting ? (
        <div className="arc-launcher-status" aria-label="Workspace status">
          <span>Today</span>
          <div>
            {waiting.approvals > 0 ? (
              <Link href="/campaigns" className="arc-launcher-status-item is-warn">
                <ClipboardCheck size={14} />
                <b>{waiting.approvals}</b> {waiting.approvals === 1 ? "approval" : "approvals"}
              </Link>
            ) : null}
            {waiting.opportunities > 0 ? (
              <Link href="/opportunities" className="arc-launcher-status-item">
                <Zap size={14} />
                <b>{waiting.opportunities}</b> {waiting.opportunities === 1 ? "opportunity" : "opportunities"}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="arc-launcher-focus">
        <span>{recommendation.eyebrow}</span>
        {recommendation.href ? (
          <Link href={recommendation.href} title={recommendation.description}>
            <i className={`arc-nudge-dot is-${recommendation.urgency}`} aria-hidden />
            <span><b>{recommendation.title}</b><small>{recommendation.description}</small></span>
            <ArrowRight size={15} aria-hidden />
          </Link>
        ) : (
          <button type="button" onClick={() => pick(recommendation.prompt ?? recommendation.description)} title={recommendation.description}>
            <i className={`arc-nudge-dot is-${recommendation.urgency}`} aria-hidden />
            <span><b>{recommendation.title}</b><small>{recommendation.description}</small></span>
            <ArrowRight size={15} aria-hidden />
          </button>
        )}
      </div>
      <div className="arc-launcher-grid">
        {shortcuts.map((shortcut) => {
          const Icon = shortcut.icon;
          return (
            <button type="button" key={shortcut.label} onClick={() => pick(shortcut.prompt)}>
              <span className="arc-launcher-icon"><Icon size={16} /></span>
              <b>{shortcut.label}</b>
              <small>{shortcut.prompt}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LiveConversation({
  messages,
  optimisticTurn,
  operatorName,
  waiting,
  assetStatuses,
  onSuggestion,
  onReview,
  onEdit,
  onRegenerate,
  onCancelRun,
  stoppingTaskId,
  onAssetStatus,
  assetBodies,
}: {
  messages: ArcMessage[];
  optimisticTurn?: OptimisticArcTurn | null;
  operatorName: string;
  waiting?: ArcWaiting | null;
  assetStatuses: Record<string, ArcAssetStatus>;
  /** The readable copy behind each approval-gated card, keyed by asset id. Empty
   *  until the fetch lands, and empty forever without a backend — a card falls
   *  back to its own stored preview either way. */
  assetBodies: Record<string, ArcAssetBody>;
  onSuggestion: (value: string) => void;
  onReview: (cards: ArcActionCard[]) => void;
  onEdit: (messageId: string, newBody: string) => void;
  onRegenerate: (replyMessageId: string) => void;
  onCancelRun: (taskId: string, conversationId: string) => void;
  stoppingTaskId: string | null;
  onAssetStatus: (assetId: string, status: ArcAssetStatus) => void;
}) {
  const { openMenu, menuElement } = useMessageContextMenu();
  const router = useRouter();
  const navigate = (href: string) => router.push(href);
  const statusOf = (card: ArcActionCard) => assetStatuses[card.approval?.assetId ?? ""] ?? card.status ?? null;

  if (messages.length === 0 && !optimisticTurn) {
    return <ArcLauncher greetName={operatorName} waiting={waiting} onPick={onSuggestion} />;
  }

  // While a reply is in flight, hide edit/regenerate — the turn is already running.
  const awaitingReply = Boolean(optimisticTurn) || messages.some((message) => message.status === "pending" || (message.role === "arc" && !message.body.trim()));
  const lastIndex = messages.length - 1;

  const arcMenuItems = (message: ArcMessage, index: number): MessageMenuItem[] => {
    const sourcePrompt = operatorMessageBefore(messages, index);
    const items: MessageMenuItem[] = [
      { kind: "item", label: "Copy message", icon: <Copy size={14} />, onSelect: () => copyMessageText(message.body) },
      { kind: "separator" },
      { kind: "item", label: "Save to library", icon: <Bookmark size={14} />, onSelect: async () => { const result = await saveArcMessageAction(message.id); return result.ok ? "Saved to your Arc library" : result.error; } },
      { kind: "item", label: "Save to Brain", icon: <Brain size={14} />, onSelect: async () => { const result = await saveArcMessageToBrainAction(message.id); return result.ok ? "Remembered in the Brain" : result.error; } },
    ];
    if (index === lastIndex && !awaitingReply) {
      items.push({ kind: "separator" }, { kind: "item", label: "Regenerate response", icon: <RotateCcw size={14} />, onSelect: () => onRegenerate(message.id) });
    } else if (sourcePrompt) {
      items.push({ kind: "separator" }, { kind: "item", label: "Ask this again", icon: <RotateCcw size={14} />, disabled: awaitingReply, hint: awaitingReply ? "Run in progress" : undefined, onSelect: () => { onSuggestion(sourcePrompt.body); return "Added to the composer"; } });
    }
    return items;
  };

  const operatorMenuItems = (message: ArcMessage, startEdit: (() => void) | null): MessageMenuItem[] => [
    { kind: "item", label: "Copy message", icon: <Copy size={14} />, onSelect: () => copyMessageText(message.body) },
    { kind: "separator" },
    { kind: "item", label: "Edit & resend", icon: <PencilLine size={14} />, disabled: !startEdit, hint: startEdit ? undefined : "Run in progress", onSelect: () => startEdit?.() },
    { kind: "item", label: "Use as new message", icon: <CornerUpLeft size={14} />, onSelect: () => { onSuggestion(message.body); return "Added to the composer"; } },
  ];

  return (
    <>
      {messages.map((message, index) => {
        if (message.role === "operator") return <OperatorMessage key={message.id} body={message.body} timeIso={message.createdAt} attachments={message.attachments} onEdit={awaitingReply ? undefined : (newBody) => onEdit(message.id, newBody)} onContextMenu={(event, helpers) => openMenu(event, operatorMenuItems(message, helpers.startEdit))} />;
        const pending = message.status === "pending" || (message.role === "arc" && !message.body.trim());
        const operatorMessage = operatorMessageBefore(messages, index);
        // Runner-measured wall-clock. Message rows are inserted before the run,
        // so subtracting their created_at values reported 0s for real work.
        const thoughtSeconds = !pending && message.runDurationMs != null ? message.runDurationMs / 1000 : undefined;
        const recordedDraftCount = message.actions.filter((action) => action.kind === "draft").length;
        const contract = buildArcRunContract({
          mode: operatorMessage?.mode,
          route: operatorMessage?.route,
          contextScopes: operatorMessage?.contextScopes,
          actionCount: message.actions.length,
          workspaceChangeCount: recordedDraftCount,
          toolCount: message.toolCalls?.length ?? 0,
          agentTaskId: message.agentTaskId,
        });
        const outcomeView = buildArcOutcomeView({
          request: operatorMessage?.body,
          response: message.body,
          mode: operatorMessage?.mode,
          command: operatorMessage?.command,
          sourceCount: message.mentions.length,
          recallCount: message.recall?.length ?? 0,
          actions: message.actions,
        });
        const failed = message.status === "failed";
        return (
          <AssistantMessage key={message.id} timeIso={message.createdAt} active={pending} onContextMenu={pending ? undefined : (event) => openMenu(event, arcMenuItems(message, index))}>
            <RunTrace pending={pending} responding={pending && Boolean(message.body.trim())} reasoning={message.reasoning} steps={message.steps} toolCalls={message.toolCalls} contract={contract} thoughtSeconds={thoughtSeconds} startedAtIso={message.createdAt} answerText={message.body} onStop={pending && message.agentTaskId ? () => onCancelRun(message.agentTaskId as string, message.conversationId) : undefined} stopping={stoppingTaskId === message.agentTaskId} outcome={message.status === "failed" ? (message.body.startsWith("Stopped by you") ? "canceled" : "failed") : "complete"} />
            {/* One container across the whole lifecycle: `message.body` is the
                partial reply while pending and the final reply once settled, so
                completion patches this node instead of replacing it. */}
            <ArcAnswer text={message.body} streaming={pending} />
            {!pending ? (
              <ResponseMeta
                outcome={failed ? null : outcomeView}
                mentions={message.mentions}
                recall={message.recall ?? []}
                onMentionContextMenu={(event, mention) => openMenu(event, mentionMenuItems(mention, navigate))}
                onRecallContextMenu={(event, item) => openMenu(event, recallMenuItems(item, navigate))}
              />
            ) : null}
            {!pending && message.actions.length ? (() => {
              const approvalCards = message.actions.filter((card) => card.approval);
              const otherCards = message.actions.filter((card) => !card.approval);
              return (
                <>
                  {otherCards.length ? <div className="arc-action-list">{otherCards.map((card, index) => <ArcDraftCard card={card} key={`${card.title}-${index}`} />)}</div> : null}
                  {approvalCards.length ? (
                    <ReviewableWork>
                      <AssetStatusUpdate cards={approvalCards} statuses={assetStatuses} />
                      {/* Every drafted deliverable renders here, in the thread.
                          A package gets a count + a way into the full-pane read
                          above the stack; it used to get a channel strip instead
                          of the copy, which is the thing being fixed. */}
                      {approvalCards.length >= 2 ? (
                        <DeliverablePackageHead
                          cards={approvalCards}
                          statuses={assetStatuses}
                          onReviewAll={() => onReview(approvalCards)}
                          onContextMenu={(event) => openMenu(event, packageMenuItems({ cards: approvalCards, statusOf, onOpen: () => onReview(approvalCards), onAssetStatus }))}
                        />
                      ) : null}
                      {approvalCards.map((card, cardIndex) => (
                        <InlineDeliverable
                          key={`${card.approval?.assetId ?? card.title}-${cardIndex}`}
                          card={card}
                          status={statusOf(card)}
                          bodies={assetBodies}
                          onStatus={onAssetStatus}
                          onOpen={() => onReview([card])}
                          onContextMenu={(event) => openMenu(event, receiptMenuItems({ card, status: statusOf(card), onOpen: () => onReview([card]), onAssetStatus }))}
                        />
                      ))}
                    </ReviewableWork>
                  ) : null}
                </>
              );
            })() : null}
            {!pending && message.suggestions.length ? <div className="arc-suggestions">{message.suggestions.map((suggestion, index) => <button type="button" key={`${suggestion}-${index}`} onClick={() => onSuggestion(suggestion)}>{suggestion}</button>)}</div> : null}
            {!pending ? <MessageActions message={message} onRegenerate={!awaitingReply && index === lastIndex ? () => onRegenerate(message.id) : undefined} /> : null}
          </AssistantMessage>
        );
      })}
      {optimisticTurn ? (
        <>
          <OperatorMessage body={optimisticTurn.body} />
          <AssistantMessage active>
            <RunTrace
              pending
              contract={buildArcRunContract({
                mode: optimisticTurn.mode,
                route: optimisticTurn.route,
                contextScopes: optimisticTurn.contextScopes,
              })}
            />
          </AssistantMessage>
        </>
      ) : null}
      {menuElement}
    </>
  );
}

export function DemoConversation({
  turns,
  pending,
  includeSeed,
  packageStatuses,
  assetBodies,
  pendingContract,
  onReview,
  onEditResend,
  onStop,
  onAssetStatus,
}: {
  turns: DemoTurn[];
  pending: boolean;
  includeSeed: boolean;
  packageStatuses: Record<string, ArcAssetStatus>;
  assetBodies: Record<string, ArcAssetBody>;
  pendingContract: ArcRunContract;
  onReview: (cards: ArcActionCard[]) => void;
  onEditResend: (body: string) => void;
  onStop: () => void;
  onAssetStatus: (assetId: string, status: ArcAssetStatus) => void;
}) {
  const pendingTurn = [...turns].reverse().find((turn) => turn.role === "operator");
  const demoLiveWork = buildDemoLiveWork(pendingTurn?.body);
  const editable = pending ? undefined : onEditResend;
  const { openMenu, menuElement } = useMessageContextMenu();
  const router = useRouter();
  const navigate = (href: string) => router.push(href);
  const statusOf = (card: ArcActionCard) => packageStatuses[card.approval?.assetId ?? ""] ?? card.status ?? null;

  // Same menu as the live conversation, with backend-writing items visibly
  // disabled instead of silently absent — the preview should show the feature.
  const demoArcItems = (body: string, sourcePrompt?: string): MessageMenuItem[] => {
    const items: MessageMenuItem[] = [
      { kind: "item", label: "Copy message", icon: <Copy size={14} />, onSelect: () => copyMessageText(body) },
      { kind: "separator" },
      { kind: "item", label: "Save to library", icon: <Bookmark size={14} />, disabled: true, hint: "Preview only", onSelect: () => null },
      { kind: "item", label: "Save to Brain", icon: <Brain size={14} />, disabled: true, hint: "Preview only", onSelect: () => null },
    ];
    if (sourcePrompt) {
      items.push({ kind: "separator" }, { kind: "item", label: "Ask this again", icon: <RotateCcw size={14} />, disabled: pending, hint: pending ? "Run in progress" : undefined, onSelect: () => onEditResend(sourcePrompt) });
    }
    return items;
  };
  const demoOperatorItems = (body: string, startEdit: (() => void) | null): MessageMenuItem[] => [
    { kind: "item", label: "Copy message", icon: <Copy size={14} />, onSelect: () => copyMessageText(body) },
    { kind: "separator" },
    { kind: "item", label: "Edit & resend", icon: <PencilLine size={14} />, disabled: !startEdit, hint: startEdit ? undefined : "Run in progress", onSelect: () => startEdit?.() },
    { kind: "item", label: "Resend", icon: <CornerUpLeft size={14} />, disabled: pending, hint: pending ? "Run in progress" : undefined, onSelect: () => onEditResend(body) },
  ];
  const operatorMenu = (body: string) => (event: React.MouseEvent, helpers: { startEdit: (() => void) | null }) =>
    openMenu(event, demoOperatorItems(body, helpers.startEdit));

  return (
    <>
      {includeSeed ? (
        <>
          <div className="arc-day"><span>July 14, 2026</span></div>
          <OperatorMessage time="9:34 AM" body="Here’s a reference shot from our last product tour — match this look in the creative." attachments={DEMO_ATTACHMENTS} onEdit={editable} onContextMenu={operatorMenu("Here’s a reference shot from our last product tour — match this look in the creative.")} />
          <OperatorMessage time="9:35 AM" body="Which accounts should we reach first after the pricing-page surge?" onEdit={editable} onContextMenu={operatorMenu("Which accounts should we reach first after the pricing-page surge?")} />
          <AssistantMessage time="9:38 AM" onContextMenu={(event) => openMenu(event, demoArcItems("142 accounts hit pricing repeatedly and still haven’t booked a demo.", "Which accounts should we reach first after the pricing-page surge?"))}>
            <div className="arc-answer">
              <h2>142 accounts hit pricing repeatedly and still haven’t booked a demo.</h2>
              <p>That’s 23% of the active pipeline and about $1.4M in estimated ARR. The clearest urgency signals across them:</p>
              <ul><li>Sit in the <b>highest-intent tier</b>, with no demo on file — <b>3.1× more likely</b> to convert this quarter</li><li>No demo booked in the six days since the surge</li><li>Trial expiring within 14 days or prior evaluation history</li></ul>
            </div>
            <RunTrace pending={false} thoughtSeconds={8} reasoning="I combined the pricing-intent signal with account health and recent CRM activity, then favored a demo-first message because it performed better than discount-led outreach." steps={DEMO_STEPS} toolCalls={DEMO_TOOLS} contract={buildArcRunContract({ mode: "act", route: "standard", contextScopes: ["workspace", "crm", "campaigns"], toolCount: DEMO_TOOLS.length, agentTaskId: "DEMO-142-HOMES" })} />
            <div className="arc-response-evidence">
              <SourcesRow mentions={DEMO_SOURCES} onMentionContextMenu={(event, mention) => openMenu(event, mentionMenuItems(mention, navigate))} />
              <RecallRow recall={DEMO_RECALL} onRecallContextMenu={(event, item) => openMenu(event, recallMenuItems(item, navigate))} />
            </div>
          </AssistantMessage>
          <AssistantMessage time="9:40 AM" onContextMenu={(event) => openMenu(event, demoArcItems(DEMO_BREAKDOWN_MD))}>
            <div className="arc-markdown"><ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_HIGHLIGHT_PLUGINS} components={MARKDOWN_COMPONENTS}>{DEMO_BREAKDOWN_MD}</ReactMarkdown></div>
          </AssistantMessage>
          <AssistantMessage time="9:42 AM" onContextMenu={(event) => openMenu(event, demoArcItems("I built the Pricing-Intent Fast Track package for the 142 highest-urgency accounts."))}>
            <div className="arc-answer"><p>I built the Pricing-Intent Fast Track package for the 142 highest-urgency accounts.</p></div>
            <ReviewableWork>
              <DeliverablePackageHead cards={DEMO_PACKAGE_CARDS} statuses={packageStatuses} onReviewAll={() => onReview(DEMO_PACKAGE_CARDS)} onContextMenu={(event) => openMenu(event, packageMenuItems({ cards: DEMO_PACKAGE_CARDS, statusOf, onOpen: () => onReview(DEMO_PACKAGE_CARDS), onAssetStatus }))} />
              {DEMO_PACKAGE_CARDS.map((card, cardIndex) => (
                <InlineDeliverable key={`${card.approval?.assetId ?? card.title}-${cardIndex}`} card={card} status={statusOf(card)} bodies={assetBodies} onStatus={onAssetStatus} onOpen={() => onReview([card])} onContextMenu={(event) => openMenu(event, receiptMenuItems({ card, status: statusOf(card), onOpen: () => onReview([card]), onAssetStatus }))} />
              ))}
            </ReviewableWork>
          </AssistantMessage>
          <OperatorMessage time="9:44 AM" body="Looks good. Draft the email." onEdit={editable} onContextMenu={operatorMenu("Looks good. Draft the email.")} />
          <AssistantMessage time="9:45 AM" onContextMenu={(event) => openMenu(event, demoArcItems("The demo email for the 64 active-trial, high-intent accounts is ready for review."))}>
            <div className="arc-answer"><p>The demo email for the 64 active-trial, high-intent accounts is ready for review.</p></div>
            <ReviewableWork><InlineDeliverable card={DEMO_DRAFT_CARD} status={statusOf(DEMO_DRAFT_CARD)} bodies={assetBodies} onStatus={onAssetStatus} onOpen={() => onReview([DEMO_DRAFT_CARD])} onContextMenu={(event) => openMenu(event, receiptMenuItems({ card: DEMO_DRAFT_CARD, status: statusOf(DEMO_DRAFT_CARD), onOpen: () => onReview([DEMO_DRAFT_CARD]), onAssetStatus }))} /></ReviewableWork>
          </AssistantMessage>
        </>
      ) : null}
      {turns.map((turn, index) => {
        if (turn.role === "operator") return <OperatorMessage key={turn.id} body={turn.body} onEdit={editable} onContextMenu={operatorMenu(turn.body)} />;
        const operatorTurn = [...turns.slice(0, index)].reverse().find((candidate) => candidate.role === "operator");
        const turnContract = buildArcRunContract({ mode: turn.mode, route: "fast", contextScopes: ["workspace", "brand", "crm", "campaigns"], agentTaskId: turn.id });
        const turnProfile = buildArcRunProfile({ request: operatorTurn?.body, mode: turn.mode, command: turn.command, sources: turnContract.readScopes });
        const outcomeView = buildArcOutcomeView({
          request: operatorTurn?.body,
          response: turn.body,
          mode: turn.mode,
          command: turn.command,
        });
        const completedSteps: ArcStep[] = turn.outcome === "canceled"
          ? [{ label: "Stopped before remaining work was applied", status: "done", at: "now", kind: "think" }]
          : turnProfile.phases.map((phase) => ({ label: phase.label, detail: [phase.detail], status: "done", at: "now", kind: phase.kind }));
        return (
          <AssistantMessage key={turn.id} time="now" onContextMenu={(event) => openMenu(event, demoArcItems(turn.body, operatorTurn?.body))}>
            <RunTrace
              pending={false}
              thoughtSeconds={turn.outcome === "canceled" ? undefined : 5}
              outcome={turn.outcome ?? "complete"}
              reasoning={turn.outcome === "canceled" ? "The run ended at your request. Completed work remains visible, and no external action was taken." : turnProfile.completedSummary}
              steps={completedSteps}
              contract={turnContract}
            />
            <ArcAnswer text={turn.body} streaming={false} />
            {turn.outcome === "canceled" ? null : <ResponseMeta outcome={outcomeView} mentions={[]} recall={[]} />}
          </AssistantMessage>
        );
      })}
      {pending ? <AssistantMessage active><RunTrace pending reasoning={demoLiveWork.commentary} demoRows={demoLiveWork.rows} contract={pendingContract} onStop={onStop} /></AssistantMessage> : null}
      {menuElement}
    </>
  );
}


/** One conversation row with an inline options menu (pin / rename / archive /
 *  delete). The row itself opens the conversation; the ⋯ button reveals the menu. */

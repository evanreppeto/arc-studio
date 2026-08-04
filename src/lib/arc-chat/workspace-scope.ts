import type { ArcActionCard, ArcAssetStatus } from "@/domain";

import type { ArcMessage } from "./persistence";

export type ArcWorkspaceScope = "latest" | "conversation";

export function selectArcWorkspaceMessages(
  messages: ArcMessage[],
  scope: ArcWorkspaceScope,
) {
  const arcMessages = messages.filter((message) => message.role === "arc");
  return scope === "conversation" ? arcMessages : arcMessages.slice(-1);
}

function cardKey(card: ArcActionCard) {
  return card.approval?.assetId
    || [card.kind, card.channel, card.title].filter(Boolean).join(":").toLocaleLowerCase();
}

/** Collect the workspace's deliverables without repeating the same approval
 * asset across runs. When an asset appears again, its newest representation
 * wins and moves to the end of the conversation timeline. */
export function collectArcWorkspaceCards(
  messages: ArcMessage[],
  scope: ArcWorkspaceScope,
  fallback: ArcActionCard[] = [],
) {
  const selected = selectArcWorkspaceMessages(messages, scope);
  if (selected.length === 0) return fallback;

  const cards = new Map<string, ArcActionCard>();
  for (const message of selected) {
    for (const card of message.actions) {
      const key = cardKey(card);
      cards.delete(key);
      cards.set(key, card);
    }
  }
  return [...cards.values()];
}

/** An asset the operator has already ruled on, either way — it is no longer
 *  waiting on them, so the workspace stops counting it as work to do. */
export function isDecidedAssetStatus(status: ArcAssetStatus | null) {
  return status === "approved" || status === "rejected";
}

export type ArcWorkspacePartition = {
  /** Cards a human has to rule on, undecided first. */
  deliverables: ArcActionCard[];
  /** Cards with nothing to decide — records Arc read, views it linked to. */
  findings: ArcActionCard[];
  /** The subset of `deliverables` still waiting on a decision. */
  awaiting: ArcActionCard[];
  approvedCount: number;
};

/**
 * Split what Arc put on cards into the two things they actually are.
 *
 * Arc is instructed to emit a `result` card whenever it presents records it
 * found, and prod is full of them — "5 CRM contacts (live read, Aug 3)" listed
 * beside four drafts. The panel treated every card as a deliverable, and a card
 * with no approval hook falls through `assetStatusMeta` to the review label, so
 * a read-only lookup was stamped "Needs you", offered no control that could
 * clear it, and was counted in the approval progress: three drafts next to two
 * lookups read "2 of 5 approved" no matter what the operator did.
 *
 * Undecided deliverables sort first. This is a decision surface, so what is
 * waiting belongs at the top of it, and approving something visibly retires it.
 */
export function partitionArcWorkspaceCards(
  cards: ArcActionCard[],
  statuses: Record<string, ArcAssetStatus> = {},
): ArcWorkspacePartition {
  const statusOf = (card: ArcActionCard) => statuses[card.approval?.assetId ?? ""] ?? card.status ?? null;
  const approvable = cards.filter((card) => card.approval);
  const awaiting = approvable.filter((card) => !isDecidedAssetStatus(statusOf(card)));
  return {
    deliverables: [...awaiting, ...approvable.filter((card) => isDecidedAssetStatus(statusOf(card)))],
    findings: cards.filter((card) => !card.approval),
    awaiting,
    approvedCount: approvable.filter((card) => statusOf(card) === "approved").length,
  };
}

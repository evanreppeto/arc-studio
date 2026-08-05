import type { ArcMessage } from "./persistence";

/**
 * Is this reply still being worked on?
 *
 * An arc row counts as in-flight while it is `pending`, and also while it is a
 * settled row with no body yet (the runner inserts the row before it writes a
 * word). A run the read model has marked `stalled` is explicitly NOT in flight:
 * it satisfies both of those shapes and would otherwise spin forever, which is
 * the whole bug. Keeping the rule in one function means the composer lock, the
 * SSE subscription, and the message renderer can never disagree about it.
 */
export function isArcReplyInFlight(message: ArcMessage): boolean {
  if (message.stalled) return false;
  return message.status === "pending" || (message.role === "arc" && !message.body.trim());
}

/** Any reply in this conversation still working. */
export function hasArcReplyInFlight(messages: ArcMessage[]): boolean {
  return messages.some(isArcReplyInFlight);
}

export function shouldShowDemoLauncher({
  selectedDemoId,
  turnCount,
  pending,
}: {
  selectedDemoId: string;
  turnCount: number;
  pending: boolean;
}) {
  return selectedDemoId === "new" && turnCount === 0 && !pending;
}

export function shouldUseDemoSeedWorkspace({
  live,
  selectedDemoId,
  turnCount,
}: {
  live: boolean;
  selectedDemoId: string;
  turnCount: number;
}) {
  return !live && selectedDemoId !== "new" && turnCount === 0;
}

export function getArcConversationScrollTarget({
  live,
  activeConversationId,
  selectedDemoId,
}: {
  live: boolean;
  activeConversationId: string | null;
  selectedDemoId: string;
}): "start" | "end" {
  return (live && !activeConversationId) || (!live && selectedDemoId === "new")
    ? "start"
    : "end";
}

export function getArcConversationHeader({
  live,
  activeTitle,
  selectedDemoId,
  selectedDemoTitle,
}: {
  live: boolean;
  activeTitle?: string;
  selectedDemoId: string;
  selectedDemoTitle?: string;
}) {
  if (live) {
    return {
      title: activeTitle ?? "New conversation",
      subtitle: "Private conversation",
    };
  }

  if (selectedDemoId === "new") {
    return {
      title: "New conversation",
      subtitle: "Full workspace memory is on",
    };
  }

  if (selectedDemoId === "storm") {
    return {
      title: "Pricing-Intent Fast Track",
      subtitle: "High-intent accounts · 4 assets · Team & Business plans",
    };
  }

  return {
    title: selectedDemoTitle ?? "Conversation",
    subtitle: "Private conversation",
  };
}

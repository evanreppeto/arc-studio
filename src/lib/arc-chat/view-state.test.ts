import { describe, expect, it } from "vitest";

import type { ArcMessage } from "./persistence";
import {
  getArcConversationHeader,
  getArcConversationScrollTarget,
  hasArcReplyInFlight,
  isArcReplyInFlight,
  shouldShowDemoLauncher,
  shouldUseDemoSeedWorkspace,
} from "./view-state";

function reply(overrides: Partial<ArcMessage> = {}): ArcMessage {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    role: "arc",
    body: "",
    status: "pending",
    agentTaskId: "task-1",
    mentions: [],
    media: [],
    steps: [],
    feedback: null,
    actions: [],
    suggestions: [],
    attachments: [],
    createdAt: "2026-08-05T12:00:00.000Z",
    ...overrides,
  };
}

describe("isArcReplyInFlight", () => {
  it("counts a pending reply as working", () => {
    expect(isArcReplyInFlight(reply())).toBe(true);
  });

  it("counts a bodyless arc row as working — the runner inserts before it writes", () => {
    expect(isArcReplyInFlight(reply({ status: "complete", body: "   " }))).toBe(true);
  });

  it("counts a finished reply as done", () => {
    expect(isArcReplyInFlight(reply({ status: "complete", body: "Here you go." }))).toBe(false);
  });

  /**
   * The whole point of the stalled flag. A stranded run matches BOTH in-flight
   * shapes above — still `pending`, still bodyless — so without this it spins
   * forever and keeps the composer locked behind it.
   */
  it("counts a stalled run as done, even though it is still pending and bodyless", () => {
    expect(isArcReplyInFlight(reply({ stalled: true }))).toBe(false);
    expect(hasArcReplyInFlight([reply({ stalled: true })])).toBe(false);
  });

  it("still reports work when one reply stalled and another is live", () => {
    expect(hasArcReplyInFlight([reply({ stalled: true }), reply({ id: "message-2" })])).toBe(true);
  });
});

describe("shouldShowDemoLauncher", () => {
  it("shows the launcher for an untouched new demo conversation", () => {
    expect(shouldShowDemoLauncher({ selectedDemoId: "new", turnCount: 0, pending: false })).toBe(true);
  });

  it("switches to the conversation as soon as the first turn starts", () => {
    expect(shouldShowDemoLauncher({ selectedDemoId: "new", turnCount: 1, pending: true })).toBe(false);
  });

  it("does not replace an existing demo conversation with the launcher", () => {
    expect(shouldShowDemoLauncher({ selectedDemoId: "storm", turnCount: 0, pending: false })).toBe(false);
  });
});

describe("shouldUseDemoSeedWorkspace", () => {
  it("uses the historical workspace before a new turn starts", () => {
    expect(shouldUseDemoSeedWorkspace({ live: false, selectedDemoId: "storm", turnCount: 0 })).toBe(true);
  });

  it("switches the workspace to the current run after the operator sends a message", () => {
    expect(shouldUseDemoSeedWorkspace({ live: false, selectedDemoId: "storm", turnCount: 1 })).toBe(false);
  });

  it("never inserts seeded campaign context into a blank conversation", () => {
    expect(shouldUseDemoSeedWorkspace({ live: false, selectedDemoId: "new", turnCount: 0 })).toBe(false);
  });
});

describe("getArcConversationScrollTarget", () => {
  it("starts a live blank conversation at the top of its launcher", () => {
    expect(getArcConversationScrollTarget({ live: true, activeConversationId: null, selectedDemoId: "storm" })).toBe("start");
  });

  it("keeps established live conversations pinned to their latest turn", () => {
    expect(getArcConversationScrollTarget({ live: true, activeConversationId: "conversation-1", selectedDemoId: "storm" })).toBe("end");
  });

  it("starts the demo launcher at the top", () => {
    expect(getArcConversationScrollTarget({ live: false, activeConversationId: null, selectedDemoId: "new" })).toBe("start");
  });
});

describe("getArcConversationHeader", () => {
  it("removes stale campaign metadata from a new demo conversation", () => {
    expect(getArcConversationHeader({ live: false, selectedDemoId: "new" })).toEqual({
      title: "New conversation",
      subtitle: "Full workspace memory is on",
    });
  });

  it("keeps the campaign-specific metadata on the seeded demo conversation", () => {
    expect(getArcConversationHeader({ live: false, selectedDemoId: "storm" })).toEqual({
      title: "Pricing-Intent Fast Track",
      subtitle: "High-intent accounts · 4 assets · Team & Business plans",
    });
  });

  it("uses the active server title for live conversations", () => {
    expect(getArcConversationHeader({ live: true, activeTitle: "Inspection follow-up", selectedDemoId: "storm" })).toEqual({
      title: "Inspection follow-up",
      subtitle: "Private conversation",
    });
  });
});

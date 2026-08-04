import { describe, expect, it } from "vitest";

import type { ArcActionCard } from "@/domain";
import type { ArcMessage } from "./persistence";

import {
  collectArcWorkspaceCards,
  partitionArcWorkspaceCards,
  selectArcWorkspaceMessages,
} from "./workspace-scope";

function message(
  id: string,
  role: ArcMessage["role"],
  actions: ArcActionCard[] = [],
): ArcMessage {
  return {
    id,
    conversationId: "conversation-1",
    role,
    body: "",
    mode: "act",
    status: "complete",
    agentTaskId: null,
    reasoning: null,
    mentions: [],
    media: [],
    recall: [],
    steps: [],
    toolCalls: [],
    feedback: null,
    suggestions: [],
    actions,
    attachments: [],
    questions: [],
    contextScopes: [],
    route: "standard",
    command: null,
    runDurationMs: null,
    createdAt: "2026-07-23T12:00:00.000Z",
  };
}

const firstDraft: ArcActionCard = {
  kind: "draft",
  title: "Storm email",
  channel: "Email",
  rows: [],
  flags: [],
  approval: { kind: "campaign", campaignId: "campaign-1", assetId: "asset-1" },
};
const revisedDraft: ArcActionCard = {
  ...firstDraft,
  title: "Storm email revision",
  status: "revision",
};
const smsDraft: ArcActionCard = {
  kind: "draft",
  title: "Storm text",
  channel: "SMS",
  rows: [],
  flags: [],
};

const messages = [
  message("operator-1", "operator"),
  message("arc-1", "arc", [firstDraft]),
  message("operator-2", "operator"),
  message("arc-2", "arc", [revisedDraft, smsDraft]),
];

describe("Arc workspace scope", () => {
  it("selects the latest Arc run without operator messages", () => {
    expect(selectArcWorkspaceMessages(messages, "latest").map((item) => item.id)).toEqual(["arc-2"]);
  });

  it("selects the full Arc run history for conversation scope", () => {
    expect(selectArcWorkspaceMessages(messages, "conversation").map((item) => item.id)).toEqual(["arc-1", "arc-2"]);
  });

  it("deduplicates approval assets and keeps the newest representation", () => {
    expect(collectArcWorkspaceCards(messages, "conversation")).toEqual([revisedDraft, smsDraft]);
  });
});

/** The card shape Arc emits for records it merely READ — prod's "5 CRM contacts
 *  (live read, Aug 3)". No approval block, so nothing can decide it. */
const lookup: ArcActionCard = {
  kind: "result",
  title: "5 CRM contacts (live read)",
  rows: [],
  flags: [],
  href: "/crm/contacts",
};

describe("splitting workspace cards into decisions and context", () => {
  it("never counts a card nobody can approve as a deliverable", () => {
    // The panel stamped these "Needs you" — a card with no approval hook falls
    // through to the review label — while offering no control that could clear
    // it. Reintroduce the bug by dropping the `card.approval` filter and this
    // fails on both the count and the findings list.
    const result = partitionArcWorkspaceCards([firstDraft, lookup, smsDraft]);
    expect(result.deliverables).toEqual([firstDraft]);
    expect(result.findings).toEqual([lookup, smsDraft]);
    expect(result.awaiting).toEqual([firstDraft]);
  });

  it("counts approval progress over what can be approved, not over every card", () => {
    // Three cards, one approvable and approved: "1 of 1", never "1 of 3".
    const approved = { ...firstDraft, status: "approved" as const };
    const result = partitionArcWorkspaceCards([approved, lookup, smsDraft]);
    expect(result.approvedCount).toBe(1);
    expect(result.deliverables).toHaveLength(1);
    expect(result.awaiting).toEqual([]);
  });

  it("puts what is still waiting above what has been settled", () => {
    const approvedFirst = { ...firstDraft, status: "approved" as const };
    const waiting: ArcActionCard = {
      ...firstDraft,
      title: "Storm landing page",
      approval: { kind: "campaign", campaignId: "campaign-1", assetId: "asset-2" },
    };
    const result = partitionArcWorkspaceCards([approvedFirst, waiting]);
    expect(result.deliverables.map((card) => card.title)).toEqual(["Storm landing page", "Storm email"]);
  });

  it("reads a live decision from the statuses map, not the card's draft-time snapshot", () => {
    // The operator approves in the panel; the card object still says "draft".
    const result = partitionArcWorkspaceCards([firstDraft], { "asset-1": "approved" });
    expect(result.approvedCount).toBe(1);
    expect(result.awaiting).toEqual([]);
  });
});

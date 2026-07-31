import { describe, expect, it } from "vitest";

import type { ArcActionCard } from "@/domain";
import type { ArcMessage } from "./persistence";

import {
  buildArcWorkspaceEvidence,
  buildArcWorkspaceRuns,
  formatRunDuration,
} from "./workspace-digest";

function message(id: string, role: ArcMessage["role"], overrides: Partial<ArcMessage> = {}): ArcMessage {
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
    actions: [],
    attachments: [],
    questions: [],
    contextScopes: [],
    route: "standard",
    command: null,
    runDurationMs: null,
    createdAt: "2026-07-30T12:00:00.000Z",
    ...overrides,
  };
}

describe("buildArcWorkspaceRuns", () => {
  it("pairs each run with the request that opened it", () => {
    const runs = buildArcWorkspaceRuns([
      message("m1", "operator", { body: "  Draft the storm follow-up\n for Tuesday " }),
      message("m2", "arc"),
      message("m3", "operator", { body: "Now the SMS" }),
      message("m4", "arc"),
    ]);

    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ index: 1, request: "Draft the storm follow-up for Tuesday" });
    expect(runs[1]).toMatchObject({ index: 2, request: "Now the SMS" });
  });

  it("trims a long request to one line", () => {
    const runs = buildArcWorkspaceRuns([
      message("m1", "operator", { body: "x".repeat(200) }),
      message("m2", "arc"),
    ]);

    expect(runs[0]!.request.length).toBeLessThanOrEqual(96);
    expect(runs[0]!.request.endsWith("…")).toBe(true);
  });

  it("counts steps and tools, and carries the measured duration", () => {
    const runs = buildArcWorkspaceRuns([
      message("m1", "operator", { body: "Go" }),
      message("m2", "arc", {
        runDurationMs: 38_400,
        steps: [
          { label: "Reading CRM", status: "done", at: "", detail: ["142 records"] },
          { label: "Drafting", status: "done", at: "" },
        ],
        toolCalls: [{ name: "crm_lookup", status: "complete", output: "142 rows" }],
      }),
    ]);

    expect(runs[0]).toMatchObject({ stepCount: 2, toolCount: 1, durationMs: 38_400, state: "complete" });
    expect(runs[0]!.rows).toHaveLength(3);
    expect(runs[0]!.rows[2]).toMatchObject({ label: "Crm Lookup", kind: "search", status: "done" });
  });

  it("settles rows a finished run left running, but never a failed tool", () => {
    const runs = buildArcWorkspaceRuns([
      message("m1", "operator", { body: "Go" }),
      message("m2", "arc", {
        status: "complete",
        steps: [{ label: "Stalled step", status: "running", at: "" }],
        toolCalls: [{ name: "weather_lookup", status: "error", output: "timeout" }],
      }),
    ]);

    expect(runs[0]!.rows[0]!.status).toBe("done");
    expect(runs[0]!.rows[1]!.status).toBe("error");
    expect(runs[0]!.state).toBe("failed");
  });

  it("reports a pending run as working", () => {
    const runs = buildArcWorkspaceRuns([
      message("m1", "operator", { body: "Go" }),
      message("m2", "arc", { status: "pending", steps: [{ label: "Reading", status: "running", at: "" }] }),
    ]);

    expect(runs[0]!.state).toBe("working");
    expect(runs[0]!.rows[0]!.status).toBe("running");
  });

  it("labels a run with no preceding request rather than dropping it", () => {
    const runs = buildArcWorkspaceRuns([message("m1", "arc")]);

    expect(runs).toHaveLength(1);
    expect(runs[0]!.request).toBe("Untitled request");
  });
});

describe("buildArcWorkspaceEvidence", () => {
  const card: ArcActionCard = {
    kind: "draft",
    title: "Storm email",
    channel: "Email",
    rows: [
      { name: "Audience", meta: "142 storm-zone homes" },
      { name: "Subject", meta: "We can be out tomorrow" },
    ],
    flags: [],
  };

  it("groups records, memory, audience, context and tools", () => {
    const groups = buildArcWorkspaceEvidence([
      message("m1", "operator", {
        mentions: [{ type: "campaign", id: "c1", label: "Spring storm push", href: "/campaigns/c1" }],
        contextScopes: ["crm", "brand"],
      }),
      message("m2", "arc", {
        recall: [{ label: "Owner prefers plain-text email", confidence: 0.82 }],
        toolCalls: [
          { name: "crm_lookup", status: "complete" },
          { name: "crm_lookup", status: "complete" },
        ],
      }),
    ], [card]);

    expect(groups.map((group) => group.id)).toEqual(["records", "memory", "audience", "scopes", "tools"]);
    expect(groups[1]!.items[0]).toMatchObject({ label: "Owner prefers plain-text email", detail: "82% match" });
    expect(groups[2]!.items[0]).toMatchObject({ label: "142 storm-zone homes", detail: "Email" });
    expect(groups[3]!.items.map((item) => item.label)).toEqual(["CRM records", "Brand kit"]);
    expect(groups[4]!.items[0]).toMatchObject({ label: "Crm Lookup", detail: "2 calls" });
  });

  it("omits groups with nothing in them", () => {
    expect(buildArcWorkspaceEvidence([message("m1", "arc")], [])).toEqual([]);
  });

  it("does not repeat the same record across runs", () => {
    const mention = { type: "campaign" as const, id: "c1", label: "Spring storm push", href: "/campaigns/c1" };
    const groups = buildArcWorkspaceEvidence([
      message("m1", "operator", { mentions: [mention] }),
      message("m2", "operator", { mentions: [mention] }),
    ], []);

    expect(groups[0]!.items).toHaveLength(1);
  });
});

describe("formatRunDuration", () => {
  it("formats seconds and minutes, and refuses a duration it does not have", () => {
    expect(formatRunDuration(38_400)).toBe("38s");
    expect(formatRunDuration(124_000)).toBe("2m 04s");
    expect(formatRunDuration(null)).toBeNull();
    expect(formatRunDuration(0)).toBeNull();
  });
});

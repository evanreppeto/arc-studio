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
    // "CRM lookup", not the "Crm Lookup" this asserted before. Two spellings of
    // the same tool used to reach this file — the run rows title-cased and read
    // "Crm", the evidence rows sentence-cased and read "CRM" — so the panel
    // disagreed with itself about the same call. One mapper now (BSR-709).
    expect(runs[0]!.rows[2]).toMatchObject({ label: "CRM lookup", kind: "search", status: "done" });
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

  it("groups records, memory, audience and tools", () => {
    const groups = buildArcWorkspaceEvidence([
      message("m1", "operator", {
        mentions: [{ type: "campaign", id: "c1", label: "Spring storm push", href: "/campaigns/c1" }],
        contextScopes: ["crm", "brand"],
      }),
      message("m2", "arc", {
        recall: [{ label: "email_pref", summary: "Owner prefers plain-text email" }],
        toolCalls: [
          { name: "crm_lookup", status: "complete" },
          { name: "crm_lookup", status: "complete" },
        ],
      }),
    ], [card]);

    expect(groups.map((group) => group.id)).toEqual(["records", "memory", "audience", "tools"]);
    expect(groups[1]!.items[0]).toMatchObject({ label: "Owner prefers plain-text email" });
    expect(groups[2]!.items[0]).toMatchObject({ label: "142 storm-zone homes", detail: "Email" });
    expect(groups[3]!.items[0]).toMatchObject({ label: "CRM lookup", detail: "2 times" });
  });

  it("never renders the context scopes — the app sends the same four every turn", () => {
    // They shipped as "Context you selected" and the operator selected nothing:
    // a row that is always identical is not evidence.
    const groups = buildArcWorkspaceEvidence(
      [message("m1", "operator", { contextScopes: ["workspace", "brand", "crm", "campaigns"] })],
      [],
    );
    expect(groups).toEqual([]);
  });

  it("shows the fact Arc wrote, not the brain's node key", () => {
    const groups = buildArcWorkspaceEvidence([
      message("m1", "arc", {
        recall: [{ label: "crm_contacts_empty", summary: "The operator's CRM contains 0 contacts as of 2026-07-30." }],
      }),
    ], []);

    expect(groups[0]!.items[0]!.label).toBe("The operator's CRM contains 0 contacts as of 2026-07-30.");
  });

  it("falls back to the key when a memory carries no sentence", () => {
    const groups = buildArcWorkspaceEvidence([
      message("m1", "arc", { recall: [{ label: "crm_contacts_empty" }] }),
    ], []);

    expect(groups[0]!.items[0]!.label).toBe("crm_contacts_empty");
  });

  it("collapses memories that say the same thing in different words", () => {
    // Prod's brain holds five separate nodes all stating the CRM is empty.
    const groups = buildArcWorkspaceEvidence([
      message("m1", "arc", {
        recall: [
          { label: "crm_status", summary: "The CRM is completely empty." },
          { label: "crm_state", summary: "The CRM is completely empty" },
          { label: "crm_other", summary: "The brand has 4 personas." },
        ],
      }),
    ], []);

    expect(groups[0]!.items.map((item) => item.label)).toEqual([
      "The CRM is completely empty.",
      "The brand has 4 personas.",
    ]);
  });

  it("hides a confidence figure that is identical on every item", () => {
    // Prod returns 0.5 across the board; "50% match" on every row dresses a
    // constant up as precision.
    const flat = buildArcWorkspaceEvidence([
      message("m1", "arc", {
        recall: [
          { label: "a", summary: "Fact A", confidence: 0.5 },
          { label: "b", summary: "Fact B", confidence: 0.5 },
        ],
      }),
    ], []);
    expect(flat[0]!.items.every((item) => item.detail === undefined)).toBe(true);

    const varied = buildArcWorkspaceEvidence([
      message("m1", "arc", {
        recall: [
          { label: "a", summary: "Fact A", confidence: 0.9 },
          { label: "b", summary: "Fact B", confidence: 0.4 },
        ],
      }),
    ], []);
    expect(varied[0]!.items[0]!.detail).toBe("90% match");
  });

  it("strips the MCP transport prefix from a tool name", () => {
    const groups = buildArcWorkspaceEvidence([
      message("m1", "arc", {
        toolCalls: [
          { name: "mcp__arc__get_workspace_settings", status: "complete" },
          { name: "ToolSearch", status: "complete" },
        ],
      }),
    ], []);

    // ToolSearch keeps its own capitalisation — it is a name, not an identifier.
    expect(groups[0]!.items.map((item) => item.label)).toEqual(["Get workspace settings", "ToolSearch"]);
  });

  it("keeps an acronym uppercase instead of turning CRM into Crm", () => {
    const groups = buildArcWorkspaceEvidence([
      message("m1", "arc", { toolCalls: [{ name: "mcp__arc__crm_search", status: "complete" }] }),
    ], []);

    expect(groups[0]!.items[0]!.label).toBe("CRM search");
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

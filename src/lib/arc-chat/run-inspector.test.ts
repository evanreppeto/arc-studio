import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { getArcRunInspection } from "./run-inspector";

const MESSAGE = {
  id: "msg-1",
  conversation_id: "conv-1",
  role: "arc",
  body: "You work with Rapid Response Plumbing and Lakeside Mechanical.",
  status: "complete",
  agent_task_id: "task-1",
  mentions: [],
  created_at: "2026-07-31T15:00:00Z",
  metadata: {
    mode: "ask",
    route: "chat",
    context_scopes: ["crm", "brand"],
    runDurationMs: 4200,
    steps: [
      { label: "Searching CRM companies", status: "done", at: "2026-07-31T15:00:01Z" },
      { label: "Writing the answer", status: "done", at: "2026-07-31T15:00:03Z" },
    ],
    recall: [{ label: "partner_tier_a", summary: "Tier A partners refer the most work.", confidence: 0.82, kind: "learning" }],
    toolCalls: [{ name: "search_companies", status: "complete", output: "{...}" }],
  },
};

const USAGE = [
  { input_tokens: 1200, output_tokens: 300, cost_estimate_cents: 9, model: "claude-opus-5" },
  { input_tokens: 800, output_tokens: 150, cost_estimate_cents: 6, model: "claude-opus-5" },
];

function mock(overrides: Record<string, unknown> = {}) {
  const message = { ...MESSAGE, ...(overrides.message as object) };
  return createSupabaseQueryMock({
    // getArcMessage first, then findRequest's operator lookup.
    arc_messages: [
      { data: message, error: null },
      { data: { body: "Which plumbing partners do we work with?" }, error: null },
    ],
    // `in`, not `??` — the cross-org case passes `null` deliberately, and `??`
    // would quietly substitute the default and make that test assert nothing.
    arc_conversations: {
      data: "conversation" in overrides ? (overrides.conversation as object | null) : { id: "conv-1" },
      error: null,
    },
    ai_usage_events: { data: "usage" in overrides ? (overrides.usage as unknown[]) : USAGE, error: null },
  });
}

describe("a run belongs to exactly one org", () => {
  it("reports another org's run as not found, not as forbidden", async () => {
    // getArcMessage takes NO scope and uses the service-role client, so the
    // conversation check is the only thing standing between a raw id and a
    // cross-tenant read. "Exists but is not yours" is itself a disclosure.
    const supabase = mock({ conversation: null });
    const result = await getArcRunInspection("msg-1", "org-other", supabase as never);
    expect(result.status).toBe("not_found");
  });

  it("scopes the conversation lookup by org", async () => {
    const supabase = mock();
    await getArcRunInspection("msg-1", "org-1", supabase as never);
    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
  });

  it("scopes the cost lookup by org as well as task", async () => {
    // Defence in depth: the task id already came from a scoped conversation.
    const supabase = mock();
    await getArcRunInspection("msg-1", "org-1", supabase as never);
    expect(supabase.calls).toContainEqual(["eq", "task_id", "task-1"]);
    expect(supabase.calls.filter((c) => c[0] === "eq" && c[1] === "org_id")).not.toHaveLength(0);
  });

  it("reports a missing run as not found", async () => {
    const supabase = createSupabaseQueryMock({ arc_messages: { data: null, error: null } });
    expect((await getArcRunInspection("nope", "org-1", supabase as never)).status).toBe("not_found");
  });
});

describe("what an operator needs to diagnose a run", () => {
  it("assembles steps, recall, context and the question that opened it", async () => {
    const supabase = mock();
    const result = await getArcRunInspection("msg-1", "org-1", supabase as never);
    if (result.status !== "live") throw new Error(`expected live, got ${result.status}`);

    expect(result.run.request).toBe("Which plumbing partners do we work with?");
    expect(result.run.steps).toHaveLength(2);
    expect(result.run.recall[0]?.summary).toContain("Tier A partners");
    expect(result.run.contextScopes).toEqual(["crm", "brand"]);
    expect(result.run.durationMs).toBe(4200);
    expect(result.run.mode).toBe("ask");
  });

  it("totals tokens and cost across every usage event for the run", async () => {
    const supabase = mock();
    const result = await getArcRunInspection("msg-1", "org-1", supabase as never);
    if (result.status !== "live") throw new Error("expected live");
    expect(result.run.cost).toEqual({
      inputTokens: 2000,
      outputTokens: 450,
      cents: 15,
      models: ["claude-opus-5"],
      events: 2,
    });
  });

  it("reports no cost rather than zero when the runner recorded none", async () => {
    // Zero would read as "this run was free", which is a different claim from
    // "nothing was recorded".
    const supabase = mock({ usage: [] });
    const result = await getArcRunInspection("msg-1", "org-1", supabase as never);
    if (result.status !== "live") throw new Error("expected live");
    expect(result.run.cost).toBeNull();
  });

  it("has no concerns for a healthy run", async () => {
    const supabase = mock();
    const result = await getArcRunInspection("msg-1", "org-1", supabase as never);
    if (result.status !== "live") throw new Error("expected live");
    expect(result.run.concerns).toEqual([]);
  });
});

describe("concerns name the problem in plain language", () => {
  async function concernsFor(metadata: Record<string, unknown>, status = "complete", body = MESSAGE.body) {
    const supabase = mock({ message: { metadata: { ...MESSAGE.metadata, ...metadata }, status, body } });
    const result = await getArcRunInspection("msg-1", "org-1", supabase as never);
    if (result.status !== "live") throw new Error("expected live");
    return result.run.concerns;
  }

  it("makes a run that retrieved nothing obvious at a glance", async () => {
    // The acceptance criterion. An empty recall panel is something a reader has
    // to notice; a stated finding is not.
    const concerns = await concernsFor({ recall: [] });
    expect(concerns.some((c) => c.includes("Nothing was recalled from the Brain"))).toBe(true);
  });

  it("names an errored tool and quotes its reason", async () => {
    const concerns = await concernsFor({
      toolCalls: [{ name: "search_leads", status: "error", output: "RETRIEVAL FAILED — no `leads` field" }],
    });
    expect(concerns[0]).toContain("search_leads");
    expect(concerns[0]).toContain("RETRIEVAL FAILED");
  });

  it("puts an outright failure first", async () => {
    const concerns = await concernsFor({}, "failed");
    expect(concerns[0]).toContain("The run failed");
  });

  it("names a step that never completed", async () => {
    const concerns = await concernsFor({
      steps: [{ label: "Searching CRM companies", status: "running", at: "2026-07-31T15:00:01Z" }],
    });
    expect(concerns.some((c) => c.includes("never completed") && c.includes("Searching CRM companies"))).toBe(true);
  });

  it("reports an empty answer", async () => {
    const concerns = await concernsFor({}, "complete", "   ");
    expect(concerns.some((c) => c.includes("empty answer"))).toBe(true);
  });
});

describe("a broken read is reported, not rendered as an empty run", () => {
  it("surfaces a failed conversation lookup instead of claiming not found", async () => {
    // "Not found" and "the scope check itself broke" are different answers, and
    // collapsing them would hide an outage behind a 404.
    const supabase = createSupabaseQueryMock({
      arc_messages: { data: MESSAGE, error: null },
      arc_conversations: { data: null, error: { message: "column org_id does not exist", code: "42703" } },
    });
    const result = await getArcRinspectionSafe(supabase);
    expect(result.status).toBe("unavailable");
  });
});

// Small indirection so the failing-read test reads cleanly above.
async function getArcRinspectionSafe(supabase: unknown) {
  return getArcRunInspection("msg-1", "org-1", supabase as never);
}

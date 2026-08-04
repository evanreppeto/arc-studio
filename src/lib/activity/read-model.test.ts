import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SupabaseClient } from "@supabase/supabase-js";

import {
  applyActivityFilters,
  buildActivitySummary,
  getRecentActivity,
  groupActivityEntriesByDay,
  mapCampaignEvent,
  mapDecision,
  mapRun,
  mergeActivityEntries,
  sourceLimitForQuery,
  type ActivityEntry,
} from "./read-model";

type FakeSource = { data?: Array<Record<string, unknown>>; error?: { message: string } };

/** Minimal Supabase stub: from(table).select().order().limit() -> { data, error }. */
function fakeClient(perTable: Record<string, FakeSource>): SupabaseClient {
  return {
    from(table: string) {
      const source = perTable[table] ?? { data: [] };
      const builder = {
        select: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({ data: source.data ?? null, error: source.error ?? null }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

function entry(
  id: string,
  occurredAt: string,
  overrides: Partial<ActivityEntry> = {},
): ActivityEntry {
  return {
    id,
    kind: "run",
    tone: "blue",
    title: id,
    detail: "",
    actor: "Arc",
    actorType: "arc",
    category: "agent",
    insightLabel: "Agent work",
    relatedLabel: null,
    occurredAt,
    href: null,
    ...overrides,
  };
}

describe("mergeActivityEntries", () => {
  it("sorts newest-first across sources", () => {
    const merged = mergeActivityEntries(
      [
        entry("a", "2026-05-01T10:00:00Z"),
        entry("c", "2026-05-03T10:00:00Z"),
        entry("b", "2026-05-02T10:00:00Z"),
      ],
      10,
    );
    expect(merged.map((e) => e.id)).toEqual(["c", "b", "a"]);
  });

  it("drops entries with no timestamp", () => {
    const merged = mergeActivityEntries([entry("a", "2026-05-01T10:00:00Z"), entry("b", "")], 10);
    expect(merged.map((e) => e.id)).toEqual(["a"]);
  });

  it("caps to the requested limit", () => {
    const merged = mergeActivityEntries(
      Array.from({ length: 30 }, (_, i) => entry(`e${i}`, `2026-05-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`)),
      5,
    );
    expect(merged).toHaveLength(5);
  });

  it("does not mutate the input array", () => {
    const input = [entry("a", "2026-05-01T10:00:00Z"), entry("b", "2026-05-02T10:00:00Z")];
    const before = input.map((e) => e.id);
    mergeActivityEntries(input, 10);
    expect(input.map((e) => e.id)).toEqual(before);
  });
});

describe("sourceLimitForQuery", () => {
  it("keeps the normal source cap for default activity queries", () => {
    expect(sourceLimitForQuery({})).toBe(50);
  });

  it("widens the source cap for needs-review activity queries", () => {
    expect(sourceLimitForQuery({ needsReview: true })).toBe(250);
  });
});

describe("applyActivityFilters", () => {
  const entries = [
    entry("approval", "2026-06-12T14:00:00Z", {
      actor: "Evan",
      actorType: "human",
      category: "approval",
      title: "Evan approved Launch Email",
      detail: "Approval recorded for Launch Campaign.",
      relatedLabel: "Launch Campaign",
      insightLabel: "Needs you",
    }),
    entry("risk", "2026-06-11T14:00:00Z", {
      actor: "Arc",
      actorType: "arc",
      category: "risk",
      tone: "red",
      title: "Compliance blocked one SMS draft",
      detail: "Risky language was detected.",
      insightLabel: "Risk blocked",
    }),
    entry("campaign", "2026-06-10T14:00:00Z", {
      actor: "System",
      actorType: "system",
      category: "campaign",
      title: "Campaign moved to Ready for Review",
      detail: "Spring Winback is ready.",
      relatedLabel: "Spring Winback",
      insightLabel: "Marketing progress",
    }),
  ];

  it("filters by category", () => {
    const filtered = applyActivityFilters(entries, { categories: ["risk"] });
    expect(filtered.map((item) => item.id)).toEqual(["risk"]);
  });

  it("filters by actor type", () => {
    const filtered = applyActivityFilters(entries, { actorTypes: ["human"] });
    expect(filtered.map((item) => item.id)).toEqual(["approval"]);
  });

  it("filters by inclusive date bounds", () => {
    const filtered = applyActivityFilters(entries, {
      since: "2026-06-11T00:00:00Z",
      until: "2026-06-12T23:59:59Z",
    });
    expect(filtered.map((item) => item.id)).toEqual(["approval", "risk"]);
  });

  it("searches title, detail, actor, related label, category, and insight label", () => {
    expect(applyActivityFilters(entries, { search: "launch" }).map((item) => item.id)).toEqual(["approval"]);
    expect(applyActivityFilters(entries, { search: "arc" }).map((item) => item.id)).toEqual(["risk"]);
    expect(applyActivityFilters(entries, { search: "spring" }).map((item) => item.id)).toEqual(["campaign"]);
    expect(applyActivityFilters(entries, { search: "marketing progress" }).map((item) => item.id)).toEqual(["campaign"]);
    expect(applyActivityFilters(entries, { search: "approval" }).map((item) => item.id)).toEqual(["approval"]);
  });

  it("keeps older review-needed entries before applying the feed limit", () => {
    const newerNonReviewEntries = Array.from({ length: 12 }, (_, index) =>
      entry(`newer-${index}`, `2026-06-12T14:${String(index).padStart(2, "0")}:00Z`, {
        category: "agent",
        insightLabel: "Agent work",
        tone: "green",
      }),
    );
    const olderNeedsReviewEntry = entry("older-needs-review", "2026-06-11T12:00:00Z", {
      category: "approval",
      insightLabel: "Needs you",
      tone: "amber",
    });
    const query = { needsReview: true };

    const filtered = applyActivityFilters([...newerNonReviewEntries, olderNeedsReviewEntry], query);
    const merged = mergeActivityEntries(filtered, 5);

    expect(merged.map((item) => item.id)).toEqual(["older-needs-review"]);
  });

  it("does not treat historical approval decisions as active review work", () => {
    const filtered = applyActivityFilters(
      [
        entry("active-review", "2026-06-12T14:00:00Z", {
          category: "asset",
          insightLabel: "Needs you",
          tone: "amber",
        }),
        entry("declined-history", "2026-06-12T13:00:00Z", {
          category: "approval",
          insightLabel: "Risk blocked",
          tone: "red",
        }),
        entry("revision-history", "2026-06-12T12:00:00Z", {
          category: "approval",
          insightLabel: "Data changed",
          tone: "amber",
        }),
      ],
      { needsReview: true },
    );

    expect(filtered.map((item) => item.id)).toEqual(["active-review"]);
  });
});

describe("buildActivitySummary", () => {
  it("counts the four insight strip buckets", () => {
    const summary = buildActivitySummary([
      entry("review", "2026-06-12T14:00:00Z", {
        category: "approval",
        insightLabel: "Needs you",
        actorType: "human",
      }),
      entry("arc", "2026-06-12T13:00:00Z", {
        category: "agent",
        actorType: "arc",
        insightLabel: "Agent work",
      }),
      entry("campaign", "2026-06-12T12:00:00Z", {
        category: "campaign",
        actorType: "system",
        insightLabel: "Marketing progress",
      }),
      entry("risk", "2026-06-12T11:00:00Z", {
        category: "risk",
        actorType: "system",
        tone: "red",
        insightLabel: "Risk blocked",
      }),
    ]);

    expect(summary).toEqual({
      needsReview: 1,
      arcActions: 1,
      campaignProgress: 1,
      blockedOrRisky: 1,
    });
  });

  it("counts only explicit active-review rows as needs review", () => {
    const summary = buildActivitySummary([
      entry("active-review", "2026-06-12T14:00:00Z", {
        category: "asset",
        insightLabel: "Needs you",
        tone: "amber",
      }),
      entry("declined-history", "2026-06-12T13:00:00Z", {
        category: "approval",
        insightLabel: "Risk blocked",
        tone: "red",
      }),
    ]);

    expect(summary.needsReview).toBe(1);
  });
});

describe("groupActivityEntriesByDay", () => {
  it("groups entries with friendly day labels", () => {
    const groups = groupActivityEntriesByDay(
      [
        entry("today", "2026-06-12T14:00:00Z"),
        entry("yesterday", "2026-06-11T14:00:00Z"),
        entry("older", "2026-06-10T14:00:00Z"),
      ],
      new Date("2026-06-12T16:00:00Z"),
    );

    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday", "June 10, 2026"]);
    expect(groups.map((group) => group.entries.map((item) => item.id))).toEqual([["today"], ["yesterday"], ["older"]]);
  });

  it("groups entries by the same local day basis used by row time formatting", () => {
    const now = new Date(2026, 5, 12, 0, 30);
    const lateYesterday = new Date(2026, 5, 11, 23, 45).toISOString();

    const groups = groupActivityEntriesByDay([entry("late-yesterday", lateYesterday)], now);

    expect(groups.map((group) => group.label)).toEqual(["Yesterday"]);
  });
});

describe("getRecentActivity source resilience", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps rendering other sources when one source's query fails (schema drift)", async () => {
    const client = fakeClient({
      campaign_events: {
        data: [
          {
            id: "ce1",
            campaign_id: "camp_1",
            event_type: "asset_generated",
            actor: "Arc",
            detail: "Arc drafted a hero image.",
            payload: {},
            occurred_at: "2026-06-12T14:00:00Z",
          },
        ],
      },
      agent_run_logs: { error: { message: 'column "created_at" does not exist' } },
    });

    const result = await getRecentActivity({}, client);

    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    expect(result.entries.some((entry) => entry.id === "campaign:ce1")).toBe(true);
    expect(result.entries.some((entry) => entry.kind === "run")).toBe(false);
  });

  it("returns unavailable only when every source fails", async () => {
    const client = fakeClient({
      approval_decisions: { error: { message: "boom" } },
      agent_run_logs: { error: { message: "boom" } },
      agent_outputs: { error: { message: "boom" } },
      campaign_events: { error: { message: "boom" } },
      events: { error: { message: "boom" } },
    });

    const result = await getRecentActivity({}, client);

    expect(result.status).toBe("unavailable");
  });

  it("org-scopes every source when an orgId is supplied (tenant isolation)", async () => {
    const calls: Array<[string, string, string, unknown]> = [];
    // Thenable builder so the agent_tasks pre-fetch (await ...eq()) and the main
    // .order().limit() queries both resolve, while recording eq/in filters.
    const client = {
      from(table: string) {
        const data = table === "agent_tasks" ? [{ id: "task-1" }] : [];
        const result = { data, error: null };
        const builder: Record<string, unknown> = {
          select: () => builder,
          order: () => builder,
          limit: () => Promise.resolve(result),
          eq: (col: string, val: unknown) => {
            calls.push([table, "eq", col, val]);
            return builder;
          },
          in: (col: string, val: unknown) => {
            calls.push([table, "in", col, val]);
            return builder;
          },
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject),
        };
        return builder;
      },
    } as unknown as SupabaseClient;

    const result = await getRecentActivity({}, client, "org-9");
    expect(result.status).toBe("live");

    // `events` was here until BSR-671 retired it — nothing has ever written it,
    // so it could only be a query that returns nothing.
    for (const table of ["approval_decisions", "agent_outputs", "campaign_events"]) {
      expect(calls).toContainEqual([table, "eq", "org_id", "org-9"]);
    }
    // agent_run_logs has no org_id — scoped via its task's org instead.
    expect(calls).toContainEqual(["agent_tasks", "eq", "org_id", "org-9"]);
    expect(calls).toContainEqual(["agent_run_logs", "in", "task_id", ["task-1"]]);
  });
});

describe("mapCampaignEvent", () => {
  it("uses campaign approval decision payloads instead of the generic approval_decided event name", () => {
    const approved = mapCampaignEvent({
      id: "campaign_1",
      campaign_id: "camp_1",
      approval_item_id: "approval_1",
      event_type: "approval_decided",
      actor: "Evan",
      detail: "approve recorded for approval item.",
      payload: { action: "approve", next_status: "approved" },
      occurred_at: "2026-06-12T14:00:00Z",
    });
    const rejected = mapCampaignEvent({
      id: "campaign_2",
      campaign_id: "camp_1",
      approval_item_id: "approval_2",
      event_type: "approval_decided",
      actor: "Evan",
      detail: "reject recorded for approval item.",
      payload: { action: "reject", next_status: "declined" },
      occurred_at: "2026-06-12T13:00:00Z",
    });
    const revision = mapCampaignEvent({
      id: "campaign_3",
      campaign_id: "camp_1",
      approval_item_id: "approval_3",
      event_type: "approval_decided",
      actor: "Evan",
      detail: "Revision requested: tighten the hook",
      payload: { decision: "revision_requested" },
      occurred_at: "2026-06-12T12:00:00Z",
    });

    expect(approved).toMatchObject({
      tone: "green",
      title: "Approval Approved",
      category: "campaign",
      insightLabel: "Marketing progress",
    });
    expect(rejected).toMatchObject({
      tone: "red",
      title: "Approval Declined",
      category: "risk",
      insightLabel: "Risk blocked",
    });
    expect(revision).toMatchObject({
      tone: "amber",
      title: "Approval Revision Requested",
      category: "campaign",
      insightLabel: "Data changed",
    });
  });

  it("marks campaign approval submissions as active review work", () => {
    const mapped = mapCampaignEvent({
      id: "campaign_4",
      campaign_id: "camp_1",
      approval_item_id: "approval_4",
      event_type: "approval_submitted",
      actor: "Arc",
      detail: "Draft is ready for review.",
      payload: {},
      occurred_at: "2026-06-12T14:00:00Z",
    });

    expect(mapped).toMatchObject({
      tone: "amber",
      category: "campaign",
      insightLabel: "Needs you",
      // The campaign detail page is the review surface. `/approvals?item=…` was
      // never a route in this app, and Arc cites these hrefs back to operators.
      href: "/campaigns/camp_1",
    });
  });

  it("links approval and agent-task entries only where the record resolves", () => {
    const links = {
      approvalCampaign: new Map([["approval_9", "camp_9"]]),
      taskCampaign: new Map([["task_9", "camp_9"]]),
    };

    expect(mapDecision({ id: "d1", approval_item_id: "approval_9", decision: "approved" }, links).href).toBe("/campaigns/camp_9");
    // Unresolvable approval: no link beats a link to a page that 404s.
    expect(mapDecision({ id: "d2", approval_item_id: "approval_x", decision: "approved" }, links).href).toBeNull();
    expect(mapDecision({ id: "d3", decision: "approved" }, links).href).toBeNull();

    expect(mapRun({ id: "r1", task_id: "task_9", run_status: "completed" }, links).href).toBe("/campaigns/camp_9");
    // A run with no campaign still has a real home: Arc.
    expect(mapRun({ id: "r2", task_id: "task_x", run_status: "completed" }, links).href).toBe("/arc");
    expect(mapRun({ id: "r3", run_status: "completed" }, links).href).toBeNull();

  });
});

describe("getRecentActivity — demo gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns unavailable (not demo) when flag is OFF and Supabase is unconfigured", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "0");
    // No client passed → falls into unconfigured branch
    const result = await getRecentActivity({}, undefined);
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.message).toMatch(/unavailable/i);
  });

  it("returns demo data when flag is ON and Supabase is unconfigured", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "1");
    const result = await getRecentActivity({}, undefined);
    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it("returns real empty live shape (not demo) when flag is OFF and DB is empty", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "0");
    const client = fakeClient({
      approval_decisions: { data: [] },
      agent_run_logs: { data: [] },
      agent_outputs: { data: [] },
      campaign_events: { data: [] },
      events: { data: [] },
    });
    const result = await getRecentActivity({}, client);
    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    expect(result.entries).toHaveLength(0);
  });

  it("returns demo data when flag is ON and DB is empty", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "1");
    const client = fakeClient({
      approval_decisions: { data: [] },
      agent_run_logs: { data: [] },
      agent_outputs: { data: [] },
      campaign_events: { data: [] },
      events: { data: [] },
    });
    const result = await getRecentActivity({}, client);
    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    expect(result.entries.length).toBeGreaterThan(0);
  });
});


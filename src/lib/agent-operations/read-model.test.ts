import { afterEach, describe, expect, it, vi } from "vitest";

import { WORK_STATE_LABEL } from "@/domain";
import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { getAgentOperationsDashboard, getAgentTaskDetail } from "./read-model";

const EMPTY_SUPABASE = {
  agents: { data: [], error: null },
  agent_tasks: { data: [], error: null },
  approval_items: { data: [], error: null },
  agent_outputs: { data: [], error: null },
  campaigns: { data: [], error: null },
};

describe("getAgentOperationsDashboard — demo gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns unavailable (not demo) when flag is OFF and Supabase is unconfigured", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "0");
    // No client, no env vars → unconfigured branch
    const result = await getAgentOperationsDashboard(undefined);
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.message).toMatch(/unavailable/i);
  });

  it("returns demo data when flag is ON and Supabase is unconfigured", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "1");
    const result = await getAgentOperationsDashboard(undefined);
    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    expect(result.tasks.length).toBeGreaterThan(0);
  });

  it("returns real empty live shape (not demo) when flag is OFF and DB is empty", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "0");
    const supabase = createSupabaseQueryMock(EMPTY_SUPABASE);
    const result = await getAgentOperationsDashboard(supabase, "Agent", { org_id: "org-1", workspace_id: "ws-1" });
    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    // Real empty: no tasks, no agents with demo- ids
    expect(result.tasks).toHaveLength(0);
    expect(result.agents).toHaveLength(0);
  });

  it("returns demo data when flag is ON and DB is empty", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "1");
    const supabase = createSupabaseQueryMock(EMPTY_SUPABASE);
    const result = await getAgentOperationsDashboard(supabase, "Agent", { org_id: "org-1", workspace_id: "ws-1" });
    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    expect(result.tasks.length).toBeGreaterThan(0);
  });
});

describe("getAgentOperationsDashboard", () => {
  it("maps Supabase agent operations into UI-ready dashboard data", async () => {
    const supabase = createSupabaseQueryMock({
      agents: {
        data: [
          {
            id: "agent-1",
            key: "arc-demo",
            name: "Arc Demo Orchestrator",
            description: "Coordinates demo lead and campaign work.",
            status: "running",
            allowed_actions: ["Draft"],
            blocked_actions: ["Send"],
            default_approval_policy: "Human approval required",
            metadata: { risk_flags: ["approval required"] },
            updated_at: "2026-05-29T18:00:00.000Z",
          },
        ],
        error: null,
      },
      agent_tasks: {
        data: [
          {
            id: "task-123456789",
            agent_id: "agent-1",
            description: "Build the first partner-facing draft and keep outbound locked.",
            owner_kind: "human",
            owner_label: "Evan",
            driver_kind: "agent",
            driver_agent_id: "agent-1",
            driver_label: "Arc",
            approver_label: "Owner",
            status: "running",
            priority: "high",
            objective: "Prepare plumbing partner outreach draft.",
            task_type: "campaign_draft",
            source_type: "campaign",
            source_id: "campaign-1",
            campaign_id: "campaign-1",
            approval_item_id: "approval-1",
            due_at: "2026-06-15T18:00:00.000Z",
            scheduled_for: "2026-06-20T09:00:00.000Z",
            completed_at: null,
            created_at: "2026-05-29T18:01:00.000Z",
            updated_at: "2026-05-29T18:02:00.000Z",
            metadata: { risk_level: "medium", progress: { done: 12, total: 20 } },
          },
        ],
        error: null,
      },
      approval_items: {
        data: [
          {
            id: "approval-1",
            campaign_id: "campaign-1",
            campaign_asset_id: "asset-1",
            item_type: "email",
            status: "revision_requested",
            risk_level: "medium",
            requested_by: "arc-demo",
            submitted_at: "2026-05-29T18:03:00.000Z",
            reviewed_at: null,
            draft_output: { subject: "Partner handoff" },
            decision_notes: null,
          },
        ],
        error: null,
      },
      agent_outputs: {
        data: [
          {
            id: "output-1",
            task_id: "task-123456789",
            approval_item_id: "approval-1",
            title: "Plumbing partner email",
            output_type: "email",
            risk_level: "medium",
            compliance_status: "passed",
            approval_status: "revision_requested",
            created_at: "2026-05-29T18:04:00.000Z",
          },
        ],
        error: null,
      },
      campaigns: {
        data: [
          {
            id: "campaign-1",
            name: "Plumbing Partner Outreach Demo",
            persona: "Plumbing Partner",
            status: "draft",
            objective: "Grow partner referrals.",
          },
        ],
        error: null,
      },
    });

    const dashboard = await getAgentOperationsDashboard(supabase, "Agent", { org_id: "org-1", workspace_id: "workspace-1" });

    expect(dashboard.status).toBe("live");
    if (dashboard.status !== "live") return;

    // One name per state: this metric is the same "on your desk" the rest of the
    // app calls "Needs you" (BSR-656).
    expect(dashboard.metrics).toContainEqual({ label: WORK_STATE_LABEL.needs_you, value: 1, delta: "Human gate" });
    expect(dashboard.agents[0]).toMatchObject({
      key: "arc-demo",
      name: "Arc Demo Orchestrator",
      status: "Running",
      currentTask: "Prepare plumbing partner outreach draft.",
      riskFlags: ["approval required"],
    });
    expect(dashboard.tasks[0]).toMatchObject({
      id: "task-123",
      agentName: "Arc Demo Orchestrator",
      task: "Campaign Draft",
      linkedObject: "Campaign: Plumbing Partner Outreach Demo",
      href: "/agent-operations/tasks/task-123456789",
      approvalHref: "/approvals?item=approval-1",
      priority: "High",
      dueAt: "2026-06-15T18:00:00.000Z",
      scheduledFor: "2026-06-20T09:00:00.000Z",
      progress: { done: 12, total: 20 },
      owner: { kind: "human", label: "Evan" },
      driver: { kind: "agent", label: "Agent", agentId: "agent-1" },
      approverLabel: "Owner",
      description: "Build the first partner-facing draft and keep outbound locked.",
    });
    expect(dashboard.approvals[0]).toMatchObject({
      source: "Email",
      campaign: "Plumbing Partner Outreach Demo",
      status: "Revision Requested",
      risk: "Medium",
    });
    expect(dashboard.recentOutputs[0]).toMatchObject({
      output: "Plumbing partner email",
      agent: "Arc Demo Orchestrator",
      status: "Revision Requested",
    });
    expect(supabase.calls).toContainEqual(["from", "agents"]);
    expect(supabase.calls).toContainEqual(["from", "agent_tasks"]);
    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
    expect(supabase.calls).toContainEqual(["eq", "workspace_id", "workspace-1"]);
    expect(supabase.calls).toContainEqual(["from", "approval_items"]);
    // Every one of the five dashboard queries is scoped to BOTH columns, and the
    // counts must match each other (BSR-713). Four of them used to filter org_id
    // alone via a second, weaker `applyOrgScope` helper — including three tables
    // Wave 1 had already locked. The service role bypasses RLS, so this app-layer
    // filter is the only thing separating one workspace's dashboard from another's.
    //
    // Asserted as "org count === workspace count === 5" rather than two fixed
    // numbers on purpose: a future query that scopes one column and forgets the
    // other fails here, which a pair of independent literals would not catch.
    const orgFilters = supabase.calls.filter((c) => c[0] === "eq" && c[1] === "org_id" && c[2] === "org-1");
    const workspaceFilters = supabase.calls.filter((c) => c[0] === "eq" && c[1] === "workspace_id" && c[2] === "workspace-1");
    expect(orgFilters).toHaveLength(5);
    expect(workspaceFilters).toHaveLength(orgFilters.length);
  });

  it("returns unavailable when a Supabase lookup fails", async () => {
    const supabase = createSupabaseQueryMock({
      agents: { data: null, error: { message: "permission denied" } },
    });

    await expect(getAgentOperationsDashboard(supabase)).resolves.toMatchObject({
      status: "unavailable",
      message: "agents lookup failed: permission denied",
    });
  });

  it("summarizes Supabase HTML DNS errors instead of surfacing raw HTML", async () => {
    const supabase = createSupabaseQueryMock({
      agents: { data: [], error: null },
      agent_tasks: {
        data: null,
        error: {
          message:
            '<!doctype html><html><head><title>Origin DNS error | fpjvgqrfqncnudqeudee.supabase.co | Cloudflare</title></head><body><h1>Error 1016</h1><h2>Origin DNS error</h2></body></html>',
        },
      },
      approval_items: { data: [], error: null },
      agent_outputs: { data: [], error: null },
      campaigns: { data: [], error: null },
    });

    const dashboard = await getAgentOperationsDashboard(supabase);

    expect(dashboard.status).toBe("unavailable");
    if (dashboard.status !== "unavailable") return;

    expect(dashboard.message).toContain("Cloudflare 1016");
    expect(dashboard.message).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(dashboard.message).not.toContain("<!doctype");
    expect(dashboard.message).not.toContain("<html");
  });

  it("falls back to legacy task columns when shared ownership columns are not migrated yet", async () => {
    const supabase = createSupabaseQueryMock({
      agents: {
        data: [
          {
            id: "agent-1",
            key: "arc",
            name: "Arc",
            description: "Runs marketing tasks.",
            status: "running",
            allowed_actions: [],
            blocked_actions: [],
            default_approval_policy: "Human approval required",
            metadata: {},
            updated_at: "2026-05-29T18:00:00.000Z",
          },
        ],
        error: null,
      },
      agent_tasks: [
        { data: null, error: { message: "column agent_tasks.description does not exist" } },
        {
          data: [
            {
              id: "task-legacy",
              agent_id: "agent-1",
              status: "running",
              priority: "high",
              objective: "Legacy board task.",
              task_type: "campaign_draft",
              source_type: null,
              source_id: null,
              campaign_id: null,
              approval_item_id: null,
              completed_at: null,
              created_at: "2026-05-29T18:01:00.000Z",
              updated_at: "2026-05-29T18:02:00.000Z",
              metadata: {},
            },
          ],
          error: null,
        },
      ],
      approval_items: { data: [], error: null },
      agent_outputs: { data: [], error: null },
      campaigns: { data: [], error: null },
    });

    const dashboard = await getAgentOperationsDashboard(supabase);

    expect(dashboard.status).toBe("live");
    if (dashboard.status !== "live") return;

    expect(dashboard.tasks[0]).toMatchObject({
      id: "task-legacy",
      objective: "Legacy board task.",
      owner: { kind: "human", label: "Operator" },
      driver: { kind: "agent", label: "Agent", agentId: "agent-1" },
      approverLabel: "Owner",
      description: null,
      dueAt: null,
      scheduledFor: null,
    });
    expect(supabase.calls.filter((call) => call[0] === "from" && call[1] === "agent_tasks")).toHaveLength(2);
  });
});

describe("getAgentTaskDetail", () => {
  it("maps shared human and Arc ticket state into task detail data", async () => {
    const supabase = createSupabaseQueryMock({
      agent_tasks: {
        data: {
          id: "task-123456789",
          agent_id: "agent-1",
          description: "Build the first partner-facing draft and keep outbound locked.",
          owner_kind: "human",
          owner_label: "Evan",
          driver_kind: "agent",
          driver_agent_id: "agent-1",
          driver_label: "Arc",
          approver_label: "Owner",
          status: "running",
          priority: "high",
          objective: "Prepare plumbing partner outreach draft.",
          task_type: "campaign_draft",
          source_type: "campaign",
          source_id: "campaign-1",
          campaign_id: "campaign-1",
          approval_item_id: "approval-1",
          due_at: "2026-06-15T18:00:00.000Z",
          scheduled_for: "2026-06-20T09:00:00.000Z",
          started_at: "2026-05-29T18:01:30.000Z",
          completed_at: null,
          created_at: "2026-05-29T18:01:00.000Z",
          updated_at: "2026-05-29T18:08:00.000Z",
          metadata: {
            acceptance_criteria: [
              { id: "criteria-1", label: "Draft is partner-facing", completed: true },
              { id: "criteria-2", label: "Outbound stays locked", completed: false },
              { id: "bad", completed: true },
              "ignore-me",
            ],
          },
        },
        error: null,
      },
      agents: {
        data: {
          id: "agent-1",
          key: "arc",
          name: "Arc",
          description: "Runs partner-facing marketing tasks.",
          status: "running",
          allowed_actions: ["Draft"],
          blocked_actions: ["Send"],
          default_approval_policy: "Human approval required",
          metadata: {},
          updated_at: "2026-05-29T18:00:00.000Z",
        },
        error: null,
      },
      agent_task_inputs: { data: [], error: null },
      agent_outputs: {
        data: [
          {
            id: "output-new",
            task_id: "task-123456789",
            approval_item_id: "approval-1",
            campaign_asset_id: "asset-1",
            title: "Partner outreach draft v2",
            output_type: "email",
            body: "Updated draft",
            edited_body: null,
            structured_payload: { subject: "Partner handoff" },
            risk_level: "medium",
            compliance_status: "passed",
            approval_status: "pending_owner_approval",
            created_at: "2026-05-29T18:06:00.000Z",
          },
          {
            id: "output-old",
            task_id: "task-123456789",
            approval_item_id: null,
            campaign_asset_id: null,
            title: "Partner outreach draft v1",
            output_type: "email",
            body: "First draft",
            edited_body: null,
            structured_payload: {},
            risk_level: "low",
            compliance_status: "pending",
            approval_status: "draft",
            created_at: "2026-05-29T18:04:00.000Z",
          },
        ],
        error: null,
      },
      agent_run_logs: { data: [], error: null },
      campaigns: {
        data: {
          id: "campaign-1",
          name: "Plumbing Partner Outreach Demo",
          persona: "Plumbing Partner",
          status: "draft",
          objective: "Grow partner referrals.",
        },
        error: null,
      },
      approval_items: {
        data: {
          id: "approval-1",
          item_type: "email",
          status: "pending_owner_approval",
          risk_level: "medium",
          submitted_at: "2026-05-29T18:07:00.000Z",
          reviewed_at: null,
          decision_notes: null,
        },
        error: null,
      },
      agent_task_events: {
        data: [
          {
            id: "event-human",
            task_id: "task-123456789",
            actor_kind: "human",
            actor_label: "Evan",
            event_type: "owner_note",
            title: "Owner brief added",
            body: "Keep outbound locked.",
            metadata: {},
            created_at: "2026-05-29T18:05:00.000Z",
          },
          {
            id: "event-mark",
            task_id: "task-123456789",
            actor_kind: "agent",
            actor_label: "Arc",
            event_type: "agent_started",
            title: "Arc started",
            body: null,
            metadata: {},
            created_at: "2026-05-29T18:03:00.000Z",
          },
        ],
        error: null,
      },
    });

    const detail = await getAgentTaskDetail("task-123456789", supabase, "Agent", { org_id: "org-1", workspace_id: "workspace-1" });

    expect(detail.status).toBe("live");
    if (detail.status !== "live") return;

    expect(detail.task).toMatchObject({
      id: "task-123456789",
      owner: { kind: "human", label: "Evan" },
      driver: { kind: "agent", label: "Agent", agentId: "agent-1" },
      approverLabel: "Owner",
      description: "Build the first partner-facing draft and keep outbound locked.",
      dueAt: "2026-06-15T18:00:00.000Z",
      scheduledFor: "2026-06-20T09:00:00.000Z",
    });
    expect(detail.acceptanceCriteria).toEqual([
      { id: "criteria-1", label: "Draft is partner-facing", completed: true },
      { id: "criteria-2", label: "Outbound stays locked", completed: false },
    ]);
    expect(detail.latestOutput).toMatchObject({
      id: "output-new",
      title: "Partner outreach draft v2",
    });
    expect(detail.timeline.map((item) => item.source)).toEqual(["Approval", "Arc", "Human", "Arc", "Arc"]);
    expect(detail.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "event-human",
          source: "Human",
          eventType: "owner_note",
          title: "Owner brief added",
          body: "Keep outbound locked.",
        }),
        expect.objectContaining({
          id: "event-mark",
          source: "Arc",
          eventType: "agent_started",
          title: "Arc started",
        }),
        expect.objectContaining({
          id: "output-new",
          source: "Arc",
          eventType: "output_created",
          title: "Partner outreach draft v2",
          body: "Subject: Partner handoff",
        }),
        expect.objectContaining({
          id: "approval-1",
          source: "Approval",
          eventType: "approval_event",
          title: "Pending Owner Approval",
          body: "Email approval is pending_owner_approval.",
        }),
      ]),
    );
    expect(supabase.calls).toContainEqual(["from", "agent_task_events"]);
    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
    expect(supabase.calls).toContainEqual(["eq", "workspace_id", "workspace-1"]);
  });

  it("summarizes Supabase HTML DNS errors on task detail lookup", async () => {
    const supabase = createSupabaseQueryMock({
      agent_tasks: {
        data: null,
        error: {
          message:
            '<!doctype html><html><head><title>Origin DNS error | fpjvgqrfqncnudqeudee.supabase.co | Cloudflare</title></head><body><h1>Error 1016</h1><h2>Origin DNS error</h2></body></html>',
        },
      },
    });

    const detail = await getAgentTaskDetail("task-123456789", supabase);

    expect(detail.status).toBe("unavailable");
    if (detail.status !== "unavailable") return;

    expect(detail.message).toContain("Cloudflare 1016");
    expect(detail.message).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(detail.message).not.toContain("<!doctype");
    expect(detail.message).not.toContain("<html");
  });

  it("summarizes Supabase fetch failures on task detail lookup", async () => {
    const supabase = createSupabaseQueryMock({
      agent_tasks: { data: null, error: { message: "TypeError: fetch failed" } },
    });

    const detail = await getAgentTaskDetail("task-123456789", supabase);

    expect(detail.status).toBe("unavailable");
    if (detail.status !== "unavailable") return;

    expect(detail.message).toBe(
      "agent_tasks lookup failed: Supabase connection failed: the data API could not be reached. Check NEXT_PUBLIC_SUPABASE_URL and Supabase project status.",
    );
  });

  it("falls back to legacy task detail data when shared ticket tables are not migrated yet", async () => {
    const supabase = createSupabaseQueryMock({
      agent_tasks: [
        { data: null, error: { message: "column agent_tasks.description does not exist" } },
        {
          data: {
            id: "task-legacy",
            agent_id: "agent-1",
            status: "running",
            priority: "high",
            objective: "Legacy detail task.",
            task_type: "campaign_draft",
            source_type: null,
            source_id: null,
            campaign_id: null,
            approval_item_id: null,
            started_at: "2026-05-29T18:01:30.000Z",
            completed_at: null,
            created_at: "2026-05-29T18:01:00.000Z",
            updated_at: "2026-05-29T18:08:00.000Z",
            metadata: {},
          },
          error: null,
        },
      ],
      agents: {
        data: {
          id: "agent-1",
          key: "arc",
          name: "Arc",
          description: "Runs marketing tasks.",
          status: "running",
          allowed_actions: [],
          blocked_actions: [],
          default_approval_policy: "Human approval required",
          metadata: {},
          updated_at: "2026-05-29T18:00:00.000Z",
        },
        error: null,
      },
      agent_task_inputs: { data: [], error: null },
      agent_outputs: { data: [], error: null },
      agent_run_logs: { data: [], error: null },
      agent_task_events: {
        data: null,
        error: { message: "relation agent_task_events does not exist" },
      },
    });

    const detail = await getAgentTaskDetail("task-legacy", supabase);

    expect(detail.status).toBe("live");
    if (detail.status !== "live") return;

    expect(detail.task).toMatchObject({
      id: "task-legacy",
      objective: "Legacy detail task.",
      owner: { kind: "human", label: "Operator" },
      driver: { kind: "agent", label: "Agent", agentId: "agent-1" },
      approverLabel: "Owner",
      description: null,
      dueAt: null,
      scheduledFor: null,
      startedAt: "2026-05-29T18:01:30.000Z",
    });
    expect(detail.timeline).toEqual([]);
  });
});

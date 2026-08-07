import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseSupportRequest, type NormalizedSupportRequest } from "@/domain";

import {
  fileSupportRequestInLinear,
  isLinearSupportSyncConfigured,
  resetLinearLabelCache,
  resolveLinearConfig,
} from "./linear";

const ENV = {
  LINEAR_API_KEY: "lin_api_test",
  LINEAR_TEAM_ID: "team-1",
  LINEAR_PROJECT_ID: "project-1",
  NEXT_PUBLIC_APP_URL: "https://arc-studio.ai",
};

function request(): NormalizedSupportRequest {
  const parsed = parseSupportRequest({
    category: "bug",
    impact: "blocking",
    subject: "Campaigns board shows zero packages",
    body: "I opened /campaigns and it says 0 packages, but we approved four yesterday.",
    diagnostics: { pagePath: "/campaigns" },
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

const ctx = () => ({
  reference: "ARC-A1B2C3",
  request: request(),
  workspaceName: "Summit Plumbing",
  orgId: "org-1",
  submittedByEmail: "jane@summit.test",
  submittedByName: "Jane Doe",
});

const LABELS = {
  data: {
    issueLabels: {
      nodes: [
        { id: "label-feedback", name: "user-feedback", team: null },
        { id: "label-app", name: "Arc Studio", team: { id: "team-1" } },
        { id: "label-bug", name: "Bug", team: { id: "team-1" } },
        // Same name on someone else's team — must not win.
        { id: "label-bug-other-team", name: "Bug", team: { id: "team-9" } },
      ],
    },
  },
};

const CREATED = {
  data: {
    issueCreate: {
      success: true,
      issue: { id: "issue-1", identifier: "BSR-123", url: "https://linear.app/x/issue/BSR-123" },
    },
  },
};

function jsonFetch(...responses: unknown[]) {
  const queue = [...responses];
  return vi.fn(async () => new Response(JSON.stringify(queue.length > 1 ? queue.shift() : queue[0]), { status: 200 }));
}

/** The `input` object handed to Linear's issueCreate mutation. */
function createInput(fetchImpl: ReturnType<typeof jsonFetch>): Record<string, unknown> {
  const calls = fetchImpl.mock.calls as unknown as [string, { body: string }][];
  const create = calls.find((call) => JSON.parse(call[1].body).query.includes("issueCreate"));
  if (!create) throw new Error("issueCreate was never called");
  return JSON.parse(create[1].body).variables.input as Record<string, unknown>;
}

beforeEach(() => resetLinearLabelCache());

describe("resolveLinearConfig", () => {
  it("is off without a key or a team — the normal state locally and in CI", () => {
    expect(resolveLinearConfig({})).toBeNull();
    expect(resolveLinearConfig({ LINEAR_API_KEY: "k" })).toBeNull();
    expect(resolveLinearConfig({ LINEAR_TEAM_ID: "t" })).toBeNull();
    expect(isLinearSupportSyncConfigured({})).toBe(false);
  });

  it("honours the explicit kill switch even with a full credential set", () => {
    expect(resolveLinearConfig({ ...ENV, LINEAR_SUPPORT_SYNC: "0" })).toBeNull();
  });

  it("reads the project and app url, and treats the project as optional", () => {
    expect(resolveLinearConfig(ENV)).toMatchObject({ teamId: "team-1", projectId: "project-1", appUrl: "https://arc-studio.ai" });
    expect(resolveLinearConfig({ LINEAR_API_KEY: "k", LINEAR_TEAM_ID: "t" })?.projectId).toBeNull();
  });
});

describe("fileSupportRequestInLinear", () => {
  it("skips — rather than fails — when the integration is switched off", async () => {
    const fetchImpl = jsonFetch(CREATED);
    const result = await fileSupportRequestInLinear(ctx(), { env: {}, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, skipped: true, error: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates the issue on the configured team and project", async () => {
    const fetchImpl = jsonFetch(LABELS, CREATED);
    const result = await fileSupportRequestInLinear(ctx(), { env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ ok: true, issue: CREATED.data.issueCreate.issue });

    const input = createInput(fetchImpl);
    expect(input.teamId).toBe("team-1");
    expect(input.projectId).toBe("project-1");
    expect(input.title).toBe("Campaigns board shows zero packages");
    expect(input.priority).toBe(1);
  });

  it("tags the ticket with the feedback marker, the app label and the category label", async () => {
    const fetchImpl = jsonFetch(LABELS, CREATED);
    await fileSupportRequestInLinear(ctx(), { env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(createInput(fetchImpl).labelIds).toEqual(["label-feedback", "label-app", "label-bug"]);
  });

  // The app label is what the per-app Slack feed filters on, and it must not
  // depend on LINEAR_PROJECT_ID being set — an unset env var is the failure it
  // exists to replace.
  it("says which app the report came from even with no project configured", async () => {
    const fetchImpl = jsonFetch(LABELS, CREATED);
    await fileSupportRequestInLinear(ctx(), {
      env: { LINEAR_API_KEY: "lin_api_test", LINEAR_TEAM_ID: "team-1" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(createInput(fetchImpl).labelIds).toContain("label-app");
  });

  it("prefers our own team's label over a same-named one elsewhere", async () => {
    const fetchImpl = jsonFetch(
      { data: { issueLabels: { nodes: [{ id: "label-bug-other-team", name: "Bug", team: { id: "team-9" } }, { id: "label-bug", name: "Bug", team: { id: "team-1" } }] } } },
      CREATED,
    );
    await fileSupportRequestInLinear(ctx(), { env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(createInput(fetchImpl).labelIds).toEqual(["label-bug"]);
  });

  it("still files the ticket when a label name doesn't exist in the workspace", async () => {
    const fetchImpl = jsonFetch({ data: { issueLabels: { nodes: [] } } }, CREATED);
    const result = await fileSupportRequestInLinear(ctx(), { env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.ok).toBe(true);
    expect(createInput(fetchImpl).labelIds).toBeUndefined();
  });

  it("omits projectId entirely when no project is configured", async () => {
    const fetchImpl = jsonFetch(LABELS, CREATED);
    await fileSupportRequestInLinear(ctx(), {
      env: { LINEAR_API_KEY: "lin_api_test", LINEAR_TEAM_ID: "team-1" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect("projectId" in createInput(fetchImpl)).toBe(false);
  });

  it("sends a personal API key raw and an OAuth token as Bearer", async () => {
    const raw = jsonFetch(LABELS, CREATED);
    await fileSupportRequestInLinear(ctx(), { env: ENV, fetchImpl: raw as unknown as typeof fetch });
    const rawHeaders = (raw.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1].headers;
    expect(rawHeaders.Authorization).toBe("lin_api_test");

    resetLinearLabelCache();
    const oauth = jsonFetch(LABELS, CREATED);
    await fileSupportRequestInLinear(ctx(), {
      env: { ...ENV, LINEAR_API_KEY: "oauth-token" },
      fetchImpl: oauth as unknown as typeof fetch,
    });
    const oauthHeaders = (oauth.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1].headers;
    expect(oauthHeaders.Authorization).toBe("Bearer oauth-token");
  });

  // The classic silent failure: GraphQL reports errors with HTTP 200.
  it("treats a 200 carrying GraphQL errors as a failure", async () => {
    const fetchImpl = jsonFetch(LABELS, { errors: [{ message: "Entity not found: Team" }] });
    const result = await fileSupportRequestInLinear(ctx(), { env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ ok: false, skipped: false });
    expect(result.ok === false && result.error).toContain("Entity not found");
  });

  it("treats success:false with no issue as a failure", async () => {
    const fetchImpl = jsonFetch(LABELS, { data: { issueCreate: { success: false, issue: null } } });
    const result = await fileSupportRequestInLinear(ctx(), { env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ ok: false, skipped: false });
  });

  it("surfaces a non-2xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    const result = await fileSupportRequestInLinear(ctx(), { env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ ok: false, skipped: false });
    expect(result.ok === false && result.error).toContain("401");
  });

  it("never throws when the network does", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await fileSupportRequestInLinear(ctx(), { env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ ok: false, skipped: false, error: "ECONNREFUSED" });
  });

  it("looks labels up once per process, not once per ticket", async () => {
    const fetchImpl = jsonFetch(LABELS, CREATED, CREATED);
    await fileSupportRequestInLinear(ctx(), { env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch });
    await fileSupportRequestInLinear(ctx(), { env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch });
    const labelCalls = (fetchImpl.mock.calls as unknown as [string, { body: string }][])
      .filter((call) => JSON.parse(call[1].body).query.includes("issueLabels"));
    expect(labelCalls).toHaveLength(1);
  });

  it("does not cache an empty lookup — that's a transient failure, not a real answer", async () => {
    const empty = jsonFetch({ data: { issueLabels: { nodes: [] } } }, CREATED);
    await fileSupportRequestInLinear(ctx(), { env: ENV, fetchImpl: empty as unknown as typeof fetch });
    const retry = jsonFetch(LABELS, CREATED);
    await fileSupportRequestInLinear(ctx(), { env: ENV, fetchImpl: retry as unknown as typeof fetch });
    expect(createInput(retry).labelIds).toEqual(["label-feedback", "label-app", "label-bug"]);
  });
});

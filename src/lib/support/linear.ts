/**
 * File in-app support requests as Linear issues.
 *
 * This is an INTERNAL destination, not a tenant one. Like resolveSupportInbox(),
 * a report about Arc has to reach whoever builds Arc — so every workspace's
 * feedback lands in one Linear team/project configured by env, and a tenant
 * never sees or configures it. Nothing here is customer-facing outbound, so it
 * deliberately does not consult the live-send kill switch.
 *
 * Never throws and never fails a submit: the Supabase row is the durable record
 * and the email is the human path. A Linear outage must not stop someone from
 * reporting that Arc is broken.
 */

import { buildSupportLinearIssue, supportLinearLabelNames, type SupportLinearContext } from "@/domain";

const LINEAR_API = "https://api.linear.app/graphql";
const REQUEST_TIMEOUT_MS = 8000;

export type LinearConfig = {
  apiKey: string;
  teamId: string;
  projectId: string | null;
  appUrl: string;
};

export type LinearIssueRef = {
  id: string;
  /** Human handle, e.g. "BSR-123". */
  identifier: string;
  url: string;
};

export type LinearSyncResult =
  | { ok: true; issue: LinearIssueRef }
  | { ok: false; skipped: true; error: null }
  | { ok: false; skipped: false; error: string };

/**
 * Linear config, or null when the integration is off.
 *
 * Off is a first-class state: local dev, CI and any deploy without the key all
 * run without it, exactly like Resend. `LINEAR_SUPPORT_SYNC=0` is an explicit
 * kill switch for turning ticket creation off without pulling the credential.
 */
export function resolveLinearConfig(env: Record<string, string | undefined> = process.env): LinearConfig | null {
  if (env.LINEAR_SUPPORT_SYNC?.trim() === "0") return null;
  const apiKey = env.LINEAR_API_KEY?.trim();
  const teamId = env.LINEAR_TEAM_ID?.trim();
  if (!apiKey || !teamId) return null;
  const appUrl = (env.NEXT_PUBLIC_APP_URL || env.NEXT_PUBLIC_SITE_URL || "").trim();
  return { apiKey, teamId, projectId: env.LINEAR_PROJECT_ID?.trim() || null, appUrl };
}

export function isLinearSupportSyncConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return resolveLinearConfig(env) !== null;
}

type GraphQLResponse<T> = { data?: T; errors?: { message?: string }[] };

async function linearGraphQL<T>(
  config: LinearConfig,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(LINEAR_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Personal API keys (lin_api_…) go in raw; OAuth access tokens are Bearer.
        Authorization: config.apiKey.startsWith("lin_api_") ? config.apiKey : `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `Linear returned ${res.status}: ${text.slice(0, 200)}` };

    let payload: GraphQLResponse<T>;
    try {
      payload = JSON.parse(text) as GraphQLResponse<T>;
    } catch {
      return { ok: false, error: `Linear returned unparseable JSON: ${text.slice(0, 200)}` };
    }
    // A GraphQL error is a 200 with an `errors` array — the classic way an
    // integration reports "all green" while writing nothing.
    if (payload.errors?.length) {
      return { ok: false, error: payload.errors.map((e) => e.message ?? "unknown").join("; ").slice(0, 300) };
    }
    if (!payload.data) return { ok: false, error: "Linear returned no data." };
    return { ok: true, data: payload.data };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Linear request failed.";
    return { ok: false, error: message === "The operation was aborted." ? "Linear timed out." : message };
  } finally {
    clearTimeout(timer);
  }
}

const LABELS_QUERY = `query SupportLabels {
  issueLabels(first: 250) { nodes { id name team { id } } }
}`;

type LabelsData = { issueLabels: { nodes: { id: string; name: string; team: { id: string } | null }[] } };

// Label ids never change once created, so one lookup per process is enough. The
// cache is per-config-key so a rotated key or retargeted team re-resolves.
const labelCache = new Map<string, Map<string, string>>();

/**
 * Resolve label NAMES to ids for the configured team.
 *
 * Prefers a workspace-level label (team === null) or one owned by our team, so a
 * same-named label on an unrelated team can't be picked. A name that resolves to
 * nothing is simply absent from the map — the caller drops it rather than
 * failing the ticket, because a missing label is a worse reason to lose a bug
 * report than it is a problem.
 */
async function resolveLabelIds(
  config: LinearConfig,
  fetchImpl: typeof fetch,
): Promise<Map<string, string>> {
  const cacheKey = `${config.apiKey.slice(-8)}:${config.teamId}`;
  const cached = labelCache.get(cacheKey);
  if (cached) return cached;

  const result = await linearGraphQL<LabelsData>(config, LABELS_QUERY, {}, fetchImpl);
  if (!result.ok) return new Map();

  const wanted = new Set(supportLinearLabelNames().map((name) => name.toLowerCase()));
  const map = new Map<string, string>();
  for (const node of result.data.issueLabels.nodes) {
    const key = node.name.toLowerCase();
    if (!wanted.has(key)) continue;
    const ownedHere = node.team === null || node.team.id === config.teamId;
    // First writer wins unless a better-scoped label turns up later.
    if (map.has(key) && !ownedHere) continue;
    if (!map.has(key) || ownedHere) map.set(key, node.id);
  }
  // Only cache a lookup that actually found something — an empty map is far more
  // likely a transient failure than a workspace with none of our labels.
  if (map.size > 0) labelCache.set(cacheKey, map);
  return map;
}

/** Test seam — drops the memoized label ids. */
export function resetLinearLabelCache(): void {
  labelCache.clear();
}

const CREATE_ISSUE = `mutation SupportIssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id identifier url } }
}`;

type CreateIssueData = { issueCreate: { success: boolean; issue: LinearIssueRef | null } };

/**
 * Create the Linear issue for one support request.
 *
 * Returns `skipped` when the integration isn't configured — a distinct state
 * from a failure, so a deploy with no Linear key doesn't look like a broken one.
 */
export async function fileSupportRequestInLinear(
  ctx: Omit<SupportLinearContext, "appUrl">,
  opts: { fetchImpl?: typeof fetch; env?: Record<string, string | undefined> } = {},
): Promise<LinearSyncResult> {
  const config = resolveLinearConfig(opts.env ?? process.env);
  if (!config) return { ok: false, skipped: true, error: null };

  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const draft = buildSupportLinearIssue({ ...ctx, appUrl: config.appUrl });
    const labelIds = await resolveLabelIds(config, fetchImpl);
    const resolved = draft.labels
      .map((name) => labelIds.get(name.toLowerCase()))
      .filter((id): id is string => Boolean(id));

    const input: Record<string, unknown> = {
      teamId: config.teamId,
      title: draft.title,
      description: draft.description,
      priority: draft.priority,
    };
    if (config.projectId) input.projectId = config.projectId;
    if (resolved.length) input.labelIds = resolved;

    const result = await linearGraphQL<CreateIssueData>(config, CREATE_ISSUE, { input }, fetchImpl);
    if (!result.ok) return { ok: false, skipped: false, error: result.error };

    const { success, issue } = result.data.issueCreate;
    if (!success || !issue) return { ok: false, skipped: false, error: "Linear reported the issue was not created." };
    return { ok: true, issue };
  } catch (error) {
    return { ok: false, skipped: false, error: error instanceof Error ? error.message : "Linear sync failed." };
  }
}

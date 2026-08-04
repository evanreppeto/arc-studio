import { type SupabaseClient } from "@supabase/supabase-js";

import { type ArcActionCard, type ArcMedia, type ArcMention, type ArcMode, type ArcQuestion, type ArcRecall, type ArcRoute, type ArcStepKind, parseActions, parseMedia, parseMentions, parseQuestions, parseRecall } from "@/domain";
import { type ArcSkillId } from "@/lib/arc-skills/catalog";

import { getSupabaseAdminClient } from "../supabase/server";
import { type ArcChatTaskScope } from "./inbox";
import { type ShareViewer } from "./sharing";

export type ArcConversation = {
  id: string;
  operator: string;
  title: string;
  status: "active" | "archived";
  pinnedAt: string | null;
  projectId: string | null;
  campaignId: string | null;
  ownerId: string | null;
  workspaceId: string | null;
  /** NOT NULL in the DB: every conversation belongs to exactly one org. */
  orgId: string;
  visibility: "private" | "workspace";
  workspacePermission: "view" | "collaborate";
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  /** Rolling summary of compacted-out earlier turns (null until compaction runs). */
  summary: string | null;
  /** Last message folded into `summary`, so folding stays incremental. */
  summaryThroughMessageId: string | null;
};

export type ArcMessageRole = "operator" | "arc" | "system";
export type ArcMessageStatus = "sent" | "pending" | "complete" | "failed";

export type ArcStep = { label: string; status: "running" | "done"; at: string; detail?: string[]; kind?: ArcStepKind };

/**
 * A structured tool invocation Arc ran while producing a reply (e.g. find_leads,
 * score_lead, weather_lookup). RUNNER CONTRACT: the agent writes these to
 * `arc_messages.metadata.toolCalls` as `[{ name, status, input?, output? }]`.
 * `input`/`output` are pre-rendered strings (JSON or text) so the app stays
 * agnostic to each tool's shape. Absent on rows the runner hasn't populated.
 */
export type ArcToolCall = {
  name: string;
  status: "running" | "complete" | "error";
  input?: string;
  output?: string;
};

/** An operator-uploaded reference image (lives in GCS; `url` is a signed read URL). */
export type ArcAttachment = { url: string; objectPath: string; contentType: string; name: string };

export type ArcMessage = {
  id: string;
  conversationId: string;
  role: ArcMessageRole;
  body: string;
  status: ArcMessageStatus;
  agentTaskId: string | null;
  mentions: ArcMention[];
  media: ArcMedia[];
  steps: ArcStep[];
  /** Arc's narrative thinking for this reply (agent-provided). Optional: absent
   *  on rows/optimistic messages the runner hasn't populated. */
  reasoning?: string | null;
  /** Structured tool runs Arc executed for this reply (agent-provided). */
  toolCalls?: ArcToolCall[];
  feedback: "up" | "down" | null;
  actions: ArcActionCard[];
  /** Proactive follow-up prompts Arc offers after a reply (agent-provided). */
  suggestions: string[];
  /** Structured questions Arc poses for the operator (agent-provided), rendered
   *  as an interactive panel above the composer. Absent on rows without them. */
  questions?: ArcQuestion[];
  /** Memory lines Arc recalled from the brain for this reply (agent-provided),
   *  shown as evidence chips. Absent on rows without them. */
  recall?: ArcRecall[];
  /** Operator-uploaded reference images attached to this message. */
  attachments: ArcAttachment[];
  /** The mode/route this turn was sent with (operator messages); lets Regenerate
   *  reuse the original settings instead of a default. Absent on older rows. */
  mode?: ArcMode;
  route?: ArcRoute;
  /** Workspace sources the operator explicitly selected for this turn. */
  contextScopes?: string[];
  command?: string | null;
  skillId?: ArcSkillId | null;
  /** Measured runner wall-clock for this reply. Stored by the runner at
   * completion so the receipt does not infer duration from two insert times. */
  runDurationMs?: number | null;
  createdAt: string;
};

type ConversationRow = {
  id: string;
  operator: string;
  title: string;
  status: "active" | "archived";
  pinned_at: string | null;
  project_id: string | null;
  campaign_id: string | null;
  owner_id: string | null;
  workspace_id: string | null;
  org_id: string;
  visibility: "private" | "workspace" | null;
  workspace_permission: "view" | "collaborate" | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  summary: string | null;
  summary_through_message_id: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: ArcMessageRole;
  body: string;
  status: ArcMessageStatus;
  agent_task_id: string | null;
  mentions: unknown;
  metadata: unknown;
  created_at: string;
};

const CONVERSATION_COLUMNS =
  "id, operator, title, status, project_id, campaign_id, owner_id, workspace_id, org_id, pinned_at, visibility, workspace_permission, created_at, updated_at, last_message_at, summary, summary_through_message_id";
const MESSAGE_COLUMNS = "id, conversation_id, role, body, status, agent_task_id, mentions, metadata, created_at";

function toConversation(row: ConversationRow): ArcConversation {
  return {
    id: row.id,
    operator: row.operator,
    title: row.title,
    status: row.status,
    pinnedAt: row.pinned_at ?? null,
    projectId: row.project_id ?? null,
    campaignId: row.campaign_id ?? null,
    ownerId: row.owner_id ?? null,
    workspaceId: row.workspace_id ?? null,
    orgId: row.org_id,
    visibility: row.visibility ?? "private",
    workspacePermission: row.workspace_permission ?? "view",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    summary: row.summary ?? null,
    summaryThroughMessageId: row.summary_through_message_id ?? null,
  };
}

function parseSteps(value: unknown): ArcStep[] {
  if (!Array.isArray(value)) return [];
  const out: ArcStep[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const label = (item as { label?: unknown }).label;
    if (typeof label !== "string" || !label.trim()) continue;
    const status = (item as { status?: unknown }).status === "done" ? "done" : "running";
    const at = typeof (item as { at?: unknown }).at === "string" ? (item as { at: string }).at : "";
    const rawDetail = (item as { detail?: unknown }).detail;
    const detail = Array.isArray(rawDetail)
      ? rawDetail.filter((d): d is string => typeof d === "string" && d.trim().length > 0)
      : undefined;
    const VALID_KINDS = ["search", "match", "draft", "media", "think", "tool"];
    const rawKind = (item as { kind?: unknown }).kind;
    const kind = typeof rawKind === "string" && VALID_KINDS.includes(rawKind)
      ? (rawKind as ArcStep["kind"])
      : undefined;
    out.push({ label, status, at, detail: detail && detail.length > 0 ? detail : undefined, ...(kind ? { kind } : {}) });
  }
  return out;
}

function parseReasoning(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseToolCalls(value: unknown): ArcToolCall[] {
  if (!Array.isArray(value)) return [];
  const out: ArcToolCall[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.name !== "string" || !o.name.trim()) continue;
    const status = o.status === "complete" ? "complete" : o.status === "error" ? "error" : "running";
    out.push({
      name: o.name,
      status,
      input: typeof o.input === "string" ? o.input : undefined,
      output: typeof o.output === "string" ? o.output : undefined,
    });
  }
  return out.slice(0, 12);
}

function parseSuggestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 4);
}

function parseAttachments(value: unknown): ArcAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: ArcAttachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.url === "string" && typeof o.objectPath === "string") {
      out.push({
        url: o.url,
        objectPath: o.objectPath,
        contentType: typeof o.contentType === "string" ? o.contentType : "image/*",
        name: typeof o.name === "string" ? o.name : "image",
      });
    }
  }
  return out.slice(0, 8);
}

/** Parse the composer's serialized attachments payload (a JSON string), safely. */
export function parseArcAttachmentsJson(raw: string): ArcAttachment[] {
  try {
    return parseAttachments(JSON.parse(raw));
  } catch {
    return [];
  }
}

function toMessage(row: MessageRow): ArcMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    body: row.body,
    status: row.status,
    agentTaskId: row.agent_task_id,
    mentions: parseMentions(row.mentions),
    media: parseMedia((row.metadata as { media?: unknown } | null)?.media),
    steps: parseSteps((row.metadata as { steps?: unknown } | null)?.steps),
    reasoning: parseReasoning((row.metadata as { reasoning?: unknown } | null)?.reasoning),
    toolCalls: parseToolCalls((row.metadata as { toolCalls?: unknown } | null)?.toolCalls),
    feedback:
      (row.metadata as { feedback?: unknown } | null)?.feedback === "up"
        ? "up"
        : (row.metadata as { feedback?: unknown } | null)?.feedback === "down"
          ? "down"
          : null,
    actions: parseActions((row.metadata as { actions?: unknown } | null)?.actions),
    suggestions: parseSuggestions((row.metadata as { suggestions?: unknown } | null)?.suggestions),
    questions: parseQuestions((row.metadata as { questions?: unknown } | null)?.questions),
    recall: parseRecall((row.metadata as { recall?: unknown } | null)?.recall),
    attachments: parseAttachments((row.metadata as { attachments?: unknown } | null)?.attachments),
    mode: parseOptionalMode((row.metadata as { mode?: unknown } | null)?.mode),
    route: parseOptionalRoute((row.metadata as { route?: unknown } | null)?.route),
    contextScopes: parseContextScopes((row.metadata as { context_scopes?: unknown } | null)?.context_scopes),
    command: parseOptionalString((row.metadata as { command?: unknown } | null)?.command) ?? null,
    skillId: parseOptionalSkillId((row.metadata as { skill_id?: unknown } | null)?.skill_id) ?? null,
    runDurationMs: parseRunDurationMs((row.metadata as { runDurationMs?: unknown } | null)?.runDurationMs),
    createdAt: row.created_at,
  };
}

/** Strict optional parsers — unlike domain's parseArcMode/Route these return
 *  undefined (not a default) when absent, so non-operator rows stay clean. */
function parseOptionalMode(value: unknown): ArcMode | undefined {
  return value === "ask" || value === "act" || value === "draft" ? value : undefined;
}
function parseOptionalRoute(value: unknown): ArcRoute | undefined {
  return value === "fast" || value === "standard" ? value : undefined;
}
function parseOptionalString(value: unknown): string | undefined {
  const str = typeof value === "string" ? value.trim() : "";
  return str || undefined;
}
function parseContextScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(["workspace", "brand", "crm", "campaigns"]);
  return [...new Set(value.filter((scope): scope is string => typeof scope === "string" && allowed.has(scope)))];
}
function parseOptionalSkillId(value: unknown): ArcSkillId | undefined {
  const id = parseOptionalString(value);
  return id === "company-research" || id === "opportunity-discovery" || id === "approval-gated-drafting" || id === "skill-authoring" ? id : undefined;
}

function parseRunDurationMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function assertOk(label: string, error: { message: string } | null) {
  if (error) throw new Error(`${label} failed: ${error.message}`);
}

function applyTaskScope<Query>(query: Query, scope?: ArcChatTaskScope): Query {
  if (!scope) return query;
  type EqQuery = { eq(column: string, value: string): EqQuery };
  return (query as unknown as EqQuery)
    .eq("org_id", scope.orgId)
    .eq("workspace_id", scope.workspaceId) as unknown as Query;
}

async function taskBelongsToScope(
  agentTaskId: string,
  client: SupabaseClient,
  scope?: ArcChatTaskScope,
): Promise<boolean> {
  if (!scope) return true;
  const { data, error } = await applyTaskScope(
    client.from("agent_tasks").select("id").eq("id", agentTaskId),
    scope,
  ).maybeSingle<{ id: string }>();
  assertOk("agent_tasks scope lookup", error);
  return Boolean(data);
}

/**
 * A message belongs to the org AND workspace that own its conversation. Derived
 * rather than passed in by callers: arc_messages.org_id has a DEFAULT hardcoded to
 * one org's slug, so an omitted org_id silently misfiles the row into that tenant
 * instead of failing.
 *
 * Total by construction for the org — arc_messages.conversation_id and
 * arc_conversations.org_id are both NOT NULL. The workspace is derived the same
 * way (BSR-716): arc_conversations.workspace_id is populated on every row on prod,
 * so all 128 unstamped arc_messages resolve through their conversation rather than
 * needing the org fallback. That makes these rows correct under any future
 * org/workspace topology, not just today's.
 */
async function conversationTenant(
  client: SupabaseClient,
  conversationId: string,
): Promise<{ org_id: string; workspace_id: string | null }> {
  const { data, error } = await client
    .from("arc_conversations")
    .select("org_id,workspace_id")
    .eq("id", conversationId)
    .single<{ org_id: string; workspace_id: string | null }>();
  assertOk("arc_conversations tenant lookup", error);
  if (!data?.org_id) throw new Error(`arc_conversations ${conversationId} has no org_id`);
  return { org_id: data.org_id, workspace_id: data.workspace_id };
}

/**
 * Persist a conversation's rolling summary + the marker of the last message folded
 * into it (compaction). Written by the runner via the bearer-gated summary route.
 */
export async function updateConversationSummary(
  conversationId: string,
  input: { summary: string; summaryThroughMessageId: string },
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client
    .from("arc_conversations")
    .update({ summary: input.summary, summary_through_message_id: input.summaryThroughMessageId })
    .eq("id", conversationId);
  assertOk("arc_conversations summary update", error);
}

export async function listConversations(
  operator: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ArcConversation[]> {
  const { data, error } = await client
    .from("arc_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("operator", operator)
    .eq("status", "active")
    .order("pinned_at", { ascending: false, nullsFirst: false })
    .order("last_message_at", { ascending: false });
  assertOk("arc_conversations list", error);
  return ((data ?? []) as ConversationRow[]).map(toConversation);
}

/**
 * Conversations the viewer may see: owned, shared directly, in a shared/accessible
 * project, or workspace-visible in a workspace they belong to. Falls back to the
 * operator-keyed list when sharing isn't enforced (open/dev mode).
 */
export async function listConversationsForViewer(
  viewer: ShareViewer,
  operator: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ArcConversation[]> {
  if (!viewer.enforce || !viewer.userId) {
    return listConversations(operator, client);
  }

  const byId = new Map<string, ConversationRow>();
  const collect = (rows: ConversationRow[] | null) => {
    for (const row of rows ?? []) byId.set(row.id, row);
  };

  // Tenancy note: in enforced mode we scope by workspace/ownership, not the legacy
  // `operator` key. This is safe because `viewer.workspaceIds` contains ONLY the
  // viewer's own active workspace memberships, and each workspace belongs to exactly
  // one org (workspaces.org_id FK) — so the workspace-visible bucket can never surface
  // another org's conversations.

  // Owned, plus workspace-visible in a workspace the viewer belongs to.
  const orParts = [`owner_id.eq.${viewer.userId}`];
  if (viewer.workspaceIds.length > 0) {
    orParts.push(`and(visibility.eq.workspace,workspace_id.in.(${viewer.workspaceIds.join(",")}))`);
  }
  const ownedOrWorkspace = await client
    .from("arc_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("status", "active")
    .or(orParts.join(","));
  assertOk("arc_conversations owned/workspace", ownedOrWorkspace.error);
  collect(ownedOrWorkspace.data as ConversationRow[] | null);

  // Directly shared with the viewer.
  const sharedRows = await client
    .from("arc_conversation_shares")
    .select("conversation_id")
    .eq("user_id", viewer.userId);
  assertOk("arc_conversation_shares ids", sharedRows.error);
  const sharedIds = ((sharedRows.data ?? []) as { conversation_id: string }[]).map((r) => r.conversation_id);

  // Accessible projects (owned, workspace-visible, or shared) → their chats (cascade).
  const projectIdSet = new Set<string>();
  const sharedProjects = await client
    .from("arc_project_shares")
    .select("project_id")
    .eq("user_id", viewer.userId);
  assertOk("arc_project_shares ids", sharedProjects.error);
  for (const r of (sharedProjects.data ?? []) as { project_id: string }[]) projectIdSet.add(r.project_id);

  const projOrParts = [`owner_id.eq.${viewer.userId}`];
  if (viewer.workspaceIds.length > 0) {
    projOrParts.push(`and(visibility.eq.workspace,workspace_id.in.(${viewer.workspaceIds.join(",")}))`);
  }
  const ownedOrWsProjects = await client
    .from("arc_projects")
    .select("id")
    .or(projOrParts.join(","));
  assertOk("arc_projects accessible ids", ownedOrWsProjects.error);
  for (const r of (ownedOrWsProjects.data ?? []) as { id: string }[]) projectIdSet.add(r.id);

  // Fetch chats reached only via direct share or project cascade.
  const extraConversationFilter: string[] = [];
  if (sharedIds.length > 0) extraConversationFilter.push(`id.in.(${sharedIds.join(",")})`);
  if (projectIdSet.size > 0) {
    extraConversationFilter.push(`project_id.in.(${Array.from(projectIdSet).join(",")})`);
  }
  if (extraConversationFilter.length > 0) {
    const extra = await client
      .from("arc_conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("status", "active")
      .or(extraConversationFilter.join(","));
    assertOk("arc_conversations shared/cascade", extra.error);
    collect(extra.data as ConversationRow[] | null);
  }

  return Array.from(byId.values())
    .map(toConversation)
    .sort((a, b) => {
      // Pinned first, then last_message_at desc — mirror listConversations ordering.
      if (!!a.pinnedAt !== !!b.pinnedAt) return a.pinnedAt ? -1 : 1;
      if (a.pinnedAt && b.pinnedAt && a.pinnedAt !== b.pinnedAt) {
        return a.pinnedAt < b.pinnedAt ? 1 : -1;
      }
      return a.lastMessageAt < b.lastMessageAt ? 1 : -1;
    });
}

/** A conversation with an in-flight Arc run, plus when that run last advanced. */
export type ActiveArcRun = {
  conversationId: string;
  /** ISO timestamp the run began (started_at, else created_at). Lets the client
   *  tell a genuinely-working run from an orphaned task stuck in the queue. */
  since: string;
};

/**
 * Conversations that currently have an Arc run in flight (queued or running)
 * — powers the cross-thread "Arc is working…" indicators in the sidebar. Reads
 * the agent_tasks queue by the arc-chat source link; cheap distinct scan. The
 * `since` timestamp lets the sidebar stop spinning on orphaned tasks the runner
 * never completed (it would otherwise spin forever).
 */
export async function listActiveArcRunConversationIds(
  scope?: ArcChatTaskScope,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ActiveArcRun[]> {
  const { data, error } = await applyTaskScope(
    client
      .from("agent_tasks")
      .select("source_id, started_at, created_at")
      .eq("task_type", "arc_chat_message")
      .eq("source_type", "arc_conversation")
      .in("status", ["queued", "running"]),
    scope,
  );
  assertOk("agent_tasks active arc runs", error);
  // One conversation can have several queued turns; keep the freshest start so a
  // recently-sent message keeps spinning even behind an older stuck task.
  const latest = new Map<string, string>();
  for (const row of (data ?? []) as {
    source_id: string | null;
    started_at: string | null;
    created_at: string | null;
  }[]) {
    if (!row.source_id) continue;
    const since = row.started_at ?? row.created_at ?? "";
    const prev = latest.get(row.source_id);
    if (prev === undefined || since > prev) latest.set(row.source_id, since);
  }
  return [...latest].map(([conversationId, since]) => ({ conversationId, since }));
}

export type ArcRunStatus =
  | "queued"
  | "running"
  | "blocked"
  | "needs_approval"
  | "completed"
  | "failed"
  | "canceled";

export type ArcRun = {
  taskId: string;
  conversationId: string | null;
  title: string | null;
  status: ArcRunStatus;
  objective: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

type ArcRunRow = {
  id: string;
  status: ArcRunStatus;
  objective: string | null;
  source_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

/**
 * Recent Arc chat runs across all conversations (newest activity first) — feeds
 * the global Runs view. Reads the agent_tasks queue and resolves each run's
 * conversation title in a second batched lookup.
 */
export async function listRecentArcRuns(
  limit = 30,
  scope?: ArcChatTaskScope,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ArcRun[]> {
  const { data, error } = await applyTaskScope(
    client
      .from("agent_tasks")
      .select("id, status, objective, source_id, created_at, started_at, completed_at")
      .eq("task_type", "arc_chat_message")
      .eq("source_type", "arc_conversation"),
    scope,
  )
    .order("updated_at", { ascending: false })
    .limit(limit);
  assertOk("agent_tasks recent arc runs", error);
  const rows = (data ?? []) as ArcRunRow[];

  const convIds = [...new Set(rows.map((r) => r.source_id).filter((id): id is string => Boolean(id)))];
  const titles = new Map<string, string>();
  if (convIds.length > 0) {
    const { data: convs, error: convErr } = await client
      .from("arc_conversations")
      .select("id, title")
      .in("id", convIds);
    assertOk("arc_conversations run titles", convErr);
    for (const c of (convs ?? []) as { id: string; title: string }[]) titles.set(c.id, c.title);
  }

  return rows.map((r) => ({
    taskId: r.id,
    conversationId: r.source_id,
    title: r.source_id ? titles.get(r.source_id) ?? null : null,
    status: r.status,
    objective: r.objective,
    createdAt: r.created_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
  }));
}

export async function getConversation(
  id: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ArcConversation | null> {
  const { data, error } = await client
    .from("arc_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("id", id)
    .maybeSingle<ConversationRow>();
  assertOk("arc_conversations get", error);
  return data ? toConversation(data) : null;
}

export async function createConversation(
  input: {
    operator: string;
    title: string;
    projectId?: string | null;
    campaignId?: string | null;
    ownerId?: string | null;
    workspaceId?: string | null;
    orgId?: string | null;
  },
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ArcConversation> {
  const { data, error } = await client
    .from("arc_conversations")
    .insert({
      operator: input.operator,
      title: input.title,
      project_id: input.projectId ?? null,
      campaign_id: input.campaignId ?? null,
      ...(input.ownerId != null ? { owner_id: input.ownerId } : {}),
      ...(input.workspaceId != null ? { workspace_id: input.workspaceId } : {}),
      ...(input.orgId != null ? { org_id: input.orgId } : {}),
    })
    .select(CONVERSATION_COLUMNS)
    .single<ConversationRow>();
  assertOk("arc_conversations insert", error);
  if (!data) throw new Error("arc_conversations insert returned no row");
  return toConversation(data);
}

export async function renameConversation(
  id: string,
  title: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client.from("arc_conversations").update({ title }).eq("id", id);
  assertOk("arc_conversations rename", error);
}

export async function archiveConversation(
  id: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client.from("arc_conversations").update({ status: "archived" }).eq("id", id);
  assertOk("arc_conversations archive", error);
}

export async function touchConversation(
  id: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client
    .from("arc_conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", id);
  assertOk("arc_conversations touch", error);
}

export async function listMessages(
  conversationId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ArcMessage[]> {
  const { data, error } = await client
    .from("arc_messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  assertOk("arc_messages list", error);
  return ((data ?? []) as MessageRow[]).map(toMessage);
}

/**
 * The single in-flight (pending) Arc reply for a conversation — the newest one.
 * Powers the SSE live-stream that pushes the growing body/steps/reasoning to the
 * browser. Null when nothing is in flight (the reply has completed, or none was
 * sent). Cheap indexed lookup (conversation_id, role, status).
 */
export async function getPendingArcMessage(
  conversationId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ArcMessage | null> {
  const { data, error } = await client
    .from("arc_messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .eq("role", "arc")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<MessageRow>();
  assertOk("arc_messages pending get", error);
  return data ? toMessage(data) : null;
}

/**
 * Every asset-bearing Arc message from the OTHER active conversations in a
 * project — the source for the Studio's project-wide Assets library. The active
 * conversation is excluded (its messages already arrive live), and messages
 * without action cards are dropped so the payload stays small.
 */
export async function listProjectAssetMessages(
  projectId: string,
  operator: string,
  options: { excludeConversationId?: string; limit?: number } = {},
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ArcMessage[]> {
  const { data: convRows, error: convErr } = await client
    .from("arc_conversations")
    .select("id")
    .eq("operator", operator)
    .eq("project_id", projectId)
    .eq("status", "active");
  assertOk("arc_conversations project list", convErr);

  const ids = ((convRows ?? []) as { id: string }[])
    .map((r) => r.id)
    .filter((id) => id !== options.excludeConversationId);
  if (ids.length === 0) return [];

  const { data, error } = await client
    .from("arc_messages")
    .select(MESSAGE_COLUMNS)
    .in("conversation_id", ids)
    .eq("role", "arc")
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 100);
  assertOk("arc_messages project assets list", error);

  return ((data ?? []) as MessageRow[]).map(toMessage).filter((m) => m.actions.length > 0);
}

/**
 * The latest operator message strictly before `beforeCreatedAt` in a conversation
 * — i.e. the turn that prompted a given reply. Used by Regenerate to find the
 * message to re-run. Null when there's none.
 */
export async function getPrecedingOperatorMessage(
  conversationId: string,
  beforeCreatedAt: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ArcMessage | null> {
  const { data, error } = await client
    .from("arc_messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .eq("role", "operator")
    .lt("created_at", beforeCreatedAt)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<MessageRow>();
  assertOk("arc_messages preceding operator", error);
  return data ? toMessage(data) : null;
}

/**
 * Delete every message in a conversation created after `anchorMessageId` — the
 * branch-truncation behind Edit-and-resend and Regenerate (re-running a turn
 * replaces everything that followed it). Scoped to the one conversation; returns
 * the number removed. No-op (0) when the anchor no longer exists.
 */
export async function deleteMessagesAfter(
  conversationId: string,
  anchorMessageId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<number> {
  const { data: anchor, error: anchorErr } = await client
    .from("arc_messages")
    .select("created_at")
    .eq("id", anchorMessageId)
    .eq("conversation_id", conversationId)
    .maybeSingle<{ created_at: string }>();
  assertOk("arc_messages truncate anchor", anchorErr);
  if (!anchor) return 0;
  const { data, error } = await client
    .from("arc_messages")
    .delete()
    .eq("conversation_id", conversationId)
    .gt("created_at", anchor.created_at)
    .select("id");
  assertOk("arc_messages truncate delete", error);
  return (data ?? []).length;
}

export async function insertOperatorMessage(
  input: {
    conversationId: string;
    body: string;
    mentions: ArcMention[];
    attachments?: ArcAttachment[];
    mode?: ArcMode;
    route?: ArcRoute;
    command?: string | null;
    skillId?: ArcSkillId | null;
    contextScopes?: string[];
    author_user_id?: string | null;
  },
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ArcMessage> {
  const metadata: Record<string, unknown> = {};
  if (input.attachments && input.attachments.length > 0) metadata.attachments = input.attachments;
  if (input.mode) metadata.mode = input.mode;
  if (input.route) metadata.route = input.route;
  if (input.command) metadata.command = input.command;
  if (input.skillId) metadata.skill_id = input.skillId;
  if (input.contextScopes && input.contextScopes.length > 0) metadata.context_scopes = input.contextScopes;
  const tenant = await conversationTenant(client, input.conversationId);
  const { data, error } = await client
    .from("arc_messages")
    .insert({
      conversation_id: input.conversationId,
      ...tenant,
      role: "operator",
      body: input.body,
      status: "sent",
      mentions: input.mentions,
      metadata,
      ...(input.author_user_id != null ? { author_user_id: input.author_user_id } : {}),
    })
    .select(MESSAGE_COLUMNS)
    .single<MessageRow>();
  assertOk("arc_messages operator insert", error);
  if (!data) throw new Error("arc_messages operator insert returned no row");
  return toMessage(data);
}

export async function insertPendingArcMessage(
  input: { conversationId: string; agentTaskId: string },
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ArcMessage> {
  const tenant = await conversationTenant(client, input.conversationId);
  const { data, error } = await client
    .from("arc_messages")
    .insert({
      conversation_id: input.conversationId,
      ...tenant,
      role: "arc",
      body: "",
      status: "pending",
      agent_task_id: input.agentTaskId,
    })
    .select(MESSAGE_COLUMNS)
    .single<MessageRow>();
  assertOk("arc_messages pending insert", error);
  if (!data) throw new Error("arc_messages pending insert returned no row");
  return toMessage(data);
}

export async function insertFailedArcMessage(
  input: { conversationId: string; body: string },
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ArcMessage> {
  const tenant = await conversationTenant(client, input.conversationId);
  const { data, error } = await client
    .from("arc_messages")
    .insert({ conversation_id: input.conversationId, ...tenant, role: "arc", body: input.body, status: "failed" })
    .select(MESSAGE_COLUMNS)
    .single<MessageRow>();
  assertOk("arc_messages failed insert", error);
  if (!data) throw new Error("arc_messages failed insert returned no row");
  return toMessage(data);
}

export async function findPendingMessageByTask(
  agentTaskId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
  scope?: ArcChatTaskScope,
): Promise<ArcMessage | null> {
  if (!(await taskBelongsToScope(agentTaskId, client, scope))) {
    return null;
  }

  const { data, error } = await client
    .from("arc_messages")
    .select(MESSAGE_COLUMNS)
    .eq("agent_task_id", agentTaskId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<MessageRow>();
  assertOk("arc_messages find pending", error);
  return data ? toMessage(data) : null;
}

export async function completeArcMessage(
  input: { messageId: string; body: string; metadata?: Record<string, unknown>; mentions?: ArcMention[] },
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { data, error } = await client.rpc("arc_complete_message", {
    p_message_id: input.messageId,
    p_body: input.body,
    p_metadata: input.metadata ?? {},
    // SQL treats null as "leave the existing mentions column unchanged". An
    // explicitly provided [] still clears it, preserving the prior API contract.
    p_mentions: input.mentions ?? null,
  });
  if (error && isMissingCompleteMessageRpc(error)) {
    await completeArcMessageCompat(input, client);
    return;
  }
  assertOk("arc_messages complete", error);
  if (data !== true) throw new Error("arc_messages complete found no pending message");
}

function isMissingCompleteMessageRpc(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  return (
    code === "PGRST202" ||
    code === "42883" ||
    (typeof message === "string" &&
      message.includes("arc_complete_message") &&
      /schema cache|does not exist|could not find/i.test(message))
  );
}

/**
 * Deployment-order bridge for app instances that reach a database before the
 * arc_complete_message migration has been applied. This preserves the previous
 * read/merge/write behavior only for a positively identified missing-function
 * error; every other RPC failure remains loud. Remove after every environment
 * has the migration.
 */
async function completeArcMessageCompat(
  input: { messageId: string; body: string; metadata?: Record<string, unknown>; mentions?: ArcMention[] },
  client: SupabaseClient,
): Promise<void> {
  const { data: current, error: readError } = await client
    .from("arc_messages")
    .select("metadata, mentions")
    .eq("id", input.messageId)
    .eq("status", "pending")
    .maybeSingle<{ metadata: unknown; mentions: unknown }>();
  assertOk("arc_messages complete compatibility read", readError);
  if (!current) throw new Error("arc_messages complete found no pending message");

  const currentMetadata = current.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
    ? (current.metadata as Record<string, unknown>)
    : {};
  const update: Record<string, unknown> = {
    body: input.body,
    status: "complete",
    metadata: { ...currentMetadata, ...(input.metadata ?? {}) },
  };
  if (input.mentions !== undefined) update.mentions = input.mentions;

  const { data: completed, error: updateError } = await client
    .from("arc_messages")
    .update(update)
    .eq("id", input.messageId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle<{ id: string }>();
  assertOk("arc_messages complete compatibility update", updateError);
  if (!completed) throw new Error("arc_messages complete found no pending message");
}

/**
 * Live-stream a partial reply body into the pending message while Arc is still
 * generating, so the chat types the answer out instead of it popping in at the
 * end. Updates ONLY `body`, and ONLY while the row is still `pending` — once
 * completeArcMessage flips it to `complete`, late chunks match nothing and are
 * harmless no-ops (so a trailing chunk can never overwrite the final reply).
 * Best-effort, like live steps.
 */
export async function streamArcMessageBody(
  input: { agentTaskId: string; body: string },
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client
    .from("arc_messages")
    .update({ body: input.body })
    .eq("agent_task_id", input.agentTaskId)
    .eq("status", "pending");
  assertOk("arc_messages body stream", error);
}

/**
 * Live-stream Arc's reasoning (extended-thinking tokens) into the pending message
 * while it's still thinking, so the chat shows the thought forming instead of a
 * post-hoc summary. Writes ONLY `metadata.reasoning`, and ONLY while the row is
 * still `pending` — once completeArcMessage runs, late chunks match nothing and
 * are harmless no-ops. The database function patches the JSON field atomically,
 * so a simultaneous step update cannot be lost; best-effort, like body streaming.
 */
export async function streamArcMessageReasoning(
  input: { agentTaskId: string; reasoning: string },
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client.rpc("arc_stream_message_reasoning", {
    p_agent_task_id: input.agentTaskId,
    p_reasoning: input.reasoning,
  });
  assertOk("arc_messages reasoning stream", error);
}

export async function failArcMessage(
  input: { messageId: string; body: string },
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client
    .from("arc_messages")
    .update({ body: input.body, status: "failed" })
    .eq("id", input.messageId);
  assertOk("arc_messages fail", error);
}

// --------------------------------------------------------------------------- #
// Projects (group conversations) + archive helpers
// --------------------------------------------------------------------------- #
export type ArcProject = { id: string; operator: string; name: string; createdAt: string; updatedAt: string };

type ProjectRow = { id: string; operator: string; name: string; created_at: string; updated_at: string };

const PROJECT_COLUMNS = "id, operator, name, created_at, updated_at";

function toProject(row: ProjectRow): ArcProject {
  return { id: row.id, operator: row.operator, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function createProject(
  input: {
    operator: string;
    name: string;
    ownerId?: string | null;
    workspaceId?: string | null;
    /** Required: arc_projects.org_id has no default, so omitting it is a
     *  not-null violation. Typed non-optional to catch that at compile time. */
    orgId: string;
  },
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ArcProject> {
  const { data, error } = await client
    .from("arc_projects")
    .insert({
      operator: input.operator,
      name: input.name,
      org_id: input.orgId,
      ...(input.ownerId != null ? { owner_id: input.ownerId } : {}),
      ...(input.workspaceId != null ? { workspace_id: input.workspaceId } : {}),
    })
    .select(PROJECT_COLUMNS)
    .single<ProjectRow>();
  assertOk("arc_projects insert", error);
  if (!data) throw new Error("arc_projects insert returned no row");
  return toProject(data);
}

/**
 * Link a conversation to the campaign it's working on, ensuring it has a project.
 * Creates a project (named after the campaign) only when the conversation has
 * none — otherwise reuses the existing one. Always sets campaign_id to the worked
 * campaign. No-op if the conversation no longer exists.
 */
export async function linkConversationToCampaign(
  conversationId: string,
  campaignId: string,
  projectName: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const conversation = await getConversation(conversationId, client);
  if (!conversation) return;
  let projectId = conversation.projectId;
  if (!projectId) {
    // The project belongs to the same org as the conversation it groups. Passing
    // it explicitly is load-bearing: arc_projects.org_id has no default anymore,
    // so an omitted org is a not-null violation rather than a silent misfile.
    const project = await createProject(
      { operator: conversation.operator, name: projectName, orgId: conversation.orgId },
      client,
    );
    projectId = project.id;
  }
  const { error } = await client
    .from("arc_conversations")
    .update({ project_id: projectId, campaign_id: campaignId })
    .eq("id", conversationId);
  assertOk("arc_conversations link campaign", error);
}

export async function listProjects(
  operator: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ArcProject[]> {
  const { data, error } = await client
    .from("arc_projects")
    .select(PROJECT_COLUMNS)
    .eq("operator", operator)
    .order("created_at", { ascending: true });
  assertOk("arc_projects list", error);
  return ((data ?? []) as ProjectRow[]).map(toProject);
}

export async function renameProject(
  id: string,
  name: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client.from("arc_projects").update({ name }).eq("id", id);
  assertOk("arc_projects rename", error);
}

export async function deleteProject(
  id: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client.from("arc_projects").delete().eq("id", id);
  assertOk("arc_projects delete", error);
}

export async function assignConversationToProject(
  conversationId: string,
  projectId: string | null,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client.from("arc_conversations").update({ project_id: projectId }).eq("id", conversationId);
  assertOk("arc_conversations assign project", error);
}

export async function assignConversationToCampaign(
  conversationId: string,
  campaignId: string | null,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client.from("arc_conversations").update({ campaign_id: campaignId }).eq("id", conversationId);
  assertOk("arc_conversations assign campaign", error);
}

export async function setConversationPinned(
  id: string,
  pinned: boolean,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { error } = await client
    .from("arc_conversations")
    .update({ pinned_at: pinned ? new Date().toISOString() : null })
    .eq("id", id);
  assertOk("arc_conversations pin", error);
}

export async function deleteConversation(
  id: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  // arc_messages cascade via the conversation_id FK (on delete cascade).
  const { error } = await client.from("arc_conversations").delete().eq("id", id);
  assertOk("arc_conversations delete", error);
}

/** Deletes the latest pending Arc bubble for a conversation (the "stop generating"
 *  backing op). Returns false (safe no-op) when there's nothing pending. */
export async function cancelPendingArcMessage(
  conversationId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<boolean> {
  const { data, error } = await client
    .from("arc_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("role", "arc")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  assertOk("arc_messages cancel lookup", error);
  if (!data) return false;
  const { error: delErr } = await client.from("arc_messages").delete().eq("id", data.id);
  assertOk("arc_messages cancel delete", delErr);
  return true;
}

export async function unarchiveConversation(
  id: string,
  client: SupabaseClient = getSupabaseAdminClient(),
  opts: { orgId?: string | null } = {},
): Promise<void> {
  let query = client.from("arc_conversations").update({ status: "active" }).eq("id", id);
  // Scope the restore to the current workspace so a leaked id can't reactivate
  // another org's conversation.
  if (opts.orgId) query = query.eq("org_id", opts.orgId);
  const { error } = await query;
  assertOk("arc_conversations unarchive", error);
}

export async function listArchivedConversations(
  operator: string,
  client: SupabaseClient = getSupabaseAdminClient(),
  opts: { orgId?: string | null } = {},
): Promise<ArcConversation[]> {
  let query = client
    .from("arc_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("operator", operator)
    .eq("status", "archived");
  // Rows carry a NOT-NULL org_id; scope the read so an operator in more than one
  // workspace never sees another org's archived chats.
  if (opts.orgId) query = query.eq("org_id", opts.orgId);
  const { data, error } = await query
    .order("pinned_at", { ascending: false, nullsFirst: false })
    .order("last_message_at", { ascending: false });
  assertOk("arc_conversations archived list", error);
  return ((data ?? []) as ConversationRow[]).map(toConversation);
}

// --------------------------------------------------------------------------- #
// Live activity steps (what Arc is doing, shown while a reply is pending)
// --------------------------------------------------------------------------- #
/** Pure: append a step, or flip the matching running step to done (no duplicate). */
export function mergeStep(steps: ArcStep[], step: ArcStep): ArcStep[] {
  if (step.status === "done") {
    const reverseIdx = [...steps].reverse().findIndex((s) => s.label === step.label && s.status === "running");
    if (reverseIdx !== -1) {
      const realIdx = steps.length - 1 - reverseIdx;
      return steps.map((s, i) => (i === realIdx ? step : s));
    }
  }
  return [...steps, step];
}

export async function appendArcStep(
  input: { agentTaskId: string; label: string; status: "running" | "done"; at: string; detail?: string | null },
  client: SupabaseClient = getSupabaseAdminClient(),
  scope?: ArcChatTaskScope,
): Promise<boolean> {
  if (!(await taskBelongsToScope(input.agentTaskId, client, scope))) {
    return false;
  }

  const { data, error } = await client.rpc("arc_append_message_step", {
    p_agent_task_id: input.agentTaskId,
    p_label: input.label,
    p_status: input.status,
    p_at: input.at,
    // The reasoning that led to this step. Omitted when closing a step — the RPC
    // carries over whatever was recorded when it opened.
    p_detail: input.detail ?? null,
  });
  assertOk("arc_messages step update", error);
  return data === true;
}

/** Resolve the conversation a message belongs to (for access gating). Null when
 *  no such message exists. */
export async function getMessageConversationId(
  messageId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<string | null> {
  const { data, error } = await client
    .from("arc_messages")
    .select("conversation_id")
    .eq("id", messageId)
    .maybeSingle<{ conversation_id: string }>();
  assertOk("arc_messages conversation lookup", error);
  return data?.conversation_id ?? null;
}

/** Fetch one message for operator-side interactions such as save and feedback. */
export async function getArcMessage(
  messageId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ArcMessage | null> {
  const { data, error } = await client
    .from("arc_messages")
    .select(MESSAGE_COLUMNS)
    .eq("id", messageId)
    .maybeSingle<MessageRow>();
  assertOk("arc_messages get", error);
  return data ? toMessage(data) : null;
}

export async function setArcMessageFeedback(
  messageId: string,
  value: "up" | "down" | null,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<void> {
  const { data, error } = await client
    .from("arc_messages")
    .select("id, metadata")
    .eq("id", messageId)
    .maybeSingle<{ id: string; metadata: Record<string, unknown> | null }>();
  assertOk("arc_messages feedback lookup", error);
  if (!data) return;
  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const { error: upErr } = await client
    .from("arc_messages")
    .update({ metadata: { ...meta, feedback: value } })
    .eq("id", messageId);
  assertOk("arc_messages feedback update", upErr);
}

/**
 * Update the body of an operator message in place (for the edit-and-resend
 * flow). Guarded to `role = "operator"` so an arc/system row can never be
 * rewritten, and records a light edit audit in metadata. Returns false when no
 * matching operator row exists.
 */
export async function updateOperatorMessageBody(
  messageId: string,
  body: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<boolean> {
  const { data, error } = await client
    .from("arc_messages")
    .select("id, role, metadata")
    .eq("id", messageId)
    .maybeSingle<{ id: string; role: string; metadata: Record<string, unknown> | null }>();
  assertOk("arc_messages edit lookup", error);
  if (!data || data.role !== "operator") return false;
  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const editCount = typeof meta.editCount === "number" ? meta.editCount : 0;
  const { error: upErr } = await client
    .from("arc_messages")
    .update({ body, metadata: { ...meta, editedAt: new Date().toISOString(), editCount: editCount + 1 } })
    .eq("id", messageId)
    .eq("role", "operator");
  assertOk("arc_messages edit update", upErr);
  return true;
}

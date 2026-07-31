import type { Config } from "./config";
import type { WakeTenantIdentity } from "./types";

/**
 * Thin client over the app's Arc Operations API (/api/v1/arc/*). The runner
 * never touches Supabase directly — this is its only seam into app state.
 *
 * A client is created per wake with that wake's tenant identity, which it echoes
 * on every callback as X-Arc-Workspace-Id / X-Arc-Org-Id. The app's arcGuard
 * validates the workspace and scopes the request to it, so a single shared runner
 * writes back to the correct tenant instead of the app's default workspace.
 */

export type ChatReplyInput = {
  agentTaskId: string;
  body: string;
  status?: "complete" | "failed";
  metadata?: Record<string, unknown>;
  /** Records Arc used — populates the "Sources Arc used" row. */
  mentions?: Array<{ type: string; id: string; label: string; href: string }>;
};

export type QueryParams = Record<string, string | number | undefined | null>;

function toQuery(params: QueryParams | undefined): string {
  if (!params) return "";
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function createArcClient(config: Config, identity?: WakeTenantIdentity) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${config.arcAgentApiToken}`,
  };
  if (identity?.workspaceId) headers["x-arc-workspace-id"] = identity.workspaceId;
  if (identity?.orgId) headers["x-arc-org-id"] = identity.orgId;

  /** Authenticated GET against the Operations API. Throws on non-2xx or { ok:false }. */
  async function apiGet<T = unknown>(path: string, params?: QueryParams): Promise<T> {
    const res = await fetch(`${config.appApiBaseUrl}${path}${toQuery(params)}`, { headers });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string } & Record<string, unknown>;
    if (!res.ok || json?.ok === false) {
      throw new Error(`GET ${path} -> ${res.status} ${json?.message ?? ""}`.trim());
    }
    return json as T;
  }

  /** Authenticated POST against the Operations API. Throws on non-2xx or { ok:false }. */
  async function apiPost<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${config.appApiBaseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string } & Record<string, unknown>;
    if (!res.ok || json?.ok === false) {
      throw new Error(`POST ${path} -> ${res.status} ${json?.message ?? ""}`.trim());
    }
    return json as T;
  }

  /** Authenticated PUT against the Operations API. Throws on non-2xx or { ok:false }. */
  async function apiPut<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${config.appApiBaseUrl}${path}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string } & Record<string, unknown>;
    if (!res.ok || json?.ok === false) {
      throw new Error(`PUT ${path} -> ${res.status} ${json?.message ?? ""}`.trim());
    }
    return json as T;
  }

  async function postChatReply(input: ChatReplyInput): Promise<void> {
    await apiPost("/api/v1/arc/messages", {
      agentTaskId: input.agentTaskId,
      body: input.body,
      status: input.status ?? "complete",
      metadata: input.metadata ?? {},
      ...(input.mentions ? { mentions: input.mentions } : {}),
    });
  }

  /**
   * Append a live activity step to the pending chat bubble (the chain-of-thought
   * trace). Best-effort — a failed step must never break the run.
   */
  async function postStep(
    agentTaskId: string,
    label: string,
    status: "running" | "done",
    detail?: string | null,
  ): Promise<void> {
    try {
      await fetch(`${config.appApiBaseUrl}/api/v1/arc/messages/${agentTaskId}/steps`, {
        method: "POST",
        headers,
        body: JSON.stringify({ label, status, ...(detail ? { detail } : {}) }),
      });
    } catch {
      /* steps are cosmetic; ignore */
    }
  }

  /**
   * Stream the growing reply text into the pending chat bubble so the chat types
   * it out live as the model generates. Best-effort — the canonical body is the
   * final postChatReply, so a dropped chunk never affects correctness.
   */
  async function postChatChunk(agentTaskId: string, body: string): Promise<void> {
    try {
      await fetch(`${config.appApiBaseUrl}/api/v1/arc/messages/${agentTaskId}/body`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body }),
      });
    } catch {
      /* streaming chunks are cosmetic; the final reply is the source of truth */
    }
  }

  /**
   * Stream Arc's growing reasoning (extended-thinking tokens) into the pending
   * chat bubble so the chat shows the thought forming live. Best-effort — the
   * canonical reasoning is written by the final postChatReply, so a dropped
   * chunk never affects the recorded result.
   */
  async function postChatThinking(agentTaskId: string, reasoning: string): Promise<void> {
    try {
      await fetch(`${config.appApiBaseUrl}/api/v1/arc/messages/${agentTaskId}/reasoning`, {
        method: "POST",
        headers,
        body: JSON.stringify({ reasoning }),
      });
    } catch {
      /* live reasoning is cosmetic; the final reply is the source of truth */
    }
  }

  /**
   * Report token usage for a completed turn to the app's usage ledger.
   * Best-effort — metering must never break or delay the chat reply.
   */
  async function postUsage(input: {
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
    actorUser?: string | null;
    taskId?: string | null;
    /** Usage fields with no ledger column; the app folds these into row metadata. */
    detail?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      await fetch(`${config.appApiBaseUrl}/api/v1/arc/usage`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: input.model,
          input_tokens: input.inputTokens ?? undefined,
          output_tokens: input.outputTokens ?? undefined,
          actor_user: input.actorUser ?? undefined,
          task_id: input.taskId ?? undefined,
          usage_detail: input.detail ?? undefined,
        }),
      });
    } catch {
      /* metering is non-essential; never surface to the run */
    }
  }

  return { apiGet, apiPost, apiPut, postChatReply, postStep, postChatChunk, postChatThinking, postUsage };
}

export type ArcClient = ReturnType<typeof createArcClient>;

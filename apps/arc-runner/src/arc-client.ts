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

  /**
   * Authenticated POST against the Operations API. Throws on non-2xx or { ok:false }.
   *
   * Retries a 5xx a couple of times with a short backoff. The API verifies our
   * DB-issued token against Supabase on EVERY request, so a single blip there
   * used to end the whole run: on 2026-08-04 a completed opportunity scan could
   * not post its own completion and the task sat `queued` forever. A 4xx is still
   * fatal on the first try — that one really is our fault and retrying it just
   * repeats the mistake.
   */
  async function apiPost<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
    const payload = JSON.stringify(body);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));

      const res = await fetch(`${config.appApiBaseUrl}${path}`, { method: "POST", headers, body: payload });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string } & Record<string, unknown>;
      if (res.ok && json?.ok !== false) return json as T;

      lastError = new Error(`POST ${path} -> ${res.status} ${json?.message ?? ""}`.trim());
      if (res.status < 500) throw lastError;
      const willRetry = attempt < 2;
      console.warn(
        `[arc-runner] POST ${path} -> ${res.status}${willRetry ? `, retrying (${attempt + 1}/3)` : " — giving up after 3 attempts"}`,
      );
    }

    throw lastError ?? new Error(`POST ${path} failed`);
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

  /**
   * Claim a queued task (queued -> running) before working it.
   *
   * Returns false when the app answers 409 — another worker already owns this
   * task — so the caller can drop the duplicate instead of running the same
   * instruction twice. Every other failure throws, because "we could not claim"
   * for any other reason must not be mistaken for "someone else has it".
   *
   * Claiming is what makes a `queued` row mean "never started". Without it, a
   * task that is mid-run and a task whose wake was dropped are indistinguishable
   * in the database, and nothing downstream can safely re-dispatch either one.
   */
  async function claimTask(agentTaskId: string): Promise<boolean> {
    const res = await fetch(`${config.appApiBaseUrl}/api/v1/arc/tasks/${agentTaskId}/claim`, {
      method: "POST",
      headers,
      body: "{}",
    });
    if (res.status === 409) return false;
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(`POST /api/v1/arc/tasks/${agentTaskId}/claim -> ${res.status} ${json?.message ?? ""}`.trim());
    }
    return true;
  }

  return { apiGet, apiPost, apiPut, claimTask, postChatReply, postStep, postChatChunk, postChatThinking, postUsage };
}

export type ArcClient = ReturnType<typeof createArcClient>;

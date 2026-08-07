/**
 * Minimal remote-MCP client: `initialize`, then `tools/call`, over plain HTTP.
 *
 * The runner talks to remote MCP servers through the Agent SDK, but the app has
 * to reach one directly to execute a generation itself — an operator pressing
 * "Generate" in Studio is not an agent turn. This is that path.
 *
 * The transport was already proven here once: `checkHiggsfieldToken` has been
 * doing initialize + tools/call against mcp.higgsfield.ai since the connector
 * shipped. It is now built on this module rather than beside it, because two
 * copies of a protocol handshake is how one of them quietly stops matching the
 * server.
 *
 * Deliberately NOT a full MCP implementation: no notifications, no resources, no
 * sampling, no streaming progress. One request/response tool call is the whole
 * requirement, and anything more would be scaffolding with no caller.
 */

/** A tool call that produced a result the server called successful. */
export type McpCallOk = { ok: true; result: unknown };
/**
 * A tool call that did not. `kind` is load-bearing at the call site:
 * `auth` means the credential is the problem (reconnect), `tool` means the
 * server ran the tool and it failed (the operator's input, usually), and
 * `transport` means we never got a verdict at all — which must NOT be reported
 * as a rejection. (Distinguishing "no verdict" from "denied" is the lesson of
 * the token-verification incident; see docs.)
 */
export type McpCallErr = { ok: false; kind: "auth" | "tool" | "transport"; error: string };
export type McpCallResult = McpCallOk | McpCallErr;

const PROTOCOL_VERSION = "2024-11-05";
const CLIENT_INFO = { name: "arc-studio", version: "1" };

/**
 * Parse an MCP HTTP response body. The server answers `tools/call` as either
 * JSON or an SSE stream depending on the request, so both shapes have to be
 * understood; an SSE body is one or more `data:` lines each holding a JSON-RPC
 * envelope, and the one we want is the envelope carrying `result` or `error`.
 */
export function parseMcpBody(text: string, contentType: string): Record<string, unknown> | null {
  const envelopes: unknown[] = [];
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        envelopes.push(JSON.parse(line.slice(5).trim()));
      } catch {
        // A partial or non-JSON data line is not a protocol answer; skip it
        // rather than failing the whole call on stream noise.
      }
    }
  } else {
    try {
      envelopes.push(JSON.parse(text));
    } catch {
      return null;
    }
  }
  const answer = envelopes.find(
    (e): e is Record<string, unknown> => Boolean(e) && typeof e === "object" && ("result" in (e as object) || "error" in (e as object)),
  );
  return answer ?? null;
}

/**
 * Unwrap an MCP tool result into the JSON the tool actually returned.
 *
 * MCP wraps every tool result in `content: [{type:"text", text}]`, and these
 * servers put a JSON document in that text. A tool that reports failure sets
 * `isError` and puts a human sentence there instead — which is why the text is
 * returned as-is when it doesn't parse, rather than being treated as a protocol
 * fault: the sentence is the error message worth showing.
 */
export function unwrapToolResult(result: unknown): { ok: boolean; value: unknown } {
  const obj = (result ?? {}) as Record<string, unknown>;
  const isError = obj.isError === true;
  const content = Array.isArray(obj.content) ? obj.content : [];
  const text = content
    .filter((c): c is { type: string; text: string } => Boolean(c) && typeof c === "object" && (c as { type?: string }).type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
  if (!text) return { ok: !isError, value: obj.structuredContent ?? null };
  try {
    return { ok: !isError, value: JSON.parse(text) };
  } catch {
    return { ok: !isError, value: text };
  }
}

export type McpToolCall = {
  /** The remote MCP endpoint, e.g. https://mcp.higgsfield.ai/mcp */
  url: string;
  /** Bearer token. For Higgsfield this is a short-lived OAuth access token —
   *  refresh it before calling (`ensureFreshAccessToken`), not after a 401. */
  token: string;
  name: string;
  args: Record<string, unknown>;
  /** Per-request ceiling. A generation submit is fast; a long-poll is not. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Call one tool on a remote MCP server. Never throws — every failure comes back
 * as a typed `McpCallErr`, because these run inside operator actions where an
 * unhandled reject is a blank screen rather than a sentence.
 */
export async function callMcpTool(call: McpToolCall): Promise<McpCallResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${call.token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const signal = AbortSignal.timeout(call.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const init = await fetch(call.url, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      }),
    });
    if (init.status === 401 || init.status === 403) {
      return { ok: false, kind: "auth", error: `authorization rejected (${init.status})` };
    }
    if (init.status < 200 || init.status >= 300) {
      return { ok: false, kind: "transport", error: `initialize failed (${init.status})` };
    }

    // The session id, when the server issues one, has to ride on every
    // subsequent request — without it the tool call is a new unauthenticated
    // session and the server answers as if we never initialized.
    const sessionId = init.headers.get("mcp-session-id");
    const callHeaders = sessionId ? { ...headers, "Mcp-Session-Id": sessionId } : headers;

    const res = await fetch(call.url, {
      method: "POST",
      headers: callHeaders,
      signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: call.name, arguments: call.args } }),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, kind: "auth", error: `authorization rejected (${res.status})` };
    }
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, kind: "transport", error: `${call.name} failed (${res.status})` };
    }

    const envelope = parseMcpBody(await res.text(), res.headers.get("content-type") ?? "");
    if (!envelope) return { ok: false, kind: "transport", error: `${call.name} returned an unreadable response` };
    if (envelope.error) {
      const err = envelope.error as { message?: string };
      return { ok: false, kind: "tool", error: err.message || `${call.name} returned an error` };
    }

    const unwrapped = unwrapToolResult(envelope.result);
    if (!unwrapped.ok) {
      return {
        ok: false,
        kind: "tool",
        error: typeof unwrapped.value === "string" ? unwrapped.value : `${call.name} reported a failure`,
      };
    }
    return { ok: true, result: unwrapped.value };
  } catch (error) {
    // Includes the abort. A timeout is emphatically NOT a rejection: the job may
    // well have been submitted, so the caller must be able to tell the two apart.
    const message = error instanceof Error ? error.message : "request failed";
    return { ok: false, kind: "transport", error: message };
  }
}

import { HIGGSFIELD_MCP_URL } from "./higgsfield-mcp";
import { callMcpTool } from "./mcp-client";

/**
 * Validate a Higgsfield access token by calling the zero-credit `balance` tool.
 *
 * `balance` is chosen precisely because it costs nothing: a health check that
 * spends the customer's credits is a health check nobody dares run.
 *
 * The handshake used to live here, hand-rolled. It now goes through the shared
 * MCP client — the same one that executes generations — so a protocol change
 * cannot leave the health check passing while real calls fail.
 */
export async function checkHiggsfieldToken(accessToken: string): Promise<{ ok: boolean; error?: string }> {
  const res = await callMcpTool({ url: HIGGSFIELD_MCP_URL, token: accessToken, name: "balance", args: {}, timeoutMs: 15_000 });
  if (!res.ok) return { ok: false, error: res.error };

  // Assert on the SHAPE of a balance, not merely on a 200: an authorized call
  // that answers with something else is not a working connector.
  const text = JSON.stringify(res.result ?? "");
  const looksLikeBalance = text.includes("subscription_plan_type") || text.includes("credits");
  return looksLikeBalance ? { ok: true } : { ok: false, error: "unexpected balance response" };
}

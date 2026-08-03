import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A poll ticket binds an in-flight Veo operation to the workspace that started it.
 *
 * Video generation is start-then-poll, and the operation name is minted by Google
 * and round-trips through the browser. The platform Gemini key is shared across
 * workspaces, so a poll that trusted the operation name alone would let any
 * signed-in operator who guessed (or saw) another workspace's operation name pull
 * that workspace's video into their own campaign. The ticket is an HMAC the client
 * cannot forge, so the poll can refuse anything that does not verify.
 *
 * Keyed on the service-role key because it is the one server-only secret every
 * deployment that can generate media already has; it is never exposed, only used
 * as HMAC key material.
 */
function ticketKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

export function signVideoTicket(operationName: string, workspaceId: string): string {
  return createHmac("sha256", ticketKey()).update(`${operationName}|${workspaceId}`).digest("hex");
}

export function verifyVideoTicket(ticket: string, operationName: string, workspaceId: string): boolean {
  // An empty workspace id must never verify — that would make the binding a no-op
  // for exactly the un-scoped callers it exists to stop.
  if (!workspaceId || !ticket) return false;
  const expected = Buffer.from(signVideoTicket(operationName, workspaceId), "utf8");
  const given = Buffer.from(ticket, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

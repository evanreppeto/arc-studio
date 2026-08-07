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

/**
 * The ticket also binds the ENGINE that started the job.
 *
 * An operation name is opaque and now comes from one of two providers, so the
 * poll has to know which one to ask. Re-deriving it from the workspace's current
 * default would be wrong the moment someone changes that default mid-render —
 * the poll would question the wrong engine and report a live job as missing. It
 * is signed rather than merely passed so a client cannot redirect a poll at the
 * other provider. Defaults to "gemini" so tickets minted before this existed,
 * and callers that never render video, keep verifying.
 */
export function signVideoTicket(operationName: string, workspaceId: string, engine = "gemini"): string {
  const payload = engine === "gemini" ? `${operationName}|${workspaceId}` : `${operationName}|${workspaceId}|${engine}`;
  return createHmac("sha256", ticketKey()).update(payload).digest("hex");
}

export function verifyVideoTicket(ticket: string, operationName: string, workspaceId: string, engine = "gemini"): boolean {
  // An empty workspace id must never verify — that would make the binding a no-op
  // for exactly the un-scoped callers it exists to stop.
  if (!workspaceId || !ticket) return false;
  const expected = Buffer.from(signVideoTicket(operationName, workspaceId, engine), "utf8");
  const given = Buffer.from(ticket, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

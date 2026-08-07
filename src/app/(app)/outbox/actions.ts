"use server";

import { revalidatePath } from "next/cache";

import { getCurrentAgentTaskTenantFields } from "@/lib/agent-tasks/scope";
import { getOperatorActor, requireOperator } from "@/lib/auth/operator";
import { executeResendDispatch } from "@/lib/dispatch/execute-resend";
import { transitionDispatch } from "@/lib/dispatch/persistence";
import { DISPATCH_STATUS_ORDER, type DispatchStatus } from "@/lib/dispatch/status";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

/**
 * Operator-driven dispatch controls from the Outbox. Two kinds:
 *  - `sendDispatchAction` — the real outbound gate: a human confirms and the app
 *    performs the actual Resend send via `executeResendDispatch`, which itself
 *    refuses anything not queued/scheduled + approved and is idempotent. This is
 *    the outbound-locked posture in practice — Arc never sends on its own; a human
 *    confirms every send, and only then does mail leave the building.
 *  - `transitionDispatchAction` — lifecycle bookkeeping after the fact (mark a sent
 *    dispatch delivered, retry a failure back to queued, cancel). No send.
 * Both are gated by requireOperator(). `persisted: false` is the honest
 * offline/demo signal.
 */
export type OutboxActionResult =
  | { ok: true; persisted: boolean; status?: DispatchStatus }
  | { ok: false; error: string };

/**
 * Statuses the bookkeeping action may set — every one EXCEPT `sent`.
 *
 * `sent` is a claim that mail left the building, and only `executeResendDispatch`
 * is in a position to make it: it re-checks the approval gate and the
 * ARC_SEND_ENABLED kill-switch, talks to Resend, and records the provider id.
 * `transitionDispatch` does none of that — it stamps the status, sets
 * `dispatched_at`, and writes a "dispatch sent" campaign event.
 *
 * The UI never asked for it (`ACTION_TARGET` routes queued/scheduled through
 * `sendDispatchAction` instead), but a server action is a public endpoint: any
 * authenticated operator could POST `to: "sent"` and get a dispatch marked sent,
 * timestamped, and entered in the audit trail without a single email being
 * delivered. That is a false entry in the one ledger the outbound posture rests
 * on — and it would be indistinguishable afterwards from a real send.
 */
const ALLOWED_TARGET: ReadonlySet<DispatchStatus> = new Set(
  DISPATCH_STATUS_ORDER.filter((status) => status !== "sent"),
);

export async function transitionDispatchAction(dispatchId: string, to: DispatchStatus): Promise<OutboxActionResult> {
  await requireOperator();

  if (!dispatchId) return { ok: false, error: "Missing dispatch." };
  if (to === "sent") {
    // Named separately from "unknown status" — this one is a real status being
    // refused on purpose, and a caller deserves to know which.
    return { ok: false, error: "A dispatch becomes sent by sending it, not by being marked sent." };
  }
  if (!ALLOWED_TARGET.has(to)) return { ok: false, error: "Unknown dispatch status." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false, status: to };

  try {
    const operator = await getOperatorActor();
    const tenant = await getCurrentAgentTaskTenantFields();
    await transitionDispatch({ dispatchId, to, operator, tenant }, getSupabaseAdminClient());
    revalidatePath("/outbox");
    return { ok: true, persisted: true, status: to };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not update the dispatch." };
  }
}

/**
 * The real send. A human clicked "Confirm send" / "Send now" on an approved,
 * queued (or scheduled) dispatch. Delegates to `executeResendDispatch`, which
 * re-checks the approval gate + Resend kill-switch and is idempotent, then marks
 * the row `sent`. This — not a status stamp — is what actually delivers mail.
 */
export async function sendDispatchAction(dispatchId: string): Promise<OutboxActionResult> {
  await requireOperator();

  if (!dispatchId) return { ok: false, error: "Missing dispatch." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false, status: "sent" };

  try {
    const operator = await getOperatorActor();
    const result = await executeResendDispatch({ dispatchId, operator }, getSupabaseAdminClient());
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/outbox");
    return { ok: true, persisted: true, status: "sent" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not send the dispatch." };
  }
}

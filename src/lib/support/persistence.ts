import { type SupabaseClient } from "@supabase/supabase-js";

import type { NormalizedSupportRequest } from "@/domain";

import { getSupabaseAdminClient } from "@/lib/supabase/server";

// Untyped SupabaseClient: `support_requests` isn't in the generated
// database.types yet (that regenerates against a DB with the migration applied),
// matching how the settings/vault/connections layers handle their tables.

export type SupportPersistResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export type SupportSubmitter = {
  orgId: string;
  workspaceId: string | null;
  userId: string | null;
  email: string;
  name: string;
};

/**
 * Insert one support request. Org-scoped explicitly — the service-role client
 * bypasses RLS, so the tenant filter is the caller's responsibility here (same
 * contract as every other admin-client write in src/lib).
 */
export async function insertSupportRequest(
  request: NormalizedSupportRequest,
  submitter: SupportSubmitter,
): Promise<SupportPersistResult> {
  const supabase: SupabaseClient = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("support_requests")
    .insert({
      org_id: submitter.orgId,
      workspace_id: submitter.workspaceId,
      submitted_by_user_id: submitter.userId,
      submitted_by_email: submitter.email || null,
      submitted_by_name: submitter.name || null,
      category: request.category,
      impact: request.impact,
      subject: request.subject,
      body: request.body,
      page_path: request.pagePath || null,
      diagnostics: request.diagnostics,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  const id = (data as { id?: string } | null)?.id;
  if (!id) return { ok: false, error: "The request was written but returned no id." };
  return { ok: true, id };
}

export type SupportDeliveryOutcome = {
  /** True when the support-inbox email was delivered. */
  notified: boolean;
  /** Set when the request was filed as a Linear ticket. */
  linear?: { id: string; identifier: string; url: string } | null;
  /** Why the Linear filing failed. Null both when it succeeded and when it's switched off. */
  linearError?: string | null;
};

/**
 * Record what actually happened to a request after it was stored: whether the
 * email went out, and whether it reached Linear.
 *
 * One UPDATE for both so a submit costs one round trip rather than two, and
 * best-effort like markSupportRequestNotified — the row is already durable, and
 * losing a status flag must never fail the submit the operator just made.
 *
 * A failure is written as well as a success. An error column that only ever
 * holds null can't tell "Linear is off" from "Linear has been down for a week".
 */
export async function markSupportRequestDelivered(id: string, outcome: SupportDeliveryOutcome): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (outcome.notified) patch.notified = true;
  if (outcome.linear) {
    patch.linear_issue_id = outcome.linear.id;
    patch.linear_issue_identifier = outcome.linear.identifier;
    patch.linear_issue_url = outcome.linear.url;
    patch.linear_sync_error = null;
  } else if (outcome.linearError) {
    patch.linear_sync_error = outcome.linearError.slice(0, 500);
  }
  if (Object.keys(patch).length === 0) return;

  try {
    const supabase: SupabaseClient = getSupabaseAdminClient();
    await supabase.from("support_requests").update(patch).eq("id", id);
  } catch {
    // Same contract as above: the request is stored, the ticket may exist; a
    // missed bookkeeping write is not worth failing the operator's submit.
  }
}

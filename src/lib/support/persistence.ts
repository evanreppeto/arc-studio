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

/** Record whether the notification email actually went out. Best-effort — never throws. */
export async function markSupportRequestNotified(id: string, notified: boolean): Promise<void> {
  if (!notified) return;
  try {
    const supabase: SupabaseClient = getSupabaseAdminClient();
    await supabase.from("support_requests").update({ notified: true }).eq("id", id);
  } catch {
    // The request is already durable; a missed flag is not worth failing the submit.
  }
}

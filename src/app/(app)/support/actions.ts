"use server";

import { revalidatePath } from "next/cache";

import { parseSupportRequest, supportReferenceCode, type SupportRequestInput } from "@/domain";

import { resolveViewerName } from "@/lib/auth/display-name";
import { requireOperator } from "@/lib/auth/operator";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getSupabaseAuthenticatedUser } from "@/lib/supabase/auth-server";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { resolveAppVersion } from "@/lib/support/inbox";
import { notifySupportInbox } from "@/lib/support/notify";
import { insertSupportRequest, markSupportRequestNotified } from "@/lib/support/persistence";

export type SubmitSupportRequestResult =
  | {
      ok: true;
      /** False when there's no Supabase to write to — the mailto fallback is the real path then. */
      persisted: boolean;
      /** False when the notification email didn't go out (Resend unconfigured or failing). */
      notified: boolean;
      reference: string | null;
    }
  | { ok: false; error: string };

/**
 * Records an in-app support request and notifies the support inbox.
 *
 * Follows the wired-feature shape: requireOperator() → validate in the domain →
 * honest `persisted: false` when Supabase isn't configured → persist → revalidate.
 * A failed email never fails the submit: the row is the durable record, and the
 * UI tells the operator to email us directly when delivery didn't happen.
 */
export async function submitSupportRequest(input: SupportRequestInput): Promise<SubmitSupportRequestResult> {
  await requireOperator();

  const parsed = parseSupportRequest(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const request = parsed.value;

  // Stamp the build server-side — a client-supplied version is worthless for
  // pinning a report to a deploy.
  const appVersion = resolveAppVersion();
  if (appVersion) request.diagnostics.appVersion = appVersion;

  const ctx = await getCurrentWorkspaceContext().catch(() => null);
  if (!ctx?.orgId || !isSupabaseAdminConfigured()) {
    return { ok: true, persisted: false, notified: false, reference: null };
  }

  const user = await getSupabaseAuthenticatedUser();
  const name = await resolveViewerName(ctx.orgId, user).catch(() => "");
  const email = user?.email ?? "";

  const stored = await insertSupportRequest(request, {
    orgId: ctx.orgId,
    workspaceId: ctx.workspaceId,
    userId: user?.id ?? null,
    email,
    name,
  });
  if (!stored.ok) return { ok: false, error: stored.error };

  const reference = supportReferenceCode(stored.id);
  const notification = await notifySupportInbox({
    reference,
    request,
    workspaceName: ctx.workspaceName || ctx.orgName,
    orgId: ctx.orgId,
    submittedByEmail: email,
    submittedByName: name,
  });
  await markSupportRequestNotified(stored.id, notification.ok);

  revalidatePath("/support");
  return { ok: true, persisted: true, notified: notification.ok, reference };
}

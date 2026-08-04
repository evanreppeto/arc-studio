"use server";

import { revalidatePath } from "next/cache";

import { parseSupportRequest, supportReferenceCode, type SupportRequestInput } from "@/domain";

import { resolveViewerName } from "@/lib/auth/display-name";
import { requireOperator } from "@/lib/auth/operator";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { reportDegraded } from "@/lib/observability/report-degraded";
import { getSupabaseAuthenticatedUser } from "@/lib/supabase/auth-server";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { fileSupportRequestInLinear } from "@/lib/support/linear";
import { resolveAppVersion } from "@/lib/support/inbox";
import { notifySupportInbox } from "@/lib/support/notify";
import { insertSupportRequest, markSupportRequestDelivered } from "@/lib/support/persistence";

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

  // Correctly silent (BSR-546): a support request must be submittable even
  // when workspace context can't be resolved — the request itself is the point,
  // and the org is enrichment. Reporting this would be noise.
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
  const delivery = {
    reference,
    request,
    workspaceName: ctx.workspaceName || ctx.orgName,
    orgId: ctx.orgId,
    submittedByEmail: email,
    submittedByName: name,
  };

  // Email and Linear are independent destinations for the same report, so they
  // go out together rather than one behind the other. Neither can fail the
  // submit — both are wrapped, and the row is already durable.
  const [notification, linear] = await Promise.all([
    notifySupportInbox(delivery),
    fileSupportRequestInLinear(delivery),
  ]);

  // A Linear failure is invisible to the operator (the ticket is our internal
  // triage, not theirs), which is exactly why it has to be loud on our side —
  // otherwise feedback stops reaching the board and nothing anywhere says so.
  if (!linear.ok && !linear.skipped) {
    reportDegraded(new Error(linear.error), {
      scope: "support.fileSupportRequestInLinear",
      surface: "secondary",
      detail: { reference, category: request.category },
    });
  }

  await markSupportRequestDelivered(stored.id, {
    notified: notification.ok,
    linear: linear.ok ? linear.issue : null,
    linearError: linear.ok || linear.skipped ? null : linear.error,
  });

  revalidatePath("/support");
  return { ok: true, persisted: true, notified: notification.ok, reference };
}

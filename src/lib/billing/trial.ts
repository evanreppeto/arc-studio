import { type SupabaseClient } from "@supabase/supabase-js";

import { TRIAL_DAYS, trialEndsAtFrom } from "@/domain";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

// Trial write-side. The rules live in `src/domain/trial.ts`; this is the I/O.

export type StartTrialResult = { ok: boolean; startedAt?: string; endsAt?: string; reason?: string };

/**
 * Begin the free trial for a workspace, at creation time.
 *
 * Idempotent and **non-renewing**: if the org already has trial dates the
 * existing ones are kept. That is what makes "one trial per organization" true —
 * deleting and re-running onboarding, or any retry of workspace creation, can
 * never mint a fresh trial. The org_plans primary key is org_id, so there is
 * nowhere for a second trial to live.
 *
 * Best-effort by design: a failure here must not fail workspace creation. The
 * resolver treats a missing trial as `phase: "none"` (fully usable), so the
 * worst case is a workspace that isn't on a countdown — never one locked out.
 */
export async function startTrialForOrg(
  input: { orgId: string; now?: Date },
  client?: SupabaseClient,
): Promise<StartTrialResult> {
  const db = client ?? getSupabaseAdminClient();
  const startedAt = input.now ?? new Date();
  const endsAt = trialEndsAtFrom(startedAt);

  try {
    const { data: existing, error: readError } = await db
      .from("org_plans")
      .select("trial_started_at,trial_ends_at")
      .eq("org_id", input.orgId)
      .maybeSingle<{ trial_started_at: string | null; trial_ends_at: string | null }>();

    if (readError) return { ok: false, reason: readError.message };

    if (existing?.trial_started_at) {
      return {
        ok: true,
        startedAt: existing.trial_started_at,
        endsAt: existing.trial_ends_at ?? undefined,
        reason: "already_started",
      };
    }

    // Upsert rather than insert: an org may already have a plan row (e.g. a plan
    // assigned by hand before the workspace finished onboarding), and that row's
    // tier must survive.
    const { error } = await db.from("org_plans").upsert(
      {
        org_id: input.orgId,
        trial_started_at: startedAt.toISOString(),
        trial_ends_at: endsAt.toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id" },
    );
    if (error) return { ok: false, reason: error.message };

    return { ok: true, startedAt: startedAt.toISOString(), endsAt: endsAt.toISOString() };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "unknown" };
  }
}

/**
 * Record that a one-time trial notice has been emailed, so the warning job never
 * sends it twice. Appends without duplicating.
 */
export async function markTrialNoticeSent(
  input: { orgId: string; noticeKey: string },
  client?: SupabaseClient,
): Promise<{ ok: boolean; reason?: string }> {
  const db = client ?? getSupabaseAdminClient();
  try {
    const { data, error: readError } = await db
      .from("org_plans")
      .select("trial_notices_sent")
      .eq("org_id", input.orgId)
      .maybeSingle<{ trial_notices_sent: string[] | null }>();
    if (readError) return { ok: false, reason: readError.message };

    const current = data?.trial_notices_sent ?? [];
    if (current.includes(input.noticeKey)) return { ok: true };

    const { error } = await db
      .from("org_plans")
      .update({ trial_notices_sent: [...current, input.noticeKey], updated_at: new Date().toISOString() })
      .eq("org_id", input.orgId);
    return error ? { ok: false, reason: error.message } : { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "unknown" };
  }
}

export { TRIAL_DAYS };

import { NextResponse } from "next/server";

import { runTrialNotices } from "@/lib/billing/trial-notices";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Daily Vercel Cron entry for trial warnings + expiry notices.
 *
 * Mail only. It never changes a trial's dates or a workspace's access — expiry
 * is a function of the clock (`resolveTrialState`), not of this job running. A
 * missed cron therefore delays an email; it can never strand a customer in the
 * wrong access state in either direction.
 *
 * Authorized (CRON_SECRET), enabled (TRIAL_NOTICES_CRON_ENABLED=1), Supabase
 * configured. Off by default; fail-closed on auth.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorized = Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  if (!authorized) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  if (process.env.TRIAL_NOTICES_CRON_ENABLED !== "1") {
    return NextResponse.json({ ok: true, skipped: "disabled" });
  }
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ ok: true, skipped: "not_configured" });
  }

  const summary = await runTrialNotices();
  return NextResponse.json({ ok: true, ...summary });
}

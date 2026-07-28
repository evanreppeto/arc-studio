import { NextResponse } from "next/server";

import { runTrialNotices, runUsageNotices } from "@/lib/billing/billing-notices";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Daily Vercel Cron entry for billing mail: trial warnings + expiry, and usage
 * warnings at 80% / 100% of the monthly allowance.
 *
 * Mail only. It never changes a trial's dates or a workspace's access — expiry
 * is a function of the clock (`resolveTrialState`), not of this job running. A
 * missed cron therefore delays an email; it can never strand a customer in the
 * wrong access state in either direction.
 *
 * Authorized (CRON_SECRET), enabled (BILLING_NOTICES_CRON_ENABLED=1), Supabase
 * configured. Off by default; fail-closed on auth.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorized = Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  if (!authorized) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  if (process.env.BILLING_NOTICES_CRON_ENABLED !== "1") {
    return NextResponse.json({ ok: true, skipped: "disabled" });
  }
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ ok: true, skipped: "not_configured" });
  }

  // Trial mail first: a workspace whose trial just lapsed should get "your trial
  // ended" rather than a quota warning about an allowance it can't spend. The
  // usage pass skips read-only workspaces for the same reason.
  const trial = await runTrialNotices();
  const usage = await runUsageNotices();
  return NextResponse.json({ ok: true, trial, usage });
}

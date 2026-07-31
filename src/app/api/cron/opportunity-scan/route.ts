import { NextResponse } from "next/server";

import { formatAutoDraftLog, runScheduledAutoDraft, type AutoDraftRunSummary } from "@/lib/opportunities/auto-draft";
import { enqueueOpportunityScanTask } from "@/lib/opportunities/enqueue";
import { hasRecentOpportunityScan } from "@/lib/opportunities/recent-scan";
import { runOpportunityScanAcrossWorkspaces } from "@/lib/opportunities/fan-out";
import { type OpportunityScanSummary } from "@/lib/opportunities/scan";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const RECENT_HOURS = 20;

/**
 * Daily Vercel Cron entry. Three layers; the first two are read-only:
 *  1. The deterministic detectors (cold leads, weather, competitors, next-iteration
 *     campaign follow-ups) run every pass — cheap and idempotent (upsert dedup) — so
 *     opportunities refresh on schedule without an operator clicking "Scan".
 *  2. The generative Arc scan (finds what the detectors miss) is enqueued, deduped
 *     against a scan in the last RECENT_HOURS.
 *  3. Scheduled auto-drafting turns the top pending opportunities into
 *     approval-gated draft campaigns (OPPORTUNITY_AUTO_DRAFT_ENABLED=1, off by
 *     default). This is the only layer that writes campaign rows — it still sends
 *     nothing, and every draft lands in the same review queue as an
 *     operator-requested one.
 * Authorized (CRON_SECRET), enabled (OPPORTUNITY_SCAN_CRON_ENABLED=1), Supabase
 * configured. Off by default; fail-closed on auth.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorized = Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  if (!authorized) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  if (process.env.OPPORTUNITY_SCAN_CRON_ENABLED !== "1") {
    return NextResponse.json({ ok: true, skipped: "disabled" });
  }
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ ok: true, skipped: "not_configured" });
  }

  // Refresh deterministic opportunities for EVERY active workspace. This used to
  // call the scan directly, which relied on ambient tenant resolution — and a
  // session-less cron cannot resolve a tenant once a second active org exists, so
  // the whole pass would silently produce nothing for everyone (BSR-626).
  //
  // Still best-effort at the top level, but a single tenant's failure no longer
  // takes the pass down: the fan-out records and reports it and carries on.
  let deterministic: "ok" | "error" = "ok";
  // Carried into the response so a scheduled pass that rejects everything below
  // the confidence floor is visible in the cron log, not indistinguishable from
  // a pass that genuinely found nothing.
  let scan: OpportunityScanSummary = { added: 0, filtered: 0 };
  let fanOut: { workspaces: number; scanned: number; failed: number } = {
    workspaces: 0,
    scanned: 0,
    failed: 0,
  };
  try {
    const result = await runOpportunityScanAcrossWorkspaces();
    scan = { added: result.added, filtered: result.filtered };
    fanOut = { workspaces: result.workspaces, scanned: result.scanned, failed: result.failed };
    if (result.failed > 0) deterministic = "error";
  } catch {
    deterministic = "error";
  }

  // Draft the top pending opportunities. Runs on every pass — including one that
  // skips the generative scan as "recent" — because the backlog it drains was
  // built by earlier passes, not this one. Off unless
  // OPPORTUNITY_AUTO_DRAFT_ENABLED=1; best-effort so a drafting failure never
  // blocks the scan below.
  let autoDraft: AutoDraftRunSummary | { ran: false; error: string };
  try {
    autoDraft = await runScheduledAutoDraft();
  } catch (error) {
    autoDraft = { ran: false, error: error instanceof Error ? error.message : "auto-draft failed" };
  }
  // The response body is not visible in Vercel's cron view, so the plan a dry
  // run exists to produce would otherwise be unreadable.
  console.log(formatAutoDraftLog(autoDraft));

  if (await hasRecentOpportunityScan(RECENT_HOURS)) {
    return NextResponse.json({ ok: true, deterministic, scan, fanOut, autoDraft, skipped: "recent" });
  }

  const result = await enqueueOpportunityScanTask({ operator: "Scheduled scan" });
  return NextResponse.json({ ok: result.ok, deterministic, scan, fanOut, autoDraft, queued: result.ok, ...(result.error ? { error: result.error } : {}) });
}

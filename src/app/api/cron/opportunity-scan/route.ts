import { NextResponse } from "next/server";

// Every stage is reached through the fan-out now, so the single-tenant helpers
// (enqueue / recent-scan / auto-draft) are deliberately no longer imported here —
// calling one directly would reintroduce the ambient-tenant bug.
import { formatAutoDraftLog } from "@/lib/opportunities/auto-draft";
import { runOpportunityScanAcrossWorkspaces, type FanOutSummary } from "@/lib/opportunities/fan-out";
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

  // ONE pass per tenant, covering all three stages: deterministic detectors,
  // auto-draft, and the generative Arc scan (BSR-626).
  //
  // Every stage used to resolve its tenant from the ambient request. The cron has
  // no session, so each went through the resolver that deliberately REFUSES once a
  // second active org exists — and the refusals were swallowed or applied to a
  // single default tenant. Scope is now handed down and iterated.
  //
  // Dedup for the generative scan is per-tenant inside the fan-out, so one
  // workspace's recent scan can no longer suppress every other workspace's.
  let deterministic: "ok" | "error" = "ok";
  let scan: OpportunityScanSummary = { added: 0, filtered: 0 };
  let fanOut = { workspaces: 0, scanned: 0, failed: 0, generativeQueued: 0 };
  let results: FanOutSummary["results"] = [];
  try {
    const pass = await runOpportunityScanAcrossWorkspaces({
      autoDraft: true,
      generative: true,
      recentHours: RECENT_HOURS,
    });
    scan = { added: pass.added, filtered: pass.filtered };
    fanOut = {
      workspaces: pass.workspaces,
      scanned: pass.scanned,
      failed: pass.failed,
      generativeQueued: pass.generativeQueued,
    };
    results = pass.results;
    if (pass.failed > 0) deterministic = "error";
  } catch {
    deterministic = "error";
  }

  // The response body is not visible in Vercel's cron view, so the plan a dry run
  // exists to produce would otherwise be unreadable.
  for (const r of results) {
    if (r.autoDraft) console.log(`[${r.workspaceName}] ${formatAutoDraftLog(r.autoDraft)}`);
  }

  return NextResponse.json({ ok: deterministic === "ok", deterministic, scan, fanOut });

}

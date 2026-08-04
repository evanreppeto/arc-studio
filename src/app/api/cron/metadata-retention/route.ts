import { NextResponse } from "next/server";

import { runMetadataRetention } from "@/lib/arc-chat/metadata-retention";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Daily Vercel Cron: age out the payload attached to Arc messages older than 90
 * days (BSR-741).
 *
 * The message and its body survive; what is dropped is `recall`, `toolCalls`,
 * `steps` and the rest of the payload — where a census found customer contact
 * details in 41 of 126 rows. See `src/domain/metadata-retention.ts` for what is
 * kept and why it is an allowlist.
 *
 * Authorized (CRON_SECRET), enabled (METADATA_RETENTION_CRON_ENABLED=1),
 * Supabase configured. Off by default; fail-closed on auth.
 *
 * **`?dryRun=1` reports what it would prune without writing.** This deletes data
 * irreversibly and there is no undo, so the honest first run is a dry one — and
 * a scheduled run that has never been dry-run against real data is exactly the
 * kind of job that turns out to match more rows than anyone expected.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorized = Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  if (!authorized) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  if (process.env.METADATA_RETENTION_CRON_ENABLED !== "1") {
    return NextResponse.json({ ok: true, skipped: "disabled" });
  }
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ ok: true, skipped: "not_configured" });
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const result = await runMetadataRetention({ apply: !dryRun });
  return NextResponse.json({ ok: !result.error, ...result });
}

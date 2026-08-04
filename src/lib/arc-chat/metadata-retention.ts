import "server-only";

import {
  METADATA_RETENTION_DAYS,
  prunedMetadata,
  retentionCutoff,
} from "@/domain";
import { reportDegraded } from "@/lib/observability/report-degraded";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

/**
 * Age out the payload hung off old Arc messages (BSR-741).
 *
 * Deliberately org-agnostic: this selects by date across every workspace and
 * never infers a tenant. A session-less cron that resolves "the" org dies
 * silently the day a second active org exists — that pattern has already cost
 * this codebase a broken nightly, so there is no org parameter to get wrong.
 *
 * Batched and idempotent. `prunedMetadata` returns null for a row that is
 * already compliant, so a second pass writes nothing rather than rewriting
 * identical JSON and reporting work it did not do.
 */

export type RetentionResult = {
  /** Rows past the window that still had purgeable keys. */
  eligible: number;
  /** Rows actually written. Equals `eligible` unless `apply` was false. */
  pruned: number;
  applied: boolean;
  cutoff: string;
  error?: string;
};

const BATCH = 200;

export async function runMetadataRetention({
  now = new Date(),
  days = METADATA_RETENTION_DAYS,
  apply = false,
}: { now?: Date; days?: number; apply?: boolean } = {}): Promise<RetentionResult> {
  const cutoff = retentionCutoff(now, days);
  const base: RetentionResult = { eligible: 0, pruned: 0, applied: apply, cutoff: cutoff.toISOString() };

  if (!isSupabaseAdminConfigured()) return { ...base, error: "not_configured" };

  const supabase = getSupabaseAdminClient();
  let eligible = 0;
  let pruned = 0;

  try {
    for (let from = 0; ; from += BATCH) {
      const { data, error } = await supabase
        .from("arc_messages")
        .select("id, metadata")
        .lt("created_at", cutoff.toISOString())
        .not("metadata", "is", null)
        .order("created_at", { ascending: true })
        .range(from, from + BATCH - 1);
      if (error) throw new Error(error.message);

      const rows = (data ?? []) as { id: string; metadata: Record<string, unknown> | null }[];
      for (const row of rows) {
        const next = prunedMetadata(row.metadata);
        if (!next) continue;
        eligible += 1;
        if (!apply) continue;
        const { error: writeError } = await supabase
          .from("arc_messages")
          .update({ metadata: next as never })
          .eq("id", row.id);
        if (writeError) throw new Error(writeError.message);
        pruned += 1;
      }

      // Forward paging is safe because pruning does not shrink the result set:
      // a pruned row keeps `{mode, route}` and still matches `metadata IS NOT
      // NULL`, so offsets stay stable and `prunedMetadata` skips it as a no-op.
      // (Restarting from the top instead would spin forever on a full batch of
      // already-pruned rows.)
      if (rows.length < BATCH) break;
    }
  } catch (error) {
    reportDegraded(error, { scope: "arc-chat.metadataRetention", surface: "secondary" });
    return { ...base, eligible, pruned, error: (error as Error).message };
  }

  return { ...base, eligible, pruned };
}

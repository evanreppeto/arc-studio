/**
 * Guard for `{ count: "exact", head: true }` queries (BSR-575).
 *
 * A HEAD request to PostgREST for a **missing or inaccessible relation returns
 * no error** — supabase-js reports `{ count: null, error: null }`. So the
 * idiomatic `count ?? 0` turns a broken query into a confident zero:
 *
 *     const { count, error } = await client.from(t).select("id", { count: "exact", head: true });
 *     assertResult(t, error);   // error is null — never throws
 *     return count ?? 0;        // null ?? 0  →  0
 *
 * Verified against an isolated Supabase instance with the table renamed away.
 * Same client, same table, three shapes:
 *
 *     head: true              -> count=null, error=null      ← silent
 *     .select("id").limit(1)  -> error "Could not find the table …"
 *     count + head: false     -> error "Could not find the table …"
 *
 * That is why `getCrmNavCounts()` could not be made to fail across three forced
 * failures: nothing was wrong from its point of view.
 *
 * **`null` is never a legitimate count.** An empty table returns `0`. So
 * `count === null` always means the query did not run against what it named,
 * and treating it as a failure is safe everywhere — unlike the read `.catch`
 * sweep in BSR-546, this one needs no per-site judgement.
 */

export type CountResult = {
  count: number | null;
  error: { message?: string } | null;
};

/**
 * The count, or a thrown error naming what failed.
 *
 * @param label what was being counted — appears in the message, so make it the
 *              table or view name a reader could act on.
 */
export function requireCount(label: string, result: CountResult): number {
  if (result.error) {
    throw new Error(`${label} count failed: ${result.error.message ?? "unknown Supabase error"}`);
  }
  if (result.count === null) {
    // Not "zero rows" — an empty table counts 0. This is the HEAD-request blind
    // spot above: the relation is missing, renamed, or not visible to this role.
    throw new Error(
      `${label} count returned no result — the relation is missing or inaccessible. ` +
        `A HEAD count does not report that as an error (BSR-575).`,
    );
  }
  return result.count;
}

/**
 * Non-throwing variant for callers that genuinely tolerate an unknown count.
 * Returns `null` rather than `0`, so the caller must decide — it cannot silently
 * become a number that reads as fact.
 */
export function countOrNull(result: CountResult): number | null {
  if (result.error) return null;
  return result.count;
}

import type { AttributionRecord } from "@/domain/signup-attribution";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { attributionColumnValue } from "@/lib/signup-attribution/server";

export { isSupabaseAdminConfigured };

export type WaitlistPersistResult =
  | { ok: true; status: "created" | "exists" }
  | { ok: false; error: string };

const UNIQUE_VIOLATION = "23505";

// Idempotent: re-joining with an email that's already on the list succeeds
// with "exists" rather than erroring, so the form can always show success.
export async function persistWaitlistSignup(
  email: string,
  source: string,
  attribution: AttributionRecord | null = null,
): Promise<WaitlistPersistResult> {
  const supabase = getSupabaseAdminClient();
  // `attribution` is channel data only (see src/domain/signup-attribution.ts).
  // On the duplicate path below we deliberately do NOT overwrite the stored
  // record: the first submission's first-touch is the one worth keeping, and a
  // re-submit months later would otherwise rewrite history.
  const { error } = await supabase
    .from("waitlist_signups")
    .insert({ email, source, attribution: attributionColumnValue(attribution) });
  if (!error) return { ok: true, status: "created" };
  if (error.code === UNIQUE_VIOLATION) return { ok: true, status: "exists" };
  return { ok: false, error: error.message };
}

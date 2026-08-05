import { describeEmailSuppressionReason, labelEmailSuppressionReason } from "@/domain";

import { getCurrentOrgId } from "../auth/org";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "../supabase/server";

import { listEmailSuppressions, type SuppressionRow } from "./persistence";

/**
 * The operator's view of the suppression register (BSR-482).
 *
 * Before this existed, `contacts.email_unsubscribed_at` was read by exactly
 * three files, none of them a page — an operator had no way to see who had
 * opted out, let alone why, and no way to honor an opt-out someone gave over
 * the phone.
 *
 * Deliberately NOT resilient-to-empty: this read either succeeds or reports
 * `failed`. An empty list reads as "nobody has opted out", which would be a
 * false all-clear on a compliance surface (BSR-575).
 */

export type SuppressionEntry = SuppressionRow & {
  /** Short badge text, e.g. "Spam complaint". */
  reasonLabel: string;
  /** Full sentence for the row's detail line. */
  reasonDescription: string;
};

export type SuppressionView = {
  entries: SuppressionEntry[];
  /** Total rows in the org — may exceed `entries.length` when capped. */
  total: number;
  /** Set when the read failed; the panel says so instead of showing an empty list. */
  failed?: string;
};

/**
 * Newest first, capped. The cap is surfaced in the UI rather than silently
 * truncating — a register that says "12 suppressed" while holding 4,000 is the
 * kind of quiet lie this codebase keeps finding.
 */
const LIST_CAP = 500;

export async function getSuppressionView(): Promise<SuppressionView | null> {
  if (!isSupabaseAdminConfigured()) return null;
  const orgId = await getCurrentOrgId();
  if (!orgId) return null;

  const { rows, total } = await listEmailSuppressions({ orgId, limit: LIST_CAP }, getSupabaseAdminClient());
  return {
    entries: rows.map((row) => ({
      ...row,
      reasonLabel: labelEmailSuppressionReason(row.reason),
      reasonDescription: describeEmailSuppressionReason(row.reason),
    })),
    total,
  };
}

import { type SupabaseClient } from "@supabase/supabase-js";

import {
  describeSuppressedSend,
  isEmailSuppressionReason,
  normalizeEmailAddress,
  type EmailSuppressionReason,
} from "@/domain";

/**
 * The I/O half of the email suppression register (BSR-482).
 *
 * Reads and writes `email_suppressions`, plus the `contacts.email_unsubscribed_at`
 * denormalization that predates it. Every write goes to BOTH: the table is the
 * authority (address-keyed, carries a reason), the column stays because
 * `contacts_emailable_idx` is a partial index on it and the CRM reads it as the
 * contact-level flag.
 *
 * There is deliberately no "unsuppress" function. Removing someone from this
 * register means emailing a person who asked not to be emailed, and an operator
 * who genuinely needs that (a wrong entry, a re-consented customer) should have
 * to go through a deliberate path rather than a button next to a list. If that
 * turns out to be needed, it wants its own ticket and its own audit trail.
 */

export type SuppressionCheck = { suppressed: boolean; reason?: string };

const HELD =
  "Could not verify the recipient's email consent, so the send was held.";

/**
 * Whether this send must be refused.
 *
 * Checks BOTH keys, because either alone leaks:
 *
 *   * by address — survives a contact re-import, catches a duplicate contact row
 *     sharing the mailbox, and is the only key a provider bounce gives us;
 *   * by contact id — covers a suppressed contact whose address is missing or
 *     has since been edited, and carries the `do_not_contact` status.
 *
 * Fails CLOSED. A lookup error reports suppressed, because mailing someone who
 * opted out is worse than holding a send that a retry will deliver. This is load
 * -bearing and tested — do not "fix" it into a permissive default.
 */
export async function checkEmailSuppression(
  input: { orgId: string; contactId: string | null; address?: string | null },
  client: SupabaseClient,
): Promise<SuppressionCheck> {
  const address = normalizeEmailAddress(input.address);

  try {
    if (input.orgId && address) {
      const { data, error } = await client
        .from("email_suppressions")
        .select("reason")
        .eq("org_id", input.orgId)
        .eq("email", address)
        .maybeSingle<{ reason: string }>();
      if (error) return { suppressed: true, reason: HELD };
      // Keyed on the reason being present rather than on the row being truthy:
      // `reason` is NOT NULL in the schema, so a row always has one, and reading
      // the field means an unexpected shape (an empty array from a loose client
      // or stub) can't read as a suppression that isn't there.
      if (data?.reason) {
        const reason = isEmailSuppressionReason(data.reason) ? data.reason : "manual";
        return { suppressed: true, reason: describeSuppressedSend(reason) };
      }
    }

    if (!input.contactId) return { suppressed: false };

    // Org-scoped even though the id is a UUID primary key: this runs on the
    // RLS-bypassing admin client, and it was the only query in the send path
    // that omitted the scope its neighbours all carry.
    let query = client
      .from("contacts")
      .select("email_unsubscribed_at,status")
      .eq("id", input.contactId);
    if (input.orgId) query = query.eq("org_id", input.orgId);

    const { data, error } = await query.maybeSingle<{
      email_unsubscribed_at: string | null;
      status: string | null;
    }>();
    if (error) return { suppressed: true, reason: HELD };
    if (data?.email_unsubscribed_at) {
      return { suppressed: true, reason: describeSuppressedSend("unsubscribe") };
    }
    // `do_not_contact` is checked at list-build too, but only there — so an
    // operator who marked someone do-not-contact AFTER the dispatch was queued
    // still had the mail go out. Re-checking here closes that window.
    //
    // Only this status, not `inactive`/`archived`: those are lifecycle states a
    // campaign may legitimately re-engage, whereas do-not-contact is an explicit
    // instruction.
    if (data?.status === "do_not_contact") {
      return {
        suppressed: true,
        reason: "This contact is marked do-not-contact, so nothing was sent.",
      };
    }
    return { suppressed: false };
  } catch {
    return { suppressed: true, reason: HELD };
  }
}

/**
 * Every suppressed address in the org, for list-build.
 *
 * Returned as a Set so audience resolution stays pure and synchronous — the
 * resolver takes the set, not a client.
 *
 * Fails CLOSED in spirit but not in shape: on error it THROWS rather than
 * returning an empty set, because an empty set reads as "nobody is suppressed"
 * and would quietly build an audience containing every opted-out address. The
 * callers turn that into a visible failure.
 */
export async function loadSuppressedAddresses(
  orgId: string,
  client: SupabaseClient,
): Promise<Set<string>> {
  if (!orgId) return new Set();
  const { data, error } = await client
    .from("email_suppressions")
    .select("email")
    .eq("org_id", orgId);
  if (error) throw new Error(`email_suppressions lookup: ${error.message}`);
  return new Set((data ?? []).map((row: { email: string }) => normalizeEmailAddress(row.email)));
}

export type RecordSuppressionInput = {
  orgId: string;
  address: string | null | undefined;
  reason: EmailSuppressionReason;
  /** 'recipient', 'resend', or an operator's name. */
  source: string;
  detail?: string | null;
  contactId?: string | null;
};

export type RecordSuppressionResult = { ok: true; recorded: boolean } | { ok: false; error: string };

/**
 * Add an address to the register, and mirror it onto the contact.
 *
 * Idempotent on (org_id, email): a second complaint, or Gmail firing one-click
 * twice, must not move the original timestamp or fail the caller. The mirror
 * write is likewise `is null`-guarded.
 *
 * A missing address is not an error — a bounce we cannot key by address still
 * suppresses the contact, which is better than suppressing nothing.
 */
export async function recordEmailSuppression(
  input: RecordSuppressionInput,
  client: SupabaseClient,
): Promise<RecordSuppressionResult> {
  const address = normalizeEmailAddress(input.address);
  if (!input.orgId) return { ok: false, error: "recordEmailSuppression: orgId is required." };
  if (!address && !input.contactId) return { ok: true, recorded: false };

  if (address) {
    const { error } = await client.from("email_suppressions").upsert(
      {
        org_id: input.orgId,
        email: address,
        reason: input.reason,
        source: input.source,
        detail: input.detail ?? null,
        contact_id: input.contactId ?? null,
      },
      { onConflict: "org_id,email", ignoreDuplicates: true },
    );
    if (error) return { ok: false, error: `email_suppressions upsert: ${error.message}` };
  }

  if (input.contactId) {
    const { error } = await client
      .from("contacts")
      .update({ email_unsubscribed_at: new Date().toISOString() })
      .eq("id", input.contactId)
      .eq("org_id", input.orgId)
      .is("email_unsubscribed_at", null);
    // A failed mirror is not fatal: the register above is the authority, and the
    // send gate reads it first. Reported so it doesn't vanish.
    if (error) return { ok: false, error: `contacts mirror update: ${error.message}` };
  }

  return { ok: true, recorded: true };
}

export type SuppressionRow = {
  id: string;
  email: string;
  reason: EmailSuppressionReason;
  source: string;
  detail: string | null;
  createdAt: string;
  contactId: string | null;
};

/**
 * The operator register. `search` matches the address; the reason is shown
 * rather than filtered on, because the list is short enough that a filter would
 * be chrome.
 */
export async function listEmailSuppressions(
  input: { orgId: string; search?: string | null; limit?: number },
  client: SupabaseClient,
): Promise<{ rows: SuppressionRow[]; total: number }> {
  if (!input.orgId) return { rows: [], total: 0 };

  const search = normalizeEmailAddress(input.search);
  let query = client
    .from("email_suppressions")
    .select("id,email,reason,source,detail,created_at,contact_id", { count: "exact" })
    .eq("org_id", input.orgId)
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 100);
  if (search) query = query.ilike("email", `%${search}%`);

  const { data, error, count } = await query;
  // The read-model must not degrade a failure into "nobody is suppressed" — a
  // green empty list here reads as a clean bill of health (BSR-575).
  if (error) throw new Error(`email_suppressions list: ${error.message}`);

  const rows = (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    email: String(row.email),
    reason: (isEmailSuppressionReason(String(row.reason)) ? String(row.reason) : "manual") as EmailSuppressionReason,
    source: String(row.source ?? "system"),
    detail: (row.detail as string | null) ?? null,
    createdAt: String(row.created_at),
    contactId: (row.contact_id as string | null) ?? null,
  }));
  return { rows, total: count ?? rows.length };
}

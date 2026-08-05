/**
 * Pure rules for the email suppression register (BSR-482).
 *
 * Suppression used to be one nullable column keyed by contact id, which meant it
 * could not survive a re-import, could not be set by a provider event that only
 * knows an address, and could not explain itself to an operator. This module
 * owns the address normalization and the vocabulary; `email_suppressions` is the
 * store and `src/lib/dispatch/email-identity.ts` is the I/O.
 *
 * No I/O here on purpose — the normalization in particular has to be callable
 * from the audience resolver, which is pure and heavily unit-tested.
 */

/**
 * The one true address normalization.
 *
 * MUST stay identical to how `resolveCampaignAudience` normalizes an address, or
 * a suppressed address slips past on a case difference: the resolver would emit
 * `Sam@Example.com` while the register holds `sam@example.com`, and the
 * membership test silently misses. That is the whole failure mode this ticket
 * exists to close, so it is a shared function rather than two `.toLowerCase()`
 * calls that happen to agree today.
 *
 * Deliberately NOT doing provider-specific canonicalization (stripping Gmail
 * dots, cutting `+tags`): those are different mailboxes at some providers, and
 * over-normalizing would suppress people who never opted out.
 */
export function normalizeEmailAddress(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export const EMAIL_SUPPRESSION_REASONS = ["unsubscribe", "bounce", "complaint", "manual"] as const;
export type EmailSuppressionReason = (typeof EMAIL_SUPPRESSION_REASONS)[number];

export function isEmailSuppressionReason(value: string): value is EmailSuppressionReason {
  return (EMAIL_SUPPRESSION_REASONS as readonly string[]).includes(value);
}

/**
 * The operator-facing "why". The ticket requires the suppression list to explain
 * itself, and "bounce" alone doesn't tell someone whether to fix the address or
 * leave it alone.
 */
export function describeEmailSuppressionReason(reason: EmailSuppressionReason): string {
  switch (reason) {
    case "unsubscribe":
      return "They unsubscribed from your emails.";
    case "bounce":
      return "The mailbox rejected delivery permanently — the address is wrong or gone.";
    case "complaint":
      return "They marked an email as spam.";
    case "manual":
      return "Someone on your team added them by hand.";
  }
}

/** Short label for a dense list, where the full sentence is too long. */
export function labelEmailSuppressionReason(reason: EmailSuppressionReason): string {
  switch (reason) {
    case "unsubscribe":
      return "Unsubscribed";
    case "bounce":
      return "Hard bounce";
    case "complaint":
      return "Spam complaint";
    case "manual":
      return "Added by hand";
  }
}

/**
 * The message a blocked send shows. Phrased for an operator looking at a failed
 * dispatch, so it says what happened and implies that it was correct.
 */
export function describeSuppressedSend(reason: EmailSuppressionReason): string {
  switch (reason) {
    case "unsubscribe":
      return "This recipient unsubscribed, so nothing was sent.";
    case "bounce":
      return "This address hard-bounced previously, so nothing was sent.";
    case "complaint":
      return "This recipient reported a previous email as spam, so nothing was sent.";
    case "manual":
      return "This address is on your suppression list, so nothing was sent.";
  }
}

/**
 * Whether a provider bounce is permanent.
 *
 * Resend forwards SES-style classifications. Only `Permanent` earns a
 * suppression: a `Transient` bounce is a full mailbox or a greylisting rollout,
 * and suppressing on it would permanently drop a reachable customer over one bad
 * afternoon. `Undetermined` is treated as transient for the same reason — an
 * ambiguous signal should not be irreversible when the cost of waiting is one
 * more retry and the cost of acting is a lost recipient.
 */
export function isPermanentBounce(bounceType: string | null | undefined): boolean {
  return (bounceType ?? "").trim().toLowerCase() === "permanent";
}

import { type Contact } from "./contacts";

/**
 * The minimal contact projection recipient resolution needs. A full CRM `Contact`
 * satisfies it structurally, so callers can pass either — but the I/O layer can
 * also select just these columns instead of hydrating the whole row.
 */
export type AudienceContact = Pick<
  Contact,
  "id" | "persona" | "status" | "email" | "phone" | "fullName" | "companyId"
> & {
  /**
   * When this contact opted out of email. Optional so a full `Contact` still
   * satisfies the type structurally — but the I/O layer must select it, or every
   * unsubscribed contact resolves as a recipient (BSR-482).
   */
  emailUnsubscribedAt?: string | null;
};

/**
 * Pure, deterministic audience resolution for a campaign send.
 *
 * Given a campaign's targeting (persona + optional specific contact/company) and
 * a candidate set of CRM contacts, resolve WHO an approved campaign would reach
 * on a given channel — filtering out anyone who is suppressed, opted out, or
 * un-reachable on that channel, and de-duplicating by address.
 *
 * No I/O: the caller (a `src/lib` layer) queries the candidate contacts,
 * org-scoped; this module owns the rules. It NEVER sends anything — it only
 * decides the recipient set that a later dispatch producer will queue.
 *
 * The three suppression signals are all first-class in the schema:
 * `contact_status` = do_not_contact / inactive / archived, plus a missing or
 * malformed channel address. Everything is reason-tagged so the Outbox can show
 * "N reached, M suppressed (why)".
 */

export type AudienceChannel = "email" | "sms";

/** Campaign targeting, projected to just what recipient resolution needs. */
export type CampaignAudienceTarget = {
  /** The campaign's primary persona (persona_mapping). */
  persona: string;
  /** When set, the campaign targets exactly this contact (1:1) — persona/company are ignored. */
  contactId?: string | null;
  /** When set (and no contactId), narrows the persona audience to this company's contacts. */
  companyId?: string | null;
  /** Contacts explicitly added to the campaign (operator-picked, e.g. bulk "Add to
   *  campaign" on the CRM board). They qualify regardless of persona — but still
   *  pass suppression + address checks in the resolver. */
  manualContactIds?: readonly string[];
};

export type SuppressionReason =
  | "status_do_not_contact"
  | "status_inactive"
  | "status_archived"
  | "unsubscribed"
  | "missing_email"
  | "invalid_email"
  | "missing_phone"
  | "duplicate";

/** Plain-English reason, for the Outbox and the external-send preview. */
export function describeAudienceSuppression(reason: SuppressionReason): string {
  switch (reason) {
    case "status_do_not_contact":
      return "marked do-not-contact";
    case "status_inactive":
      return "inactive";
    case "status_archived":
      return "archived";
    case "unsubscribed":
      return "unsubscribed or bounced";
    case "missing_email":
      return "no email address";
    case "invalid_email":
      return "malformed email address";
    case "missing_phone":
      return "no phone number";
    case "duplicate":
      return "duplicate address";
  }
}

/** Counts by reason, so a preview can say WHICH kind of suppression it hit. */
export function summarizeSuppressions(
  suppressed: readonly SuppressedRecipient[],
): Array<{ reason: SuppressionReason; count: number }> {
  const counts = new Map<SuppressionReason, number>();
  for (const entry of suppressed) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  return [...counts.entries()].map(([reason, count]) => ({ reason, count }));
}

export type ResolvedRecipient = {
  contactId: string;
  /** Normalized send address for the channel (lowercased email, or phone). */
  address: string;
  fullName: string | null;
  persona: string;
  companyId: string | null;
};

export type SuppressedRecipient = {
  contactId: string;
  reason: SuppressionReason;
};

export type AudienceResolution = {
  channel: AudienceChannel;
  recipients: ResolvedRecipient[];
  suppressed: SuppressedRecipient[];
  /** Recipients who will receive the send. */
  eligibleCount: number;
  /** Candidates dropped for any reason (suppression + un-reachable + duplicate). */
  suppressedCount: number;
  /** Compact human summary for the Outbox, e.g. "12 recipients · 3 suppressed". */
  summary: string;
};

// Pragmatic email shape check — one @, a dotted domain, no whitespace. Deliberately
// permissive: real bounce handling belongs to the provider, not this gate.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function suppressionForStatus(status: AudienceContact["status"]): SuppressionReason | null {
  switch (status) {
    case "do_not_contact":
      return "status_do_not_contact";
    case "inactive":
      return "status_inactive";
    case "archived":
      return "status_archived";
    case "active":
      return null;
    default:
      // Unknown status is treated as un-sendable rather than silently included.
      return "status_inactive";
  }
}

export type AudienceOptions = {
  /**
   * Every suppressed address in the org, normalized — from `email_suppressions`.
   * Omitted only where there is genuinely no client to load it (pure tests);
   * a production caller that omits it silently loses the address-keyed half of
   * suppression, which is the half that survives a contact re-import.
   */
  suppressedAddresses?: ReadonlySet<string>;
};

function isEmailSuppressed(
  contact: AudienceContact,
  address: string,
  suppressedAddresses: ReadonlySet<string> | undefined,
): boolean {
  if (contact.emailUnsubscribedAt) return true;
  return Boolean(suppressedAddresses?.has(address));
}

/** Is this contact in the campaign's candidate set (before eligibility filtering)? */
function isCandidate(contact: AudienceContact, target: CampaignAudienceTarget): boolean {
  // Operator-picked contacts always qualify (persona-agnostic); they still go
  // through suppression + address validity below.
  if (target.manualContactIds?.includes(contact.id)) return true;
  if (target.contactId) return contact.id === target.contactId;
  if (contact.persona !== target.persona) return false;
  if (target.companyId && contact.companyId !== target.companyId) return false;
  return true;
}

/**
 * Resolve the recipient set for an approved campaign on one channel.
 * Deterministic: input order is preserved, and de-dup keeps the first address seen.
 */
export function resolveCampaignAudience(
  target: CampaignAudienceTarget,
  contacts: readonly AudienceContact[],
  channel: AudienceChannel = "email",
  options: AudienceOptions = {},
): AudienceResolution {
  const recipients: ResolvedRecipient[] = [];
  const suppressed: SuppressedRecipient[] = [];
  const seenAddresses = new Set<string>();

  for (const contact of contacts) {
    if (!isCandidate(contact, target)) continue;

    const statusReason = suppressionForStatus(contact.status);
    if (statusReason) {
      suppressed.push({ contactId: contact.id, reason: statusReason });
      continue;
    }

    const address = resolveAddress(contact, channel);
    if (address.reason) {
      suppressed.push({ contactId: contact.id, reason: address.reason });
      continue;
    }

    // Consent, checked HERE and not only at send time. It was previously send-time
    // only, which meant unsubscribed contacts were still enqueued as dispatches
    // (dying one by one at the gate) and — the real leak — still appeared in the
    // external-send CSV an operator pastes into their own ESP, where our gate
    // does not run at all.
    //
    // Two keys because either alone misses: the per-contact flag, and the
    // org-wide address register that survives a re-import.
    if (channel === "email" && isEmailSuppressed(contact, address.value, options.suppressedAddresses)) {
      suppressed.push({ contactId: contact.id, reason: "unsubscribed" });
      continue;
    }

    if (seenAddresses.has(address.value)) {
      suppressed.push({ contactId: contact.id, reason: "duplicate" });
      continue;
    }
    seenAddresses.add(address.value);

    recipients.push({
      contactId: contact.id,
      address: address.value,
      fullName: contact.fullName,
      persona: contact.persona,
      companyId: contact.companyId,
    });
  }

  const eligibleCount = recipients.length;
  const suppressedCount = suppressed.length;
  return {
    channel,
    recipients,
    suppressed,
    eligibleCount,
    suppressedCount,
    summary: buildSummary(eligibleCount, suppressedCount),
  };
}

type AddressResult = { value: string; reason: null } | { value: null; reason: SuppressionReason };

function resolveAddress(contact: AudienceContact, channel: AudienceChannel): AddressResult {
  if (channel === "sms") {
    const phone = (contact.phone ?? "").trim();
    if (!phone) return { value: null, reason: "missing_phone" };
    return { value: normalizePhone(phone), reason: null };
  }
  const email = (contact.email ?? "").trim();
  if (!email) return { value: null, reason: "missing_email" };
  if (!EMAIL_RE.test(email)) return { value: null, reason: "invalid_email" };
  return { value: email.toLowerCase(), reason: null };
}

// Loose E.164-ish normalization: strip formatting so "(312) 555-0100" and
// "312-555-0100" de-dupe to the same address. Not a validity check.
function normalizePhone(phone: string): string {
  const trimmed = phone.replace(/[\s().-]/g, "");
  return trimmed.startsWith("+") ? `+${trimmed.slice(1).replace(/\D/g, "")}` : trimmed.replace(/\D/g, "");
}

function buildSummary(eligible: number, suppressed: number): string {
  const recips = `${eligible} ${eligible === 1 ? "recipient" : "recipients"}`;
  return suppressed > 0 ? `${recips} · ${suppressed} suppressed` : recips;
}

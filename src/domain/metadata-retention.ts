/**
 * How long Arc keeps the payload attached to a message (BSR-741).
 *
 * A census of prod found customer contact details spread through
 * `arc_messages.metadata`: 41 of 126 messages carried a phone number, mostly via
 * `recall` — the Brain quoted back into a reply. #905 redacted that at render.
 * This bounds how long it is stored at all.
 *
 * ## What this does and does not touch
 *
 * The message survives. Its `body` — the question and Arc's answer — is the
 * conversation, and deleting it at 90 days would destroy history a customer
 * still expects to scroll back through. What ages out is the payload hung off
 * it: recalled memories, tool inputs and outputs, step traces, action cards.
 *
 * The Brain itself (`knowledge_nodes`) is untouched. Ageing out Arc's memory is
 * a different decision with a different cost — it makes Arc dumber, where this
 * only makes an old run less inspectable — and it needs its own call.
 *
 * ## Why an allowlist rather than a list of keys to purge
 *
 * A purge-list quietly stops covering anything added after it was written, which
 * is the same silent-hole failure this codebase keeps hitting. Naming what is
 * KEPT means a new metadata key is purged by default, and someone who wants it
 * retained has to say so here — the safe direction for a retention rule.
 *
 * Pure — no I/O, no dates resolved here; the caller passes `now`.
 */

/** Days a message keeps its payload. */
export const METADATA_RETENTION_DAYS = 90;

/**
 * Keys kept past the window. Deliberately tiny: both are short scalars with no
 * customer data in them, and keeping them means an old run's header still reads
 * "Answering a question · Standard model" instead of losing its kicker entirely.
 */
export const RETAINED_METADATA_KEYS = ["mode", "route"] as const;

export function retentionCutoff(now: Date, days: number = METADATA_RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/**
 * What a row's metadata becomes once it is past the window, or null when it is
 * already compliant.
 *
 * Returning null for a no-op is what makes the job idempotent: a second run over
 * the same rows finds nothing to write, rather than rewriting identical JSON and
 * reporting work it did not do.
 */
export function prunedMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null;
  const keys = Object.keys(metadata);
  const purgeable = keys.filter((key) => !(RETAINED_METADATA_KEYS as readonly string[]).includes(key));
  if (purgeable.length === 0) return null;

  const kept: Record<string, unknown> = {};
  for (const key of RETAINED_METADATA_KEYS) {
    if (key in metadata) kept[key] = metadata[key];
  }
  return kept;
}

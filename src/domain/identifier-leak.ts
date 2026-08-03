/**
 * Does this rendered string look like something the database stores rather than
 * something a person wrote? (BSR-709)
 *
 * Three times now a stored value has reached customers verbatim: `wired ·
 * media_assets` (BSR-655), `needs_review` under every pipeline stage, and
 * `complete` / `crm_lead` / `mcp__arc__search_contacts` on the run page
 * (BSR-693). Each was found by a person reading the screen, after it shipped.
 *
 * Source scanners cannot catch the general case, and the reason is decisive:
 *
 *     media_assets.kind    = "image"     ← a perfectly good word
 *     knowledge_nodes.kind = "crm_lead"  ← a leak
 *
 * Identical source, opposite verdicts. The difference is the *value*, which only
 * exists at runtime — so the check has to look at rendered text, and this module
 * is the part of it that can be tested without a browser.
 *
 * Deliberately conservative. A false positive costs someone an allowlist entry
 * and teaches them to distrust the check; a false negative costs one more
 * instance of a bug we already ship regularly. When unsure, stay quiet.
 *
 * ## The limit of a text-only check
 *
 * It cannot tell OUR identifier from the CUSTOMER's. A company called
 * `acme_corp` or a persona a tenant named `after_hours_emergency` is data we
 * display, not vocabulary we chose, and this will warn about both. Filenames are
 * exempted below because they were the first case to hit — the Library lists
 * uploads verbatim — but the general problem has no textual solution.
 *
 * The answer for those is `data-identifiers-ok` on the element that renders
 * customer-entered text. Preferring an explicit per-region opt-out over a
 * cleverer regex is the point: the regex would have to get quieter to be right,
 * and a quieter check finds fewer of the bugs it exists for.
 *
 * Pure — no DOM, no I/O.
 */

/**
 * Shapes that are identifiers in any codebase, and that a person writing UI copy
 * would never produce.
 */
const IDENTIFIER_SHAPES: { name: string; pattern: RegExp }[] = [
  // Protocol-prefixed tool names: mcp__arc__search_contacts.
  { name: "MCP tool name", pattern: /\bmcp__\w+/ },
  // snake_case with at least two segments: needs_review, crm_lead, proof_point.
  // Requires lowercase both sides so CONSTANT_CASE and Mixed_Case fall to the
  // rules below rather than matching here twice.
  { name: "snake_case", pattern: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/ },
  // SCREAMING_SNAKE: ARC_AGENT_API_TOKEN.
  { name: "CONSTANT_CASE", pattern: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/ },
];

/**
 * Text that legitimately contains one of the shapes above.
 *
 * Every entry needs a reason. An allowlist that grows without justification is
 * how a guard stops meaning anything.
 */
const ALLOWED: { pattern: RegExp; why: string }[] = [
  // Env var names are the subject of the sentence on the health/system screens —
  // an operator is being told which variable to set.
  { pattern: /\b(SUPABASE|ARC|OPERATOR|NEXT_PUBLIC|RESEND|LINEAR|GOOGLE|HUBSPOT|VERCEL)_[A-Z0-9_]+\b/, why: "env var named as the thing to configure" },
  // Anything carrying a file extension is a filename, and filenames are usually
  // the CUSTOMER's — the Library lists uploads verbatim (`midjourney_grid_03.png`,
  // `canva_export_banner.png`). Their naming is data we display, not vocabulary
  // we chose, and warning about it would send someone to "fix" a customer's file.
  {
    pattern: /\.(png|jpe?g|gif|svg|webp|avif|mp4|mov|webm|pdf|csv|tsv|xlsx?|docx?|zip|ts|tsx|js|jsx|css|sql|json|md|txt)\b/i,
    why: "filename — customer uploads and source files both land here",
  },
];

export type IdentifierLeak = {
  /** The offending substring, not the whole text node. */
  match: string;
  /** Which shape matched, for the warning message. */
  shape: string;
};

/**
 * The offending fragment, or null when the text reads like language.
 *
 * Only the first match is reported: one warning per text node is enough to send
 * someone to the right line, and a node with two identifiers in it is one bug.
 */
export function findIdentifierLeak(text: string): IdentifierLeak | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // A URL or an email is full of dots and underscores and is not our plumbing.
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return null;
  if (/\S+@\S+\.\S+/.test(trimmed)) return null;

  for (const { pattern, why } of ALLOWED) {
    void why;
    if (pattern.test(trimmed)) return null;
  }

  for (const { name, pattern } of IDENTIFIER_SHAPES) {
    const found = trimmed.match(pattern);
    if (found) return { match: found[0], shape: name };
  }
  return null;
}

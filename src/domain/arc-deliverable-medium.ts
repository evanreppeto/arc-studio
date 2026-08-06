/**
 * What kind of thing a deliverable IS, so a surface can render it as that.
 *
 * The first pass at inline deliverables rendered every channel as the same box:
 * a title, an uppercase label column, and a paragraph. An SMS and a landing page
 * came out identical, and an email's actual subject line — the one piece of copy
 * a reviewer reads first — was demoted to a row in what looked like a database
 * table while a label Arc invented for the asset took the headline slot.
 *
 * A deliverable should look like the medium it will ship in. That needs one
 * classification, derived from the strings the workspace already uses, and it
 * has to stay tenant-agnostic: `channel` is free text written by the runner
 * (prod holds `email`, `sms`, `doc`, `web`, `meta_ad`, and the display forms
 * "Email", "Paid social", "Landing page", "One-pager"), so this matches on
 * substrings rather than an enum nobody enforces.
 *
 * `generic` is a real answer, not a failure: an unrecognised channel renders as
 * plain prose, which is always readable. Guessing wrong is worse than not
 * guessing — a doc rendered as a phone bubble is a lie about what will ship.
 */
export type ArcDeliverableMedium = "email" | "sms" | "social" | "page" | "doc" | "generic";

/**
 * Order matters. `landing page` contains "page" and `one-pager` contains "page"
 * too, so the more specific tests run first; and "ad" is checked as a whole word
 * because it is a substring of a great many ordinary words.
 */
export function arcDeliverableMedium(input: { channel?: string | null; format?: string | null }): ArcDeliverableMedium {
  const haystack = `${input.channel ?? ""} ${input.format ?? ""}`.toLowerCase();
  if (!haystack.trim()) return "generic";

  if (/\bemail\b|newsletter|\bmail\b/.test(haystack)) return "email";
  if (/\bsms\b|text message|\bmms\b/.test(haystack)) return "sms";
  // Before `page`: a one-pager is a document, not a landing page.
  if (/one[\s-]?pager|\bpdf\b|\bdoc\b|document|handoff|brief|\bnote\b/.test(haystack)) return "doc";
  if (/social|\bads?\b|meta|instagram|facebook|linkedin|\bx\b|tiktok|paid/.test(haystack)) return "social";
  if (/landing|\bpage\b|\bweb\b|site|hero/.test(haystack)) return "page";
  return "generic";
}

/** How a medium's copy should be laid out — used by the CSS, kept here so the
 *  component doesn't re-derive it. */
export const ARC_MEDIUM_LABEL: Record<ArcDeliverableMedium, string> = {
  email: "Email",
  sms: "Text message",
  social: "Social ad",
  page: "Landing page",
  doc: "Document",
  generic: "Draft",
};

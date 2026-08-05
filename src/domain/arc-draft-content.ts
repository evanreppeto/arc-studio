/**
 * Reading a drafted deliverable, rather than pointing at one.
 *
 * The Arc chat used to render an approval-gated draft as a one-line receipt and
 * send the operator to a 390px rail to read it. Rendering the draft in the
 * conversation means the copy has to arrive as something a card can lay out —
 * a subject that looks like a subject, a body that looks like prose — and what
 * the runner actually stores in `campaign_assets.*_body` is a single text blob
 * with the metadata written as labelled lead-in lines:
 *
 *     SUBJECT: A quick pre-winter check for your pipes and water heater
 *     PREHEADER: Pick a time that works — our Chicago crew handles the rest.
 *
 *     Hi {{first_name}},
 *     …
 *
 * The shape varies by channel and by run — verified against prod: emails use
 * both `SUBJECT:` and `Subject:`, sometimes with a blank line between the two
 * labels and sometimes not; landing pages use `H1:` / `Subhead:`; social ads use
 * `Headline:` / `Primary text:`, occasionally behind a `Platform:` line, and
 * occasionally with the value on the NEXT line rather than after the colon.
 *
 * So the labels are an ALLOWLIST, not a `^\w+:` regex. That regex is the obvious
 * implementation and it is wrong on real rows: a stored SMS opens
 * `Big Shoulders Restoration: If last week's flooding reached your home…`, and a
 * generic matcher lifts the workspace's own brand name out of the message and
 * relabels the rest as a field value. An unknown label stays in the body, which
 * renders as prose — the failure mode is "this reads as ordinary copy", not
 * "this deliverable has been rewritten by the parser".
 */

/** A labelled lead-in line lifted off the top of a draft body. */
export type ArcDraftField = { label: string; value: string };

export type ArcDraftContent = {
  /** The lead-in labels, in the order the draft wrote them. */
  fields: ArcDraftField[];
  /** Everything after the lead-in — the copy itself. */
  body: string;
  /** The headline field a card should lead with, if the draft carries one. */
  headline: string | null;
};

/**
 * Labels the runner writes as lead-in lines. Matched case-insensitively on a
 * whitespace-normalised label, so `PRIMARY TEXT:` and `Primary text:` are one
 * entry. Anything not here is copy.
 */
const KNOWN_LABELS = new Map<string, string>([
  ["subject", "Subject"],
  ["subject line", "Subject"],
  ["preheader", "Preheader"],
  ["preview text", "Preheader"],
  ["h1", "Headline"],
  ["headline", "Headline"],
  ["subhead", "Subhead"],
  ["subheading", "Subhead"],
  ["primary text", "Primary text"],
  ["platform", "Platform"],
  ["cta", "Call to action"],
  ["call to action", "Call to action"],
  ["title", "Title"],
]);

/** Which labels can lead a card, best first. A subject beats a platform note. */
const HEADLINE_PRIORITY = ["Subject", "Headline", "Title", "Subhead"];

/** `LABEL: value` — the label side is deliberately narrow (letters, digits,
 *  spaces) so prose with a colon in it can't present as a label. */
const LABEL_LINE = /^([A-Za-z][A-Za-z0-9 ]{0,23}):[ \t]*(.*)$/;

function normalizeLabel(raw: string): string | null {
  return KNOWN_LABELS.get(raw.trim().toLowerCase().replace(/\s+/g, " ")) ?? null;
}

/**
 * Split a stored draft body into its lead-in fields and its copy.
 *
 * Only leading lines are considered, and scanning stops at the first line that
 * is neither blank nor a known label — a `Subject:` written halfway down a
 * one-pager is that document's prose, not this deliverable's subject.
 */
export function parseArcDraftContent(raw: string | null | undefined): ArcDraftContent {
  const text = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
  if (!text) return { fields: [], body: "", headline: null };

  const lines = text.split("\n");
  const fields: ArcDraftField[] = [];
  let cursor = 0;

  while (cursor < lines.length) {
    const line = lines[cursor] ?? "";
    // A blank line between two labels is normal (`Platform:` … blank … `Primary
    // text:`), so it doesn't end the lead-in — but only while we're still in it.
    if (!line.trim()) {
      if (fields.length === 0) { cursor += 1; continue; }
      // Look ahead: if the next non-blank line is another label the lead-in
      // continues, otherwise the body starts here.
      let peek = cursor;
      while (peek < lines.length && !(lines[peek] ?? "").trim()) peek += 1;
      const next = lines[peek] ?? "";
      const nextMatch = next.match(LABEL_LINE);
      if (peek < lines.length && nextMatch && normalizeLabel(nextMatch[1] ?? "")) { cursor = peek; continue; }
      break;
    }

    const match = line.match(LABEL_LINE);
    const label = match ? normalizeLabel(match[1] ?? "") : null;
    if (!match || !label) break;

    let value = (match[2] ?? "").trim();
    cursor += 1;
    // `Primary text:` with the value on the following line. Only adopt the next
    // line when it isn't itself a label, so an empty field can't swallow one.
    if (!value) {
      let peek = cursor;
      while (peek < lines.length && !(lines[peek] ?? "").trim()) peek += 1;
      const candidate = lines[peek] ?? "";
      const candidateMatch = candidate.match(LABEL_LINE);
      const candidateIsLabel = candidateMatch ? normalizeLabel(candidateMatch[1] ?? "") : null;
      if (peek < lines.length && candidate.trim() && !candidateIsLabel) {
        value = candidate.trim();
        cursor = peek + 1;
      }
    }
    if (value) fields.push({ label, value });
  }

  const body = lines.slice(cursor).join("\n").trim();
  // A draft that is nothing but lead-in lines is still a draft worth reading, so
  // keep the fields and let the body be empty rather than treating it as prose.
  const headline = HEADLINE_PRIORITY.map((label) => fields.find((f) => f.label === label)?.value).find(Boolean) ?? null;

  return { fields, body, headline };
}

/**
 * Does this draft need a "Show more" control?
 *
 * The card clamps with CSS (`-webkit-line-clamp`), which cannot tell the caller
 * whether it actually clipped anything. Measuring the DOM to find out is the
 * kind of read that the preview pane freezes, so this is a content-side
 * estimate: a draft is long if it runs past the clamp in lines OR in characters
 * at a conservative wrap width.
 */
export function isLongDraftBody(body: string, clampLines = 10, charsPerLine = 78): boolean {
  const text = (body ?? "").trim();
  if (!text) return false;
  if (text.split("\n").length > clampLines) return true;
  return text.length > clampLines * charsPerLine;
}

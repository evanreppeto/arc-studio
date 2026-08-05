/** The canvas text layers Arc's words can be applied to. Keys match the state
 *  setters in studio-view; `Background`/`Logo` are not copy and never appear. */
export type CanvasCopyField = "kicker" | "headline" | "subhead" | "cta";

export type CopySuggestion = { field: CanvasCopyField; value: string };

/**
 * Labels Arc actually writes, mapped to the field they set.
 *
 * An ALLOWLIST, deliberately — not `/^(\w+):/`. A bare label pattern reads
 * "Note:", "Warning:", "Subject:", "Platform:" and every other lead-in as copy
 * to paste onto an ad; the same shortcut has already misfired once in the Arc
 * chat renderer. Anything not named here is left alone.
 *
 * The set comes from what prod replies contain: `Headline:` and `H1:` appear on
 * real draft cards, alongside `Subject:` and `Platform:` — which are email and
 * targeting metadata, are NOT canvas copy, and are excluded on purpose.
 */
const FIELD_LABELS: ReadonlyArray<{ label: RegExp; field: CanvasCopyField }> = [
  { label: /^(?:kicker|eyebrow|overline)$/i, field: "kicker" },
  { label: /^(?:headline|hed|h1|title)$/i, field: "headline" },
  { label: /^(?:subhead|subheadline|subheading|sub-?head|h2)$/i, field: "subhead" },
  { label: /^(?:cta|call to action|button|button label|cta button)$/i, field: "cta" },
];

/** Longest a line may be and still be ad copy. A headline that runs past this is
 *  a paragraph Arc happened to prefix with a label, not something to paste into
 *  a 1080px frame. */
const MAX_COPY = 160;

const QUOTE_PAIRS: ReadonlyArray<[string, string]> = [['"', '"'], ["'", "'"], ["“", "”"], ["‘", "’"]];

/**
 * The copy itself, out of whatever punctuation Arc wrapped it in.
 *
 * When the value OPENS with a quote, the span up to the closing quote is the
 * answer and anything after it is discarded. That is not tidying — it is what
 * makes a card preview usable. Previews join fields with " / " and are cut at
 * 280 characters, so a real one reads:
 *
 *   Headline: "Water damage? We slow the situation down." / Prim
 *
 * The headline there is whole; only the NEXT field is severed. Taking the quoted
 * span recovers a complete headline, where treating the line as one value would
 * paste the wreckage of the following field onto the ad.
 */
function extractValue(raw: string): string {
  // Markdown emphasis can sit on either side of the colon: `**Headline:** …`
  // leaves its closing asterisks at the head of the value.
  const trimmed = raw.trim().replace(/^\*+/, "").replace(/\*+$/, "").trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (!trimmed.startsWith(open)) continue;
    const end = trimmed.indexOf(close, 1);
    if (end > 0) return trimmed.slice(1, end).trim();
  }
  return trimmed;
}

/**
 * Pull applicable canvas copy out of one Arc reply.
 *
 * Line-oriented and label-driven: `Headline: "Ready before the next storm."`
 * yields `{ field: "headline", value: "Ready before the next storm." }`. Prose
 * with no labels yields nothing, which is the correct answer — guessing which
 * sentence of a paragraph is the headline would put words on an ad that Arc
 * never proposed as one.
 *
 * Every distinct value is returned, not just the first per field: asked for
 * three headline options, Arc gives three, and the operator picks. Duplicates
 * (same field AND same text) collapse, because a card preview often restates a
 * line already in the body.
 *
 * Truncated values are dropped. `card.preview` is a 280-character PREFIX of the
 * asset body, so a label near its end yields half a sentence; applying that
 * would silently put a clipped headline on the canvas.
 */
export function extractCanvasCopy(text: string): CopySuggestion[] {
  const out: CopySuggestion[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    // Tolerate list markers and emphasis around the label: "- **Headline:** …"
    const line = rawLine.trim().replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s*/, "");
    const split = line.match(/^\**\s*([A-Za-z][A-Za-z0-9 -]{0,20}?)\s*\**\s*:\s*(.+)$/);
    if (!split) continue;
    const [, label, rest] = split;
    const match = FIELD_LABELS.find((candidate) => candidate.label.test(label.trim()));
    if (!match) continue;
    const value = extractValue(rest);
    // A trailing ellipsis is the 280-character prefix cut mid-sentence, on a
    // value that had no closing quote to rescue it.
    if (!value || value.length > MAX_COPY || /(?:…|\.\.\.)$/.test(value)) continue;
    const key = `${match.field}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ field: match.field, value });
  }
  return out;
}

/** What the Apply control says it will change, in the operator's words. */
export const FIELD_LABEL_TEXT: Record<CanvasCopyField, string> = {
  kicker: "Small line on top",
  headline: "Headline",
  subhead: "Supporting line",
  cta: "Button",
};

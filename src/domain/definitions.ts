/**
 * What the app's invented words mean, in one place (BSR-659).
 *
 * The audit found a set of coined terms carrying real weight in the UI with no
 * definition anywhere: `Confidence` (shown four times on one screen), `Lead
 * score`, `Arc-ready` (the primary filter on Library), `Trusted` / `Watching`,
 * `Signal strength`. A user cannot act differently at 79% than at 91% without
 * being told what the number is measuring, and a percentage with no stated
 * baseline is decoration.
 *
 * Two rules for anything added here:
 *
 *   - **Say what it is measured FROM.** "Arc's confidence" restates the label.
 *     "Based on pages visited, time since last contact, and how closely they
 *     match this persona" tells someone whether to trust it.
 *   - **No internal vocabulary in the definition itself** — that would just move
 *     the problem down one line.
 *
 * Pure — no I/O, no React. `<Define>` renders these.
 */

export type Definition = {
  /** The term as it appears in the UI. */
  term: string;
  /** One sentence: what the number or state actually is. */
  meaning: string;
  /** Optional: what it is computed from, so a user can judge it. */
  basedOn?: string;
};

export const DEFINITIONS = {
  confidence: {
    term: "Confidence",
    meaning: "How sure Arc is that this is a real opportunity worth acting on.",
    basedOn: "How recent the activity is, how much of it there is, and how closely the person matches a persona you sell to.",
  },
  lead_score: {
    term: "Lead score",
    meaning: "How ready this person looks to buy, out of 100.",
    basedOn: "Pages they visited, how recently they were in touch, and how well they fit one of your personas.",
  },
  arc_ready: {
    term: "Arc-ready",
    meaning: "You have approved this for Arc to use in a draft.",
    basedOn: "Anything not marked Arc-ready is still yours only — Arc will not put it in a campaign.",
  },
  trusted: {
    term: "Trusted",
    meaning: "Arc may state this as fact in anything it writes for you.",
    basedOn: "You approved it. Facts Arc has only observed stay out of your copy until you do.",
  },
  watching: {
    term: "Watching",
    meaning: "Arc has noticed this but has not been cleared to use it.",
    basedOn: "It stays out of everything Arc writes until you approve it.",
  },
  signal_strength: {
    term: "Signal strength",
    meaning: "How loudly the evidence is pointing at this person right now.",
    basedOn: "Combines how urgent it looks, how well they fit, and how long it has been since anyone spoke to them.",
  },
  last_contacted: {
    term: "Last contacted",
    meaning: "How long since anyone at your business was in touch with them.",
  },
  urgency: {
    term: "Urgency",
    meaning: "How soon this is likely to go cold if nobody acts.",
    basedOn: "High means the activity is recent and the window is short.",
  },
} as const satisfies Record<string, Definition>;

export type DefinitionKey = keyof typeof DEFINITIONS;

/** The whole definition as one line, for a `title` tooltip. */
export function definitionText(key: DefinitionKey): string {
  const d: Definition = DEFINITIONS[key];
  return d.basedOn ? `${d.meaning} ${d.basedOn}` : d.meaning;
}

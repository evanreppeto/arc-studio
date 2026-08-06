import { DEFINITIONS, definitionText, type DefinitionKey } from "@/domain";

/**
 * The info affordance next to a coined term (BSR-659).
 *
 * The app invents words — Confidence, Lead score, Arc-ready, Trusted — and puts
 * real weight on them. None of them was defined anywhere, so a user could not
 * act differently at 79% than at 91%.
 *
 * Deliberately small and quiet: a hairline glyph that sits beside the label and
 * carries the definition on hover and focus. It is a `<span>` with a `title`
 * rather than a custom popover so it works on first paint, needs no JS, and
 * reads correctly to a screen reader through the visually-hidden text.
 *
 * Wording lives in `src/domain/definitions.ts`, not here, so the same term reads
 * the same way on every screen.
 */
export function Define({ term, className }: { term: DefinitionKey; className?: string }) {
  const text = definitionText(term);
  return (
    <span className={`define${className ? ` ${className}` : ""}`} title={text} tabIndex={0} role="note">
      <span aria-hidden="true">?</span>
      <span className="sr-only">
        {DEFINITIONS[term].term}: {text}
      </span>
    </span>
  );
}

/**
 * The plain-English explainer panel. `/journeys` had the only one in the app and
 * it is the single most useful thing on that screen, so the audit's
 * recommendation was to spread the pattern rather than invent a new one.
 *
 * Spread it did — Brain, Personas, Opportunities and Journeys all carry one —
 * and on every one of them it was two paragraphs of prose pinned open above the
 * work. On Brain it sat between the metrics and the tabs and pushed the facts
 * themselves off a 900px viewport, so the screen's answer to "what does Arc
 * know?" was a paragraph about what knowing means.
 *
 * So it folds. `<details>` and not state, for the reason `Define` is a `title`:
 * it works on first paint, needs no JS, and a screen reader already understands
 * it. The heading stays visible, which is the part that orients someone — the
 * explanation is one click away instead of permanently in the way.
 */
export function HowThisWorks({ children, title = "How this works" }: { children: React.ReactNode; title?: string }) {
  return (
    <details className="howworks">
      <summary>
        {title}
        <span className="hw-chev" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M6 9l6 6 6-6" /></svg>
        </span>
      </summary>
      <div className="hw-body">{children}</div>
    </details>
  );
}

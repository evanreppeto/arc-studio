"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

/**
 * A labelled settings control.
 *
 * This existed twice, byte-identical, in custom-fields-panel.tsx and
 * pipeline-stages-panel.tsx — and both rendered the label as a `<div>`. Every
 * control inside was therefore visually labelled and programmatically nameless:
 * a screen reader announced "combo box" with no indication of what it sets, and
 * clicking the label text did not focus the control.
 *
 * ## Why htmlFor and not a wrapping `<label>`
 *
 * Wrapping is the tempting fix — association with no ids to keep in sync — and
 * it was the first thing tried here. It produces a WRONG accessible name.
 *
 * A wrapping label's name is computed from its whole text content, so the
 * `<option>` list of a `<select>` and the hint underneath both get swallowed
 * into it. Verified in the browser rather than assumed: the Type field
 * announced as "TypeTextNumberDateChoiceMultiple choiceYes / noLinkCurrency",
 * and Help text as "Help textOptional. Shown under the field when filling it
 * in." — each worse than the silence it replaced, and invisible to any static
 * check.
 *
 * Explicit `htmlFor`/`id` names the control with exactly the label, and the
 * hint becomes a `aria-describedby` description — announced after the name,
 * which is what a hint is.
 *
 * One control per Field: the id is cloned onto the single child element.
 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const reactId = useId();
  const controlId = `field-${reactId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;

  // Non-element children (a fragment, several controls) can't take an id, so
  // they render untouched rather than silently losing the association.
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: controlId,
        ...(hintId ? { "aria-describedby": hintId } : {}),
      })
    : children;

  return (
    <div>
      <label className="cxm-label" htmlFor={controlId} style={{ display: "block" }}>
        {label}
      </label>
      {control}
      {hint && (
        <div className="cxm-hint" id={hintId} style={{ marginTop: 4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";

/**
 * Makes Enter submit the <form> it's dropped inside, from anywhere on the page.
 *
 * The browser already does this — but only when focus is inside a form *field*.
 * On the auth pages focus starts on <body> (nothing autofocuses), and a password
 * manager that fills the fields programmatically usually doesn't leave focus in
 * one either. In both cases Enter is a no-op and the only way through is
 * clicking the button with the mouse.
 *
 * Listens on the document rather than the form so it still catches the
 * focus-is-nowhere case. Anything with its own Enter behaviour is left alone:
 * links (follow), buttons (activate), textarea/select, IME composition, and any
 * handler that already called preventDefault.
 *
 * requestSubmit() — not submit() — so required-field validation and the form's
 * own submit event both still run, exactly as clicking the button does.
 */
export function SubmitOnEnter() {
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = anchorRef.current?.closest("form");
    if (!form) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented) return;
      // Enter during IME composition commits the candidate, it doesn't submit.
      if (event.isComposing) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest("a, button, textarea, select, [contenteditable]")) return;

      // Listening on the document is what catches the focus-is-nowhere case, but
      // it would also let this form swallow an Enter meant for a different form
      // on the same page. Only act when the key came from inside THIS form, or
      // from outside every form.
      const ownerForm = target?.closest("form");
      if (ownerForm && ownerForm !== form) return;

      event.preventDefault();
      form.requestSubmit();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return <span ref={anchorRef} className="hidden" aria-hidden />;
}

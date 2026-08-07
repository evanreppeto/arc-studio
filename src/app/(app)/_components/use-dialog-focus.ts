"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * The keyboard half of `aria-modal="true"`.
 *
 * `aria-modal` tells a screen reader that everything outside the dialog is
 * inert. It does nothing to the tab order, and nothing to focus. Every dialog in
 * this app set the attribute; only `arc-view.tsx` implemented what it promises.
 * Verified live before this existed: with the CRM's "Add person" dialog open,
 * four Tabs put focus on the **"Arc Chat" nav link** — page chrome, behind an
 * `aria-modal` dialog, reachable and activatable. And closing dropped focus to
 * `<body>`, so a keyboard user who opened a dialog from a button deep in a list
 * resumed from the top of the page.
 *
 * This hook is the behaviour, in one place, so it cannot drift between the eight
 * dialogs that need it:
 *
 * - **Trap** — Tab and Shift+Tab wrap within the container; focus that is
 *   already outside is pulled back to the nearest edge.
 * - **Restore** — focus returns to whatever opened the dialog, if it still
 *   exists. `isConnected` matters: a dialog whose save re-renders the list its
 *   trigger lived in leaves that node detached.
 * - **Escape** — optional, because some dialogs have their own layered rules
 *   (review-queue backs out of a half-written revision before it closes).
 * - **Scroll lock** — optional, for the dialogs that own the whole screen.
 *
 * Modelled on the trap already in `arc-view.tsx`, which stays on its own copy:
 * it dismisses nested layers innermost-first, and folding that in would make
 * this hook serve one caller's special case.
 */
export function useDialogFocus({
  open,
  containerRef,
  onEscape,
  lockScroll = false,
  moveFocusIn = true,
}: {
  open: boolean;
  containerRef: RefObject<HTMLElement | null>;
  /** Omit to keep the component's own Escape handling. */
  onEscape?: () => void;
  lockScroll?: boolean;
  /** Set false if the component focuses something specific itself. */
  moveFocusIn?: boolean;
}) {
  /** What had focus when the dialog opened. */
  const restoreRef = useRef<HTMLElement | null>(null);
  /**
   * The callback through a ref so the effect can depend on `open` alone. Callers
   * pass inline arrows (`onClose={() => setOpen(false)}`), whose identity changes
   * every parent render — a dependency on it would tear down and re-run this
   * effect mid-dialog, re-moving focus and overwriting the saved trigger with
   * something inside the dialog.
   */
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!open) return;

    // Saved BEFORE focus is moved into the dialog.
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    function focusables(container: HTMLElement): HTMLElement[] {
      return [
        ...container.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((node) => node.getClientRects().length > 0 && node.getAttribute("aria-hidden") !== "true");
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && onEscapeRef.current) {
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;
      const items = focusables(container);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !container.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);

    let previousOverflow: string | null = null;
    if (lockScroll) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }

    if (moveFocusIn) {
      const container = containerRef.current;
      const target = container ? focusables(container)[0] : null;
      target?.focus();
    }

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previousOverflow !== null) document.body.style.overflow = previousOverflow;
      const restore = restoreRef.current;
      restoreRef.current = null;
      if (restore?.isConnected) restore.focus();
    };
    // `open` alone — see onEscapeRef above. containerRef is a ref, stable by
    // definition; lockScroll/moveFocusIn are configuration, not state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

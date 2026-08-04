"use client";

import { useEffect, useId, useRef } from "react";

import { OverlayPortal } from "./overlay-portal";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Rendered in the sticky footer, right-aligned (e.g. Cancel + a submit button). */
  footer?: React.ReactNode;
  /** Constrain the card width. Defaults to a comfortable form width. */
  width?: number;
  children: React.ReactNode;
};

/**
 * The app's one reusable modal. There was no dialog/overlay primitive before
 * this — every "create new" button was a dead no-op. Open/Escape/click-outside
 * behavior mirrors account-menu.tsx (the only prior floating panel); styling
 * lives in arc-app.css (.modal-*). When open it locks body scroll and moves
 * focus into the card.
 *
 * It renders through OverlayPortal, NOT inline. This used to say it was "a
 * position:fixed overlay above the whole shell" while rendering inline, and the
 * two halves of that sentence contradicted each other: inline means inside
 * `.page-enter`, whose transform makes it the containing block for fixed
 * descendants, so the overlay covered the content pane and left the nav rail
 * and top bar live behind an `aria-modal="true"` dialog. The three other halves
 * of the modal contract here — scroll lock, focus move, aria-modal — were all
 * already written for a shell-wide overlay; only the positioning wasn't.
 * overlay-portal.tsx has the measurements.
 */
export function Modal({ open, onClose, title, description, footer, width, children }: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);

    // Lock background scroll while the modal owns the screen.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Move focus into the card so keyboard + screen readers land inside the dialog.
    const focusTarget = cardRef.current?.querySelector<HTMLElement>(
      "input, textarea, select, button, [tabindex]:not([tabindex='-1'])",
    );
    focusTarget?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <OverlayPortal>
      <div className="modal-overlay" onMouseDown={onClose}>
        <div
          className="modal-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          ref={cardRef}
          style={width ? { maxWidth: width } : undefined}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="modal-head">
            <div>
              <h2 className="modal-title" id={titleId}>
                {title}
              </h2>
              {description && (
                <p className="modal-desc" id={descId}>
                  {description}
                </p>
              )}
            </div>
            <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </div>
      </div>
    </OverlayPortal>
  );
}

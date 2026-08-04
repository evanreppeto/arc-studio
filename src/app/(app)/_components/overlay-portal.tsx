"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/** The portal host, rendered once by app-shell.tsx as a child of `.arc-app`. */
export const OVERLAY_ROOT_ID = "arc-overlay-root";

/**
 * Renders an overlay into the shell instead of into the page that opened it.
 *
 * `position: fixed` does NOT mean "relative to the viewport" for anything a
 * page under `(app)` renders. `(app)/template.tsx` wraps every page in
 * `.page-enter`, whose entrance animation carries a `transform` — and a
 * transformed element becomes the containing block for its `position: fixed`
 * descendants (CSS Transforms 1 §3). So a page-rendered overlay is scoped to
 * the content pane: measured on the campaign detail page at 1080x820, the
 * `.modal-overlay` rendered at top=91 left=236 width=844 — starting below the
 * top bar and right of the nav rail, both of which stayed clickable underneath
 * an `aria-modal="true"` dialog with the body scroll already locked.
 *
 * The giveaway that this was accidental rather than a pane-scoped design: under
 * `prefers-reduced-motion: reduce` the rule is `animation: none`, so the
 * computed transform is `none`, no containing block is established, and the
 * same overlay measures 0,0 at the full 1080x820. The overlay was only correct
 * for users who had asked for less motion. A design choice would not flip on a
 * motion preference.
 *
 * So: overlays that claim modality portal out to the shell, above `.page-enter`
 * and its transform. Overlays that are deliberately pane-scoped (the Arc
 * workspace drawer, the dropdown dismiss-scrims) do NOT use this and do not
 * claim `aria-modal` — see the note beside `.page-enter` in arc-app.css.
 *
 * The host has to sit inside `.arc-app`, not on `document.body`: every overlay
 * style in arc-app.css is scoped `.arc-app .modal-overlay`, and the design
 * tokens (`--panel`, `--line-2`, `--serif`) are declared on `.arc-app`. A
 * body-level portal would render the dialog unstyled and untokenized.
 */
/** Never changes, so React never re-subscribes; this store has no updates. */
const noSubscribe = () => () => {};

export function OverlayPortal({ children }: { children: React.ReactNode }) {
  // "Are we past hydration?" — false on the server and during the hydrating
  // render, true afterwards. `useSyncExternalStore` rather than the usual
  // mounted-flag `useState` + `useEffect`, because setState inside an effect is
  // a lint error here (cascading renders) and this needs no state at all.
  const hydrated = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

  // The host lives only in the DOM, so it cannot be looked up before hydration
  // without the server and the client disagreeing. Rendering nothing for that
  // one pass is free: every overlay here is opened by a user interaction, long
  // after hydration.
  if (!hydrated) return null;

  const host = document.getElementById(OVERLAY_ROOT_ID);

  // No shell — a Modal used outside the `(app)` group, or the host removed from
  // app-shell.tsx. Render in place rather than return null. Degrading to a
  // pane-scoped overlay is survivable; a dialog that silently never appears is
  // the "looks wired, does nothing" failure this app keeps relapsing into, and
  // it would be invisible in exactly the case where the shell is unusual.
  if (!host) return <>{children}</>;

  return createPortal(children, host);
}

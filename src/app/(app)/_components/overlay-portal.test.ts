import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guards the invariant behind overlay-portal.tsx: a page under `(app)` cannot
 * position anything against the viewport, because `(app)/template.tsx` wraps it
 * in `.page-enter` whose entrance animation carries a transform, and a
 * transformed element is the containing block for its `position: fixed`
 * descendants. An overlay that claims `aria-modal="true"` while rendering
 * inline covers only the content pane and leaves the nav rail and top bar live
 * behind it.
 *
 * This is a source scan (matching src/lib/product-readiness/*.test.ts) because
 * vitest runs in the `node` environment — there is no DOM here to measure a
 * rect in. It cannot prove the geometry; it proves the two things that would
 * silently undo the fix: an overlay that stops portaling, and the portal host
 * disappearing from the shell.
 */

const root = process.cwd();
const APP = path.join(root, "src/app/(app)");

const read = (p: string) => fs.readFileSync(p, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * Overlays that are pane-scoped ON PURPOSE and are therefore allowed to render
 * `aria-modal` inline. Each is listed with why it is exempt — do not add to
 * this list to silence the test. If a new overlay belongs here, it also has to
 * drop `aria-modal`, because a dialog the rail and top bar sit outside of is
 * not modal to assistive tech either.
 */
const PANE_SCOPED_BY_DESIGN: Record<string, string> = {
  // Renders in the shell (a sibling of <main>), so no .page-enter above it.
  "_components/command-palette.tsx": "rendered by app-shell, outside .page-enter",
  // `position: absolute` inside the Arc workspace, with its own absolute scrim
  // (.arc-workspace-scrim) — a drawer over the Arc pane, not a shell overlay.
  // Its aria-modal is separately questionable, but it is not this bug: it never
  // relies on `position: fixed`.
  "arc/_components/arc-view.tsx": "the .arc-history drawer is absolute inside the Arc pane; its share dialog IS portaled",
};

describe("shell-wide overlays escape the .page-enter containing block", () => {
  it("keeps the portal host in the app shell", () => {
    const shell = read(path.join(APP, "_components/app-shell.tsx"));
    expect(
      shell.includes("OVERLAY_ROOT_ID"),
      "app-shell.tsx must render the overlay portal host; without it every portaled overlay falls back to rendering in place, which is the pane-scoped bug again",
    ).toBe(true);

    const css = read(path.join(APP, "arc-app.css"));
    expect(css).toContain("#arc-overlay-root");
  });

  it("routes every aria-modal overlay through OverlayPortal", () => {
    const offenders: string[] = [];

    for (const file of walk(APP)) {
      const rel = path.relative(APP, file).split(path.sep).join("/");
      if (rel.endsWith("overlay-portal.tsx")) continue;

      const source = read(file);
      // Only files that RENDER a dialog, not ones that query for one. The
      // lookbehind is what separates the two: an attribute selector reads
      // `[aria-modal="true"]`, JSX reads ` aria-modal="true"`. Without it this
      // flags home/_components/quick-actions.tsx, which queries the selector to
      // suppress its hotkeys while a dialog is open — behavior a portal keeps
      // working, since the overlay is still in the same document.
      if (!/(?<!\[)aria-modal=\{?["']?true/.test(source)) continue;
      if (rel in PANE_SCOPED_BY_DESIGN) continue;

      // The opening JSX TAG, not the identifier. `includes("OverlayPortal")`
      // was the first version of this line and it did not catch the regression
      // it exists for: stripping the wrapper out of modal.tsx left the word in
      // its own docstring, and a prose mention kept the guard green.
      if (!source.includes("<OverlayPortal>")) offenders.push(rel);
    }

    expect(
      offenders,
      `these render aria-modal="true" without OverlayPortal, so they cover only the content pane while the nav rail and top bar stay clickable behind them:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("keeps the dropdown dismiss-scrims out of the portal", () => {
    // Portaling a scrim without its menu would paint the scrim OVER the menu:
    // .page-enter's transform makes the page a stacking context, so a
    // shell-level node outranks every z-index inside it. This asserts the
    // reasoning stays recorded next to the rule someone would otherwise
    // "fix" for consistency.
    const css = read(path.join(APP, "arc-app.css"));
    for (const scrim of ["sortscrim", "ctl-backdrop", "sa-backdrop", "triage-scrim"]) {
      expect(css, `${scrim} should be documented as deliberately pane-scoped`).toContain(scrim);
    }
    expect(css).toContain("Do NOT portal those four");
  });
});

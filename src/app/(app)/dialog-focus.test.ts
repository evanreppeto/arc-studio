import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `aria-modal="true"` is a promise about the keyboard, and it has to be kept.
 *
 * The attribute tells a screen reader that everything outside the dialog is
 * inert. It does nothing to the tab order and nothing to focus — the browser
 * will happily Tab straight past the dialog into the page behind it. Every
 * dialog in this app set the attribute; only `arc-view.tsx` implemented what it
 * claims.
 *
 * Measured on the CRM's "Add person" dialog before this was fixed:
 *
 * - Four Tabs from inside the dialog put focus on the **"Arc Chat" nav link** —
 *   page chrome, behind an `aria-modal` dialog, reachable and activatable.
 * - Closing dropped focus to `<body>`, so a keyboard user who opened the dialog
 *   from a button deep in a list resumed from the top of the page.
 * - The command palette handled Escape on its search INPUT only, so Escape
 *   stopped working as soon as focus moved to a result.
 *
 * None of that is visible in a screenshot, and none of it fails a render test.
 * `use-dialog-focus.ts` is the one implementation; this check is what keeps a
 * new dialog from claiming modality without it.
 */

const APP_DIR = new URL(".", import.meta.url).pathname;

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (full.endsWith(".tsx") && !full.includes(".test.")) out.push(full);
  }
  return out;
}

/**
 * Files that declare modality but legitimately do not import the hook.
 *
 * `arc-view.tsx` carries its own trap and restore, and keeps them: it dismisses
 * nested layers innermost-first, and folding that into the shared hook would
 * bend the hook around one caller. It is checked for the behaviour instead.
 */
const OWN_IMPLEMENTATION = ["arc/_components/arc-view.tsx"];

describe("every aria-modal dialog implements what it claims", () => {
  const files = tsxFiles(APP_DIR).map((f) => [f.replace(APP_DIR, ""), readFileSync(f, "utf8")] as const);

  /**
   * Files that RENDER `aria-modal="true"`, as opposed to mentioning it.
   *
   * Two things have to be excluded, and both bit on the first run:
   *
   * - `[aria-modal="true"]` in a `querySelector` is a lookup, not a dialog —
   *   home/quick-actions.tsx checks whether one is open before firing a shortcut.
   * - Comments. overlay-portal.tsx explains at length why overlays that claim
   *   modality must portal out of `.page-enter`, and quoting the attribute made
   *   it read as a dialog. Every source scan in this repo has now been caught by
   *   its own prose at least once.
   */
  const dialogs = files.filter(([, raw]) => {
    const src = raw
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\[aria-modal="true"\]/g, "");
    return /(^|[^[\w-])aria-modal=["{]/.test(src);
  });

  it("finds the dialogs, so a rename cannot quietly empty this check", () => {
    expect(dialogs.length).toBeGreaterThanOrEqual(5);
  });

  it("routes focus handling through the shared hook", () => {
    const offenders = dialogs
      .filter(([name]) => !OWN_IMPLEMENTATION.includes(name))
      .filter(([, src]) => !/useDialogFocus/.test(src))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  it("keeps the trap and restore in arc-view, which opted out of the hook", () => {
    const src = files.find(([n]) => n === "arc/_components/arc-view.tsx")?.[1] ?? "";
    expect(src).not.toBe("");
    expect(src, "Tab trap").toMatch(/event\.key !== "Tab"/);
    expect(src, "focus restore").toMatch(/activeElement/);
  });
});

/**
 * The hook itself. These assert the three behaviours by shape, because the repo
 * has no jsdom — every one of them was verified by hand in a real browser first
 * (Tab wrapping both directions, Escape from a non-input, focus returning to the
 * trigger), and this is what stops them being deleted as dead code later.
 */
describe("useDialogFocus", () => {
  const src = readFileSync(join(APP_DIR, "_components", "use-dialog-focus.ts"), "utf8");

  it("wraps Tab at both ends and pulls escaped focus back", () => {
    expect(src).toMatch(/event\.shiftKey && active === first/);
    expect(src).toMatch(/!event\.shiftKey && active === last/);
    expect(src).toMatch(/!container\.contains\(active\)/);
  });

  it("saves the trigger before moving focus, and restores it on close", () => {
    expect(src).toMatch(/restoreRef\.current = document\.activeElement/);
    expect(src).toMatch(/restore\?\.isConnected/);
  });

  /**
   * The effect must depend on `open` ALONE. Callers pass inline
   * `onClose={() => setOpen(false)}`, so depending on the callback would re-run
   * the effect on every parent render — re-moving focus mid-dialog and
   * overwriting the saved trigger with something inside the dialog. Same shape
   * as the render-body component that made Studio's rail blink per keystroke.
   */
  it("depends on `open` alone, with the callback behind a ref", () => {
    expect(src).toMatch(/onEscapeRef/);
    const deps = src.match(/\}, \[([^\]]*)\]\);\s*\}\s*$/m)?.[1] ?? "";
    expect(deps.replace(/\s/g, "")).toBe("open");
  });
});

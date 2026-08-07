import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The Fields modal borrows Settings' form component — so it has to borrow the
 * styles too, from a sheet the CRM route actually loads.
 *
 * `settings.css` is imported by `settings/page.tsx` alone. On /crm none of its
 * rules exist, so the shared FieldForm's `.btn` fell all the way through to
 * `.arc-app .btn` — the app's gold primary. Edit and Remove both rendered as
 * filled gold buttons and the destructive one was the loudest thing in the
 * dialog; the inputs and labels were unstyled for the same reason.
 *
 * Nothing failed. Typecheck cannot see a stylesheet that was never loaded, and
 * the demo fixtures that made this visible did not exist yet — the modal simply
 * had no fields to render, so the surface looked fine while being wrong.
 */

const APP = join(new URL(".", import.meta.url).pathname, "../..");
const ARC_APP_CSS = readFileSync(join(APP, "arc-app.css"), "utf8");
const MODAL = readFileSync(join(new URL(".", import.meta.url).pathname, "manage-fields-modal.tsx"), "utf8");

describe("the shared field editor is styled wherever it is mounted", () => {
  it("defines its primitives in the app-wide sheet, not the settings-only one", () => {
    // arc-app.css is loaded by the (app) layout; settings.css is not.
    for (const primitive of [".arc-fieldkit .btn", ".arc-fieldkit .inp", ".arc-fieldkit .cxm-label"]) {
      expect(ARC_APP_CSS, `${primitive} must live in arc-app.css`).toContain(primitive);
    }
  });

  /**
   * `.arc-app .btn` is the gold primary and is two levels deep. A two-level
   * `.arc-fieldkit .btn` ties it and loses on file order, which is how this bug
   * survived its first fix — matching how `.arc-grid` documents the same rule.
   */
  it("outranks the app's gold button rather than relying on file order", () => {
    const rule = ARC_APP_CSS.match(/^\.arc-app \.arc-fieldkit \.btn \{/m);
    expect(rule, "the .btn rule must be scoped .arc-app .arc-fieldkit .btn").toBeTruthy();
  });

  it("applies the scope in the modal that mounts the shared form", () => {
    expect(MODAL).toMatch(/className="arc-fieldkit"/);
    expect(MODAL).toMatch(/import \{ FieldForm \} from "\.\.\/\.\.\/settings\/_components\/custom-fields-panel"/);
  });

  /** One gold button per dialog: the primary is Add field, never Remove. */
  it("keeps the destructive control off the primary treatment", () => {
    const remove = MODAL.slice(MODAL.indexOf("archiveCustomField({ fieldId: d.id"));
    expect(remove.slice(0, 400)).not.toMatch(/className="btn sm gold"/);
    expect(MODAL).toMatch(/className="btn sm gold"[\s\S]{0,200}Add field/);
  });
});

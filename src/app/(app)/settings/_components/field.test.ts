import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const FIELD = readFileSync(new URL("./field.tsx", import.meta.url), "utf8");
const PANELS = ["custom-fields-panel.tsx", "pipeline-stages-panel.tsx"].map((name) => ({
  name,
  source: readFileSync(new URL(`./${name}`, import.meta.url), "utf8"),
}));

/**
 * `Field` names every control in the settings panels, and a regression here is
 * silent — the screen still looks labelled.
 *
 * Deliberately NOT a repo-wide scan for unlabelled inputs. That check cannot be
 * made honest: a label supplied by a wrapper component lives in a different
 * file, so a static scan reports correctly-labelled controls as violations. The
 * count did not move at all when this fix landed, which is how that was found.
 * The reliable check is this one — that the shared component keeps doing its
 * job — plus the browser, where the accessibility tree is ground truth.
 */
describe("settings fields name their controls", () => {
  it("associates the label with the control by id", () => {
    expect(FIELD).toMatch(/htmlFor=\{controlId\}/);
    expect(FIELD).toMatch(/id: controlId/);
  });

  /**
   * The regression this file exists to prevent, and it was nearly shipped.
   *
   * A wrapping `<label>` associates without ids, so it reads as the tidier fix.
   * Its accessible name is computed from the label's whole text content, which
   * swallows a `<select>`'s entire option list and any hint underneath: the Type
   * field announced as "TypeTextNumberDateChoiceMultiple choiceYes / noLink
   * Currency". Worse than the silence it replaced, and no static check can see
   * it — only the accessibility tree in a real browser.
   */
  it("does not wrap the control in the label", () => {
    // The label element must close before the control renders.
    expect(FIELD).toMatch(/<label[^>]*>\s*\n?\s*\{label\}\s*\n?\s*<\/label>/);
    // Must not appear BETWEEN the label tags. A greedy [\s\S]* runs past
    // </label> and matches {control} further down the file, which made this
    // assertion fail against correct code on its first run.
    expect(FIELD, "a wrapping <label> pollutes the accessible name with option and hint text")
      .not.toMatch(/<label[^>]*>(?:(?!<\/label>)[\s\S])*\{control\}/);
  });

  it("describes the hint rather than folding it into the name", () => {
    expect(FIELD).toMatch(/aria-describedby/);
    expect(FIELD).toMatch(/id=\{hintId\}/);
  });

  it("is the only Field, so a panel cannot quietly fork a nameless copy", () => {
    for (const { name, source } of PANELS) {
      expect(source, `${name} must import the shared Field`).toMatch(/from "\.\/field"/);
      expect(source, `${name} declares its own Field again`).not.toMatch(/function Field\(/);
    }
  });
});

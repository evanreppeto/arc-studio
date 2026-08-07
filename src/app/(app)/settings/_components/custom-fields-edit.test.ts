import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Field editing has to stay reachable.
 *
 * `updateCustomField` and `updateFieldDefinition` were both complete — argument
 * validation, a type-change guard that refuses once the field holds values, an
 * org predicate on the write — and had ZERO importers anywhere in the app. So a
 * workspace could add "Referal source", notice the typo, and have no way to fix
 * it: archiving and re-adding is not a rename, it strands every value already
 * saved on the archived definition.
 *
 * That is this repo's most familiar defect (see the "green tests, code that
 * never runs" family), and the reason it survives review is that nothing fails
 * when a write path has no caller. This test fails.
 */

const PANEL = join(new URL(".", import.meta.url).pathname, "custom-fields-panel.tsx");

describe("the fields panel can edit, not only add and archive", () => {
  const src = readFileSync(PANEL, "utf8");

  it("calls updateCustomField", () => {
    expect(src).toMatch(/import \{[\s\S]*?\bupdateCustomField\b[\s\S]*?\} from "\.\.\/custom-fields-actions"/);
    expect(src).toMatch(/await updateCustomField\(\{/);
  });

  it("passes the field id being edited, not a new definition", () => {
    const call = src.slice(src.indexOf("await updateCustomField({"));
    expect(call.slice(0, call.indexOf("})"))).toMatch(/fieldId: d\.id/);
  });

  /**
   * The stored `key` is the identifier: custom_field_values reference the
   * definition by id, but Arc, exports and the list columns address it by key.
   * The edit form must never offer it — a renamed key silently detaches every
   * saved value from its field.
   */
  it("does not offer the machine key for editing", () => {
    const form = src.slice(src.indexOf("function FieldForm"));
    expect(form).not.toMatch(/setKey|value=\{key\}|name="key"/);
  });

  /**
   * Type is settled at creation: the action deliberately never sends it and the
   * lib layer refuses it once values exist. An editable-looking control that is
   * dropped on the way to the server is worse than no control.
   */
  it("shows the type as fixed when editing rather than as a dead control", () => {
    const form = src.slice(src.indexOf("function FieldForm"));
    expect(form).toMatch(/editing \?/);
    expect(form).toMatch(/Set when the field was created/);
  });
});

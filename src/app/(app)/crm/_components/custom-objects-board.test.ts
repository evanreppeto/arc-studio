import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A tenant-defined object type is a row, not a table — and the board was built
 * for six tables. These are the seams where that difference bites.
 */

const HERE = new URL(".", import.meta.url).pathname;
const BOARD = readFileSync(join(HERE, "crm-board.tsx"), "utf8");

describe("the board treats a tenant-defined type as its own thing", () => {
  /**
   * AddRecordModal looks up a per-object config for persona, status and parent
   * pickers. For a custom key that lookup is `undefined` and the modal throws
   * on `cfg.status` — which is exactly how the board crashed the first time a
   * custom tab was clicked. Typecheck cannot see it: the config is a Record
   * indexed by string.
   */
  it("does not render the six's add form for a custom object", () => {
    expect(BOARD).toMatch(/active\.isCustom \? \(\s*<AddCustomRecordModal/);
  });

  /**
   * COLS lookups fall back to `COLS.contacts`, so without its own set a custom
   * object renders Persona, Status and Company headings over empty columns.
   */
  it("gives a custom object its own columns rather than borrowing contacts'", () => {
    expect(BOARD).toMatch(/COLS\[active\.key\] \?\? \(active\.isCustom \? CUSTOM_OBJECT_COLS : COLS\.contacts\)/);
    const cols = BOARD.match(/const CUSTOM_OBJECT_COLS: Col\[\] = \[[^\]]+\]/)?.[0] ?? "";
    expect(cols).toBeTruthy();
    for (const borrowed of ["persona", "status", "company", "score", "tier", "routing"]) {
      expect(cols, `custom columns must not include ${borrowed}`).not.toContain(`"${borrowed}"`);
    }
  });

  /**
   * Writes go to different tables. A custom record archived through the six's
   * action would be an org-scoped update against a table that does not hold it.
   */
  it("routes archive and restore to the custom-object actions", () => {
    expect(BOARD).toMatch(/active\.isCustom \? archiveCustomObjectRecords\(objectKey, ids\) : archiveCrmRecordsAction/);
    expect(BOARD).toMatch(/active\.isCustom \? restoreCustomObjectRecords\(objectKey, ids\) : restoreCrmRecordsAction/);
    expect(BOARD).toMatch(/active\.isCustom\s*\n?\s*\? await listArchivedCustomObjectRecords/);
  });

  /**
   * The footer must not promise that Arc MAINTAINS a tenant-defined type, or
   * offer it a "lead score" — neither is true, and both are true of the six.
   *
   * It used to pin the literal "doesn't read them yet". That was accurate when
   * written and became false the moment `list_record_types` /
   * `search_custom_records` / `read_custom_fields` shipped — a green test
   * holding the UI to a claim the backend had already outgrown. So this asserts
   * the invariant (no upkeep, no score) rather than one sentence.
   */
  it("does not claim Arc maintains or scores a tenant-defined type", () => {
    const footer = BOARD.slice(BOARD.indexOf('<span className="arcnote">'));
    const block = footer.slice(0, footer.indexOf("</span>"));
    expect(block).toMatch(/active\.isCustom/);

    // The custom branch is the first template literal after the ternary.
    const customBranch = block.slice(block.indexOf("?"), block.indexOf(":"));
    expect(customBranch).not.toMatch(/lead score/i);
    expect(customBranch).not.toMatch(/keeps? .* up to date/i);
    // …and it still says these are the operator's to look after.
    expect(customBranch).toMatch(/yours to maintain/i);
  });
});

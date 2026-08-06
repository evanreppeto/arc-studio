import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isArchivableObject } from "./archive";

/**
 * Archiving a CRM record (BSR-762).
 *
 * Before this there was no delete of any kind. The only way to remove a record
 * was to open it, press Edit, and set Status to "archived" — which the form
 * offered on three of the six objects. Properties, jobs and outcomes had no
 * route to it at all, because their status columns have no such value (and
 * properties has no status column).
 *
 * The write path itself is proven against real Postgres, not here: archive →
 * count drops → wrong-org restore is refused → correct-org restore returns it.
 * A mocked client cannot see an org predicate failing to match, which is the
 * one thing in this file that would be a tenancy incident rather than a bug.
 */

const CRM_DIR = new URL(".", import.meta.url).pathname;
const APP_CRM = join(CRM_DIR, "../../app/(app)/crm");

describe("isArchivableObject", () => {
  it("accepts the six CRM objects", () => {
    for (const key of ["companies", "contacts", "properties", "leads", "jobs", "outcomes"]) {
      expect(isArchivableObject(key), key).toBe(true);
    }
  });

  it("rejects anything else, including tables that merely look adjacent", () => {
    for (const key of ["campaigns", "approval_items", "agent_tasks", "", "COMPANIES", "contacts; drop"]) {
      expect(isArchivableObject(key), key).toBe(false);
    }
  });
});

describe("one archive mechanism, not two", () => {
  /**
   * The status dropdown must not offer "archived" any more. If it does, an
   * operator can set a record's status to Archived while `archived_at` stays
   * null — a record that says it is deleted, in every list, forever. The two
   * mechanisms would disagree and the UI would show the losing one.
   */
  it("the edit form no longer offers archived as a status", () => {
    const src = readFileSync(join(APP_CRM, "[objectKey]/[recordId]/_components/edit-record-modal.tsx"), "utf8");
    const table = src.slice(src.indexOf("const STATUS_OPTIONS"), src.indexOf("function titleize"));
    expect(table).not.toMatch(/"archived"/);
  });

  /**
   * The board used to decide what was archived by comparing a record's status
   * LABEL to the string "Archived". Labels are the tenant's own words — the one
   * thing guaranteed to change — so a workspace renaming a stage would have
   * silently un-archived every record in it. Archived is read from the column
   * now, filtered server-side, and the board should never match on the word.
   */
  it("the board does not decide archive state by matching a label", () => {
    const src = readFileSync(join(APP_CRM, "_components/crm-board.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/ARCHIVED_LABEL/);
    expect(src).not.toMatch(/statusLabel\s*===\s*"Archived"/);
  });
});

describe("archived records stay out of the numbers", () => {
  const readModel = readFileSync(join(CRM_DIR, "read-model.ts"), "utf8");

  /**
   * The count and the list have to be fetched with the same predicate. When
   * they weren't, the tab badge said 12 and the list showed 11 — with nothing
   * on screen to say which was right.
   */
  it("counts only live rows", () => {
    const fn = readModel.slice(readModel.indexOf("async function countRows"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toMatch(/\.is\("archived_at", null\)/);
  });

  it("excludes archived rows from the list window", () => {
    const scope = readModel.slice(readModel.indexOf("const scope = <T extends"), readModel.indexOf("let companiesQ"));
    expect(scope).toMatch(/\.is\("archived_at", null\)/);
    // ...but never from a focused fetch by id, or the restore list could not
    // read the very rows it exists to show.
    expect(scope).toMatch(/focus && focus\.key === key \? q\.in\("id", focus\.ids\)/);
  });

  /** Reading the column is the whole feature; a dropped select silently returns undefined. */
  it("selects archived_at for every object", () => {
    const bundle = readModel.slice(readModel.indexOf("async function getCrmTableBundle"), readModel.indexOf("function assertResult"));
    const selects = [...bundle.matchAll(/\.select\("([^"]+)"\)/g)].map((m) => m[1]);
    const rowSelects = selects.filter((s) => s.includes("metadata"));
    expect(rowSelects).toHaveLength(6);
    for (const s of rowSelects) expect(s).toContain("archived_at");
  });
});

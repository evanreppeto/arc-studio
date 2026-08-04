import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applyInlineFix, describeFixFailure, FIX_KINDS, isFixKind } from "../inline-fix";

const DRAFT = [
  "Water damage? We slow the situation down.",
  "",
  "Call [24/7 line] — answered any hour.",
  "",
  "Big Shoulders Restoration — or reply and we'll call [24/7 line] back.",
].join("\n");

describe("applyInlineFix", () => {
  it("fills in every occurrence of the placeholder", () => {
    // A placeholder appears wherever the real thing belongs. Filling one of two
    // is not what "here's the number" meant, and would ship the other.
    const result = applyInlineFix(DRAFT, { target: "[24/7 line]" }, "(773) 900-8407");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replaced).toBe(2);
    expect(result.body).not.toContain("[24/7 line]");
    expect(result.body).toContain("Call (773) 900-8407 — answered any hour.");
  });

  it("trims what the operator typed", () => {
    const result = applyInlineFix("Call [n].", { target: "[n]" }, "  555-0100  ");
    expect(result).toEqual({ ok: true, body: "Call 555-0100.", replaced: 1 });
  });

  it("leaves the rest of the draft exactly as it was", () => {
    const result = applyInlineFix(DRAFT, { target: "[24/7 line]" }, "555");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.split("555").join("[24/7 line]")).toBe(DRAFT);
  });

  it("refuses when the target is gone, rather than reporting a no-op as success", () => {
    // The case that makes this worth writing: a revision landed between the
    // review and the click. A silent no-op would leave the operator looking at
    // an unchanged draft after a button told them it worked.
    const result = applyInlineFix("Call (773) 900-8407 — answered any hour.", { target: "[24/7 line]" }, "555");
    expect(result).toEqual({ ok: false, reason: "target_missing" });
  });

  it("refuses a blank value", () => {
    expect(applyInlineFix(DRAFT, { target: "[24/7 line]" }, "   ")).toEqual({ ok: false, reason: "empty_value" });
  });

  it("refuses a value that still carries the placeholder", () => {
    // Paste-over-the-wrong-thing: "[24/7 line] 555-0100" would "succeed" while
    // leaving the placeholder in the copy.
    expect(applyInlineFix(DRAFT, { target: "[24/7 line]" }, "[24/7 line] 555-0100")).toEqual({
      ok: false,
      reason: "value_contains_target",
    });
  });

  it("treats the target literally, not as a pattern", () => {
    // `[24/7 line]` is a character class in regex and a plain string here. A
    // regex-based implementation would match "2", "4", "7" and shred the copy.
    const result = applyInlineFix("Ask for [24/7 line] at 24 hours.", { target: "[24/7 line]" }, "X");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toBe("Ask for X at 24 hours.");
  });

  it("refuses an empty target rather than splicing the value everywhere", () => {
    expect(applyInlineFix(DRAFT, { target: "" }, "555")).toEqual({ ok: false, reason: "target_missing" });
  });
});

describe("describeFixFailure", () => {
  it("explains the lapsed-target case in the operator's terms, and says nothing changed", () => {
    const message = describeFixFailure("target_missing", "[24/7 line]");
    expect(message).toContain("[24/7 line]");
    expect(message).toContain("Nothing was changed.");
  });

  it("covers every failure reason", () => {
    for (const reason of ["empty_value", "target_missing", "value_contains_target"] as const) {
      expect(describeFixFailure(reason, "[x]").length).toBeGreaterThan(0);
    }
  });
});

describe("isFixKind", () => {
  it("accepts the vocabulary and rejects anything else", () => {
    expect(isFixKind("phone")).toBe(true);
    expect(isFixKind("sms")).toBe(false);
    expect(isFixKind(null)).toBe(false);
  });

  it("matches the CHECK constraint the database enforces", () => {
    // Drift here fails at write time, on a path nothing exercises until an
    // operator clicks Apply — so the two lists are pinned together instead.
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260805100000_guardrail_finding_fix.sql"),
      "utf8",
    );
    const clause = migration.match(/fix_kind in \(([^)]*)\)/);
    expect(clause, "the fix_kind CHECK constraint should exist").toBeTruthy();
    const inDatabase = [...(clause?.[1].matchAll(/'([a-z]+)'/g) ?? [])].map((m) => m[1]);
    expect(inDatabase.sort()).toEqual([...FIX_KINDS].sort());
  });
});

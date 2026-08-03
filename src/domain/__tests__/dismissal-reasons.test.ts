import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DISMISS_REASONS,
  DISMISS_REASON_COPY,
  DISMISS_REASON_OPTIONS,
  isDismissReason,
  summarizeDismissals,
  type DismissReasonTally,
} from "../dismissal-reasons";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260804100000_opportunities_dismissed_reason.sql",
);

describe("the vocabulary and the CHECK constraint agree", () => {
  /**
   * BSR-687 shipped code writing a `risk_level` the CHECK had never allowed, and
   * every write failed in production while the mocked tests stayed green — a
   * mock cannot see a check constraint. This pins the same pair the only way a
   * unit test can: by reading the migration.
   */
  it("lists exactly the same values in both places", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const block = sql.slice(sql.indexOf("dismissed_reason = any"), sql.indexOf("])"));
    const inSql = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(inSql).toEqual([...DISMISS_REASONS].sort());
  });

  it("keeps the column nullable, so the 46 pre-existing dismissals stay legal", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toContain("dismissed_reason is null");
    expect(sql).not.toMatch(/dismissed_reason text\s+not null/i);
  });
});

describe("DISMISS_REASON_COPY", () => {
  it("covers every reason — a picker item with no copy would render blank", () => {
    for (const reason of DISMISS_REASONS) {
      expect(DISMISS_REASON_COPY[reason].label.length).toBeGreaterThan(0);
      expect(DISMISS_REASON_COPY[reason].lesson.length).toBeGreaterThan(0);
    }
    expect(DISMISS_REASON_OPTIONS).toHaveLength(DISMISS_REASONS.length);
  });

  it("says what to change, not what the label already said", () => {
    // The lesson goes into Arc's context. Restating the label there would spend
    // tokens telling the model nothing it could act on.
    for (const reason of DISMISS_REASONS) {
      const { label, lesson } = DISMISS_REASON_COPY[reason];
      expect(lesson.toLowerCase()).not.toBe(label.toLowerCase());
      expect(lesson.length).toBeGreaterThan(label.length);
    }
  });
});

describe("isDismissReason", () => {
  it("accepts the vocabulary and rejects everything else", () => {
    expect(isDismissReason("not_relevant")).toBe(true);
    expect(isDismissReason("nonsense_value")).toBe(false);
    expect(isDismissReason(null)).toBe(false);
    expect(isDismissReason(undefined)).toBe(false);
    expect(isDismissReason(3)).toBe(false);
  });
});

describe("summarizeDismissals", () => {
  const tally = (over: Partial<DismissReasonTally> = {}): DismissReasonTally => ({
    reason: "not_relevant",
    kind: "crm_inactivity",
    count: 5,
    ...over,
  });

  it("reports a pattern with the count, the kind, and what to change", () => {
    const [line] = summarizeDismissals([tally()]);
    expect(line).toContain("5×");
    expect(line).toContain("crm_inactivity");
    expect(line).toContain("Not relevant to us");
    expect(line).toContain("the targeting was wrong");
  });

  it("ignores one-offs — an opinion about one record is not a rule", () => {
    expect(summarizeDismissals([tally({ count: 1 }), tally({ count: 2 })])).toEqual([]);
  });

  it("returns nothing at all when no pattern clears the bar", () => {
    // The caller renders no block rather than a header over an empty list.
    expect(summarizeDismissals([])).toEqual([]);
  });

  it("puts the strongest pattern first", () => {
    const lines = summarizeDismissals([
      tally({ count: 4, kind: "weather_event" }),
      tally({ count: 11, kind: "crm_inactivity" }),
    ]);
    expect(lines[0]).toContain("crm_inactivity");
    expect(lines[1]).toContain("weather_event");
  });

  it("drops a reason the database somehow holds but the vocabulary does not", () => {
    // Defensive: the CHECK should make this impossible, but a stale row from a
    // future vocabulary change must not crash the context builder.
    const rogue = { reason: "retired_reason", kind: "crm_inactivity", count: 9 } as unknown as DismissReasonTally;
    expect(summarizeDismissals([rogue])).toEqual([]);
  });
});

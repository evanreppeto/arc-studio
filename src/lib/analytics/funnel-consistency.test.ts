import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The funnel and the sentence about it agree (BSR-666).
 *
 * Analytics showed "Booked jobs 91" in the KPI row, "Won 76" in the funnel, and
 * a prose summary calling 76 "booked demos" — three readings of two numbers, so
 * the screen looked like it was giving competing answers to one question.
 *
 * The audit flagged this as possibly a DATA bug. It wasn't, and the distinction
 * mattered enough to trace before writing any copy:
 *
 *   - Booked and Won are genuinely different stages. Booked jobs come from the
 *     bookings trend; won jobs are counted from won outcomes. A booked job that
 *     never closes stays booked. The funnel was right.
 *   - The LIVE path already said "won jobs" correctly.
 *   - Only the DEMO path's prose was wrong, calling the won figure "booked
 *     demos" — conflating the two stages it sits between.
 *
 * Had it been a data bug, rewriting the sentence would have buried it. These
 * tests pin the thing that was actually broken: the words describing a stage
 * must match the stage they describe.
 */

const OVERVIEW = readFileSync(new URL("./overview.ts", import.meta.url), "utf8");

describe("analytics funnel wording", () => {
  it("never calls the won figure a booking, or vice versa", () => {
    // `${curWon} booked …` was the exact shape of the bug.
    expect(OVERVIEW).not.toMatch(/\$\{curWon[^}]*\}\s+booked/);
    expect(OVERVIEW).not.toMatch(/\$\{curJobs[^}]*\}\s+won\b/);
  });

  it("keeps SaaS vocabulary off a screen built for service businesses", () => {
    // "demos" and "cost-per-demo" belong to a different product. Our ICP books
    // jobs. The comment above the demo fixture may still say "demos" — that is
    // developer prose, not customer copy.
    const customerText = OVERVIEW.split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    expect(customerText).not.toMatch(/\bbooked demos?\b/i);
    expect(customerText).not.toMatch(/cost[- ]per[- ]demo/i);
  });

  it("says out loud that the demo's Won is derived, not measured", () => {
    // A bare `curJobs * 0.84` reads as a real conversion rate to the next person
    // who opens this file.
    expect(OVERVIEW).toMatch(/DEMO_BOOKED_TO_WON/);
    expect(OVERVIEW).toMatch(/Booked and\s*\n?\s*\/\/\s*Won are DIFFERENT stages/);
  });

  it("counts won from outcomes on the live path, not from a ratio", () => {
    // The live figure must stay measured. If this ever becomes a multiplier the
    // funnel starts asserting a conversion rate nobody computed.
    expect(OVERVIEW).toMatch(/const curWon = outcomes\.filter\(\(o\) => isWin\(o\)/);
  });
});

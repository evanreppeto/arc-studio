import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Ordinary cards and rows do not lift on hover (DESIGN.md §6 + Calm Principles).
 *
 *   "`.btn` is the one element that lifts (`translateY(-1px)`); ordinary cards
 *    and selected states obey **no levitation** and **no glow**."
 *
 * This is a house-style rule, not a nitpick. Lift-plus-shadow on every card is
 * the generic SaaS reflex the obsidian-and-gold system exists to avoid: it reads
 * as busy rather than considered, and it is the single most repeated deviation
 * in the stylesheets.
 *
 * The Outbox send queue was the worst of them — `translateY(-2px)` AND a 30px
 * shadow on the cards where outbound sends get confirmed — and it is fixed.
 *
 * ## Why a ratchet and not a clean assertion
 *
 * Fourteen more remain across six stylesheets. Each is a visual change that
 * needs looking at, and converting that many without checking every one trades
 * a style bug for a layout bug — the same reason `keyboard-reachable.test.ts`
 * pinned its counts rather than sweeping them. New violations fail immediately;
 * fixing one means lowering its number here, which is the nudge.
 *
 * ## Two exemptions, both principled
 *
 * `/arc` is exempt because DESIGN.md says so outright: "`/arc` is the deliberate
 * rich exception — these rules don't bind it."
 *
 * Buttons are exempt because the rule names them as the one element that may
 * lift. That includes the ones not literally called `.btn` — a send button is a
 * button whatever its class is.
 */

const APP_DIR = new URL(".", import.meta.url).pathname;

/** Classes that ARE buttons, whatever they are called. */
const BUTTON_LIKE = /\.(btn|gbtn|mbtn|ibtn|qbtn|cbtn|ucta|[a-z-]*button|[a-z-]*-cta|sendbtn)\b|\bbutton\b/;

/**
 * Empty, and that is the assertion.
 *
 * This shipped as a ratchet with fourteen entries across six stylesheets,
 * because converting that many visual rules unchecked trades a style bug for a
 * layout one. They are done now, and they were cheaper than feared: twelve of
 * the fourteen ALREADY carried a `border-color` step, so removing the transform
 * and its glow left a working hover cue untouched.
 *
 * Only `.wsid-sw` — a 26px accent swatch in the workspace identity modal — had
 * the lift as its sole cue, and it took the same `border-color` step the brand
 * swatches beside it already used, rather than losing hover feedback.
 *
 * Five carried a glow as well (`.card.link`, `.lanecards .card`, `.ccard`,
 * `.isrc`, `.acard`); those went with them, since the rule bans both.
 *
 * Adding an entry back is fine when a lift is genuinely right. Adding one
 * because a card looked flat without it is the thing to refuse — `.btn` is the
 * element that lifts, and DESIGN.md is unambiguous that ordinary cards are not.
 */
const BASELINE: Record<string, number> = {};
function cssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) cssFiles(full, out);
    else if (full.endsWith(".css")) out.push(full);
  }
  return out;
}

function levitationCount(source: string): number {
  let n = 0;
  for (const line of source.split("\n")) {
    if (!line.includes(":hover")) continue;
    if (!/transform:\s*[^;]*translateY\(-/.test(line)) continue;
    const selector = line.split("{")[0];
    if (BUTTON_LIKE.test(selector)) continue;
    n += 1;
  }
  return n;
}

describe("ordinary cards do not lift on hover", () => {
  const counts = new Map<string, number>();
  for (const file of cssFiles(APP_DIR)) {
    const rel = file.replace(APP_DIR, "");
    // DESIGN.md exempts /arc explicitly.
    if (rel.startsWith("arc/")) continue;
    const n = levitationCount(readFileSync(file, "utf8"));
    if (n > 0) counts.set(rel, n);
  }

  it("adds no new hover levitation", () => {
    const added: string[] = [];
    for (const [file, n] of counts) {
      const allowed = BASELINE[file] ?? 0;
      if (n > allowed) added.push(`${file}: ${n} (baseline ${allowed})`);
    }
    expect(added, "cards and rows use a border/background step on hover — only buttons lift").toEqual([]);
  });

  it("keeps the baseline honest — drop entries once a file is clean", () => {
    const stale = Object.keys(BASELINE).filter((f) => !counts.has(f));
    expect(stale, "these files no longer levitate; remove them from BASELINE").toEqual([]);
  });

  /**
   * The specific one this test shipped with. The send queue is where a human
   * confirms outbound, and it carried both banned effects at once.
   */
  it("leaves the outbox send queue calm", () => {
    const css = readFileSync(join(APP_DIR, "arc-app.css"), "utf8");
    const rule = css.split("\n").find((l) => l.includes(".oq-cards .card:hover")) ?? "";
    expect(rule).toContain("border-color");
    expect(rule, "no levitation on the send-confirmation cards").not.toMatch(/translateY\(-/);
    expect(rule, "no glow on the send-confirmation cards").not.toMatch(/box-shadow/);
  });
});

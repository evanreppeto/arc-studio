import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A caption inside a heading declares its own typeface.
 *
 * `globals.css` sets `h1, h2, h3 { font-family: var(--font-serif) }`, and that
 * is deliberate — Fraunces on headings is the "authored journal" signature.
 * The trap is what it does to anything nested INSIDE one.
 *
 * Two captions inherited it and rendered in the optical display serif at 10–12px:
 *
 *   .jr-sub2   set size, weight and colour and omitted family, so "how many
 *              contacts reach each stage" came out in Fraunces.
 *   .camphint  set `font-family: inherit`, which inside an <h2> means Fraunces —
 *              almost certainly written meaning "the body font".
 *
 * DESIGN.md §3 reserves Fraunces for display moments — "page-title heroes, the
 * Today greeting, persona/record hero names, auth headlines" — and says Geist
 * "carries headings, labels, body, and metrics". A muted 10.5px hint is none of
 * the former. It is the kind of thing that makes a screen feel subtly off
 * without anyone being able to name it.
 *
 * Scoped to non-/arc routes, for a measured reason rather than the blanket
 * exemption: /arc's section headings do not resolve to Fraunces at all, so the
 * captions inside them are already correct. This check reads the global
 * h1/h2/h3 rule and cannot see that, and it flagged one of them wrongly on its
 * first run.
 *
 * NOT a ban on `font-family: inherit`. There are 63 of those and nearly all are
 * correct: `inherit` is the standard way to stop a <button>, <input> or
 * <textarea> rendering in the UA's own font. Flagging them would bury the two
 * that matter. This checks one thing — a class used inside a heading names a
 * family — which is exactly where inheritance does the wrong thing.
 */

const APP_DIR = new URL(".", import.meta.url).pathname;

function filesWithExt(dir: string, ext: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) filesWithExt(full, ext, out);
    else if (full.endsWith(ext)) out.push(full);
  }
  return out;
}

/** Every class rendered inside an h1/h2/h3 in the app's TSX. */
function classesInsideHeadings(): Set<string> {
  const found = new Set<string>();
  for (const file of filesWithExt(APP_DIR, ".tsx")) {
    if (file.includes(".test.")) continue;
    // /arc excluded, and MEASURED rather than assumed: its section headings do
    // not resolve to Fraunces in the first place, so `.arc-work-section-meta`
    // already computes to Geist. A static check cannot see that — it reads the
    // global h1/h2/h3 rule and concludes wrongly. Verified in the browser by
    // building the real structure inside `.arc-app` and reading the cascade.
    if (file.includes("/arc/")) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/<h[123][^>]*>([\s\S]{0,400}?)<\/h[123]>/g)) {
      for (const c of m[1].matchAll(/className="([a-z0-9 _-]+)"/g)) {
        for (const name of c[1].split(/\s+/)) if (name) found.add(name);
      }
    }
  }
  return found;
}

/** Classes whose CSS rule declares a font-family (any value). */
function classesDeclaringFamily(): Set<string> {
  const declared = new Set<string>();
  for (const file of filesWithExt(APP_DIR, ".css")) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.includes("font-family")) continue;
      for (const m of line.split("{")[0].matchAll(/\.([a-z0-9_-]+)/g)) declared.add(m[1]);
    }
  }
  return declared;
}

describe("captions nested in headings name their own typeface", () => {
  it("has no styled caption inheriting the display serif from its heading", () => {
    const inside = classesInsideHeadings();
    const declared = classesDeclaringFamily();

    // Only classes that carry their own styling can be checked — a class with no
    // rule at all is a layout hook, not a caption.
    const styled = new Set<string>();
    for (const file of filesWithExt(APP_DIR, ".css")) {
      const css = readFileSync(file, "utf8");
      for (const name of inside) {
        if (new RegExp(`\\.${name}\\b[^{]*\\{[^}]*font-size`).test(css)) styled.add(name);
      }
    }

    const inheriting = [...styled].filter((name) => !declared.has(name)).sort();
    expect(
      inheriting,
      "these render in Fraunces because they sit inside a heading — declare var(--ff-body) or var(--mono)",
    ).toEqual([]);
  });

  it("keeps the two that were fixed explicit", () => {
    const css = readFileSync(join(APP_DIR, "arc-app.css"), "utf8");
    for (const name of ["jr-sub2", "camphint"]) {
      const rule = css.split("\n").find((l) => l.includes(`.${name} {`)) ?? "";
      expect(rule, `.${name} must name its own family`).toMatch(/font-family:\s*var\(--ff-body\)/);
    }
  });

  it("leaves the headings themselves in the display serif", () => {
    // The fix must not have reached the display moment it sits beside.
    const globals = readFileSync(new URL("../globals.css", import.meta.url), "utf8");
    expect(globals).toMatch(/h1,\s*h2,\s*h3\s*\{[\s\S]{0,120}font-family:\s*var\(--font-serif\)/);
  });
});

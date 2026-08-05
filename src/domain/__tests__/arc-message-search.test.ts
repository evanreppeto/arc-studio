import { describe, expect, it } from "vitest";

import {
  ARC_SEARCH_MIN_LENGTH,
  buildArcMessageSnippet,
  escapeLikePattern,
  isSearchableArcQuery,
} from "../arc-message-search";

describe("buildArcMessageSnippet", () => {
  it("windows the text around the match", () => {
    const snippet = buildArcMessageSnippet("We should focus on the pricing-intent accounts first.", "pricing");
    expect(snippet).not.toBeNull();
    expect(snippet!.match).toBe("pricing");
    expect(snippet!.before).toContain("focus on the ");
    expect(snippet!.after).toContain("-intent accounts");
  });

  it("matches case-insensitively but shows the body's own casing", () => {
    // Echoing the query's casing back would misquote the workspace's text.
    const snippet = buildArcMessageSnippet("Our Q4 Pricing Review is done.", "pricing");
    expect(snippet!.match).toBe("Pricing");
  });

  it("returns null when the query is absent rather than showing the head", () => {
    // A result that doesn't show why it matched is worse than no result.
    expect(buildArcMessageSnippet("Nothing relevant here.", "pricing")).toBeNull();
  });

  it("collapses markdown whitespace so the snippet reads as prose", () => {
    const snippet = buildArcMessageSnippet("## Heading\n\n- one\n- pricing tier\n", "pricing");
    expect(`${snippet!.before}${snippet!.match}${snippet!.after}`).not.toMatch(/\n/);
    expect(snippet!.before).toBe("Heading - one - ");
    expect(snippet!.before).not.toContain("#");
  });

  it("flags truncation on both sides so the UI can show ellipses", () => {
    const long = `${"a ".repeat(200)}pricing${" b".repeat(200)}`;
    const snippet = buildArcMessageSnippet(long, "pricing");
    expect(snippet!.truncatedStart).toBe(true);
    expect(snippet!.truncatedEnd).toBe(true);

    const short = buildArcMessageSnippet("pricing now", "pricing");
    expect(short!.truncatedStart).toBe(false);
    expect(short!.truncatedEnd).toBe(false);
  });

  it("keeps underscores inside identifiers but drops emphasis ones", () => {
    // `_` is markdown emphasis, so stripping it wholesale turned `lead_score`
    // into `lead score` and searching for a field name found nothing.
    expect(buildArcMessageSnippet("Sort by lead_score descending.", "lead_score")!.match).toBe("lead_score");
    const emphasised = buildArcMessageSnippet("This is _really_ urgent pricing work.", "pricing");
    expect(`${emphasised!.before}${emphasised!.match}`).not.toContain("_");
  });

  it("handles empty inputs without throwing", () => {
    expect(buildArcMessageSnippet("", "pricing")).toBeNull();
    expect(buildArcMessageSnippet("something", "   ")).toBeNull();
  });
});

describe("isSearchableArcQuery", () => {
  it("stays idle until the query can actually narrow anything", () => {
    expect(isSearchableArcQuery("p")).toBe(false);
    expect(isSearchableArcQuery("  ")).toBe(false);
    expect(isSearchableArcQuery("pr")).toBe(true);
    expect(ARC_SEARCH_MIN_LENGTH).toBe(2);
  });
});

describe("escapeLikePattern", () => {
  /**
   * The bug this prevents reads as "search is broken", not as an injection:
   * an unescaped `%` matches everything and `_` matches any character, so
   * searching for "50%" or "lead_score" returns the whole workspace.
   */
  it("neutralises ilike wildcards", () => {
    expect(escapeLikePattern("50%")).toBe("50\\%");
    expect(escapeLikePattern("lead_score")).toBe("lead\\_score");
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  it("leaves ordinary queries untouched", () => {
    expect(escapeLikePattern("pricing intent")).toBe("pricing intent");
  });
});

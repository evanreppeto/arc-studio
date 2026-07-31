import { describe, expect, it } from "vitest";

import {
  buildTouch,
  channelLabel,
  isEmptyTouch,
  landingPathFrom,
  mergeTouch,
  parseAttributionRecord,
  referrerHostFrom,
  rollupByChannel,
  serializeAttributionRecord,
  type AttributionTouch,
} from "../signup-attribution";

const AT = "2026-07-30T12:00:00.000Z";

function touch(partial: Partial<AttributionTouch> = {}): AttributionTouch {
  return {
    source: null,
    medium: null,
    campaign: null,
    term: null,
    content: null,
    referrerHost: null,
    landingPath: null,
    at: AT,
    ...partial,
  };
}

describe("referrerHostFrom", () => {
  it("keeps only the host, never the path or query", () => {
    // The privacy contract: a referrer URL routinely carries a search query.
    expect(referrerHostFrom("https://www.google.com/search?q=someones+name")).toBe("www.google.com");
  });

  it("drops self-referrals so internal navigation is not a channel", () => {
    expect(referrerHostFrom("https://arc-studio.ai/pricing", "arc-studio.ai")).toBeNull();
    expect(referrerHostFrom("https://ARC-STUDIO.AI/pricing", "arc-studio.ai")).toBeNull();
  });

  it("returns null for junk rather than throwing", () => {
    expect(referrerHostFrom("not a url")).toBeNull();
    expect(referrerHostFrom("")).toBeNull();
    expect(referrerHostFrom(null)).toBeNull();
    expect(referrerHostFrom(undefined)).toBeNull();
    expect(referrerHostFrom(42)).toBeNull();
  });
});

describe("landingPathFrom", () => {
  it("keeps the path and discards the query string", () => {
    expect(landingPathFrom("/compare/vs-agency?utm_source=g2")).toBe("/compare/vs-agency");
    expect(landingPathFrom("https://arc-studio.ai/industries/roofing?x=1#top")).toBe(
      "/industries/roofing",
    );
  });

  it("normalises a missing leading slash", () => {
    expect(landingPathFrom("pricing")).toBe("/pricing");
  });
});

describe("buildTouch", () => {
  it("reads all five utm params", () => {
    const t = buildTouch({
      search: "?utm_source=g2&utm_medium=directory&utm_campaign=listing&utm_term=x&utm_content=y",
      path: "/pricing",
      at: AT,
    });
    expect(t.source).toBe("g2");
    expect(t.medium).toBe("directory");
    expect(t.campaign).toBe("listing");
    expect(t.term).toBe("x");
    expect(t.content).toBe("y");
  });

  it("preserves hyphens and spaces in campaign values", () => {
    // Regression guard: an over-broad "strip control characters" class would eat
    // the hyphen out of a real campaign name and silently merge two channels.
    const t = buildTouch({ search: "?utm_campaign=summer-sale&utm_source=paid ads", at: AT });
    expect(t.campaign).toBe("summer-sale");
    expect(t.source).toBe("paid ads");
  });

  it("caps field length so a hostile URL cannot write an unbounded blob", () => {
    const t = buildTouch({ search: `?utm_source=${"a".repeat(500)}`, at: AT });
    expect(t.source).toHaveLength(128);
  });

  it("survives a malformed query string", () => {
    expect(() => buildTouch({ search: "%%%", at: AT })).not.toThrow();
  });
});

describe("isEmptyTouch", () => {
  it("treats a landing path alone as empty — a page view is not a channel", () => {
    expect(isEmptyTouch(touch({ landingPath: "/pricing" }))).toBe(true);
  });

  it("treats any channel signal as non-empty", () => {
    expect(isEmptyTouch(touch({ source: "g2" }))).toBe(false);
    expect(isEmptyTouch(touch({ referrerHost: "news.ycombinator.com" }))).toBe(false);
  });
});

describe("mergeTouch", () => {
  it("writes first touch once and never overwrites it", () => {
    // The core rule: the channel that FOUND the customer keeps the credit.
    const first = touch({ source: "g2", at: "2026-07-01T00:00:00.000Z" });
    const later = touch({ source: "google", medium: "cpc", at: "2026-07-20T00:00:00.000Z" });
    const merged = mergeTouch(mergeTouch(null, first), later);
    expect(merged.firstTouch.source).toBe("g2");
    expect(merged.lastTouch.source).toBe("google");
  });

  it("does not let an untagged later visit erase last touch", () => {
    // Someone arrives from G2, then comes back by typing the URL. That direct
    // visit must not overwrite the channel that actually referred them.
    const first = touch({ source: "g2" });
    const direct = touch({ landingPath: "/pricing" });
    const merged = mergeTouch(mergeTouch(null, first), direct);
    expect(merged.firstTouch.source).toBe("g2");
    expect(merged.lastTouch.source).toBe("g2");
  });

  it("seeds both touches on the very first visit", () => {
    const merged = mergeTouch(null, touch({ source: "hn" }));
    expect(merged.firstTouch.source).toBe("hn");
    expect(merged.lastTouch.source).toBe("hn");
  });

  it("promotes a real channel over a first touch that attributed nothing", () => {
    // Found by running it: land on the homepage untagged, click a G2 listing a
    // week later. Without promotion the signup is credited to "direct" forever
    // and the listing that actually produced it can never be credited.
    const directLanding = touch({ landingPath: "/", at: "2026-07-01T00:00:00.000Z" });
    const fromG2 = touch({ source: "g2", medium: "directory", at: "2026-07-08T00:00:00.000Z" });
    const merged = mergeTouch(mergeTouch(null, directLanding), fromG2);
    expect(merged.firstTouch.source).toBe("g2");
    expect(merged.lastTouch.source).toBe("g2");
  });

  it("never overwrites a first touch that already names a channel", () => {
    // The promotion rule must not weaken the rule that matters.
    const fromG2 = touch({ source: "g2", at: "2026-07-01T00:00:00.000Z" });
    const fromGoogle = touch({ source: "google", medium: "cpc", at: "2026-07-08T00:00:00.000Z" });
    const merged = mergeTouch(mergeTouch(null, fromG2), fromGoogle);
    expect(merged.firstTouch.source).toBe("g2");
    expect(merged.lastTouch.source).toBe("google");
  });
});

describe("parseAttributionRecord", () => {
  it("round-trips a serialized record", () => {
    const record = mergeTouch(null, touch({ source: "g2", medium: "directory" }));
    expect(parseAttributionRecord(serializeAttributionRecord(record))).toEqual(record);
  });

  it("returns null for anything malformed instead of throwing", () => {
    // This reads a cookie a visitor can edit. Attribution is never worth
    // failing a signup over.
    for (const bad of ["", "{", "null", "[]", "{}", '{"firstTouch":{}}', 42, null, undefined]) {
      expect(parseAttributionRecord(bad)).toBeNull();
    }
  });

  it("ignores unknown fields rather than trusting them", () => {
    const parsed = parseAttributionRecord(
      JSON.stringify({
        firstTouch: { source: "g2", at: AT, evil: "x" },
        lastTouch: { source: "g2", at: AT },
      }),
    );
    expect(parsed?.firstTouch).not.toHaveProperty("evil");
    expect(parsed?.firstTouch.source).toBe("g2");
  });
});

describe("channelLabel", () => {
  it("prefers an explicit utm_source, since we put it there ourselves", () => {
    expect(channelLabel(touch({ source: "g2", medium: "directory", referrerHost: "x.com" }))).toBe(
      "g2 / directory",
    );
    expect(channelLabel(touch({ source: "g2" }))).toBe("g2");
  });

  it("falls back to the referrer host, then to direct", () => {
    expect(channelLabel(touch({ referrerHost: "news.ycombinator.com" }))).toBe("news.ycombinator.com");
    expect(channelLabel(touch())).toBe("direct");
    expect(channelLabel(null)).toBe("direct");
  });
});

describe("rollupByChannel", () => {
  it("counts by channel, descending, with a stable tiebreak", () => {
    const rows = rollupByChannel([
      mergeTouch(null, touch({ source: "g2" })),
      mergeTouch(null, touch({ source: "g2" })),
      mergeTouch(null, touch({ referrerHost: "news.ycombinator.com" })),
      null,
    ]);
    expect(rows).toEqual([
      { channel: "g2", count: 2 },
      { channel: "direct", count: 1 },
      { channel: "news.ycombinator.com", count: 1 },
    ]);
  });

  it("can roll up by last touch instead", () => {
    const record = mergeTouch(mergeTouch(null, touch({ source: "g2" })), touch({ source: "google" }));
    expect(rollupByChannel([record], "lastTouch")).toEqual([{ channel: "google", count: 1 }]);
  });
});

import { describe, expect, it } from "vitest";

import {
  METADATA_RETENTION_DAYS,
  RETAINED_METADATA_KEYS,
  prunedMetadata,
  retentionCutoff,
} from "../metadata-retention";

/**
 * BSR-741. The payload hung off a message ages out at 90 days; the message and
 * its body do not. Shapes below are the real `arc_messages.metadata` keys
 * censused on prod — `recall` is the one carrying most of the contact details.
 */

describe("retentionCutoff", () => {
  it("is 90 days by default", () => {
    expect(METADATA_RETENTION_DAYS).toBe(90);
    const now = new Date("2026-08-04T00:00:00.000Z");
    expect(retentionCutoff(now).toISOString()).toBe("2026-05-06T00:00:00.000Z");
  });

  it("honours an explicit window", () => {
    const now = new Date("2026-08-04T00:00:00.000Z");
    expect(retentionCutoff(now, 30).toISOString()).toBe("2026-07-05T00:00:00.000Z");
  });
});

describe("prunedMetadata", () => {
  it("drops the payload keys that carry customer data", () => {
    const before = {
      mode: "ask",
      route: "standard",
      recall: [{ label: "a", summary: "call them on (312) 545-3376" }],
      toolCalls: [{ name: "mcp__arc__search_contacts", output: "{…}" }],
      steps: [{ label: "Reading your workspace" }],
      actions: [{ id: "a1" }],
      suggestions: ["next"],
    };
    expect(prunedMetadata(before)).toEqual({ mode: "ask", route: "standard" });
  });

  /**
   * The property behind the allowlist. A key nobody predicted is purged by
   * default; a purge-list would have silently kept it, which is how a retention
   * rule stops covering the newest data first.
   */
  it("purges a key that did not exist when the rule was written", () => {
    expect(prunedMetadata({ mode: "ask", somethingAddedLater: { phone: "312-545-3376" } })).toEqual({ mode: "ask" });
  });

  it("keeps only what the allowlist names, and only if present", () => {
    expect(prunedMetadata({ route: "fast", recall: [] })).toEqual({ route: "fast" });
    expect(prunedMetadata({ recall: [] })).toEqual({});
    for (const key of RETAINED_METADATA_KEYS) expect(["mode", "route"]).toContain(key);
  });

  /**
   * Idempotence, which is what stops a daily job rewriting identical JSON and
   * reporting work it did not do.
   */
  it("returns null when there is nothing left to prune", () => {
    expect(prunedMetadata({ mode: "ask", route: "standard" })).toBeNull();
    expect(prunedMetadata({})).toBeNull();
    expect(prunedMetadata(null)).toBeNull();
    expect(prunedMetadata(undefined)).toBeNull();
  });

  it("is stable across a second pass", () => {
    const once = prunedMetadata({ mode: "ask", recall: [{ label: "a" }] });
    expect(once).toEqual({ mode: "ask" });
    expect(prunedMetadata(once)).toBeNull();
  });
});

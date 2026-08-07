import { describe, expect, it } from "vitest";

import { CONNECTOR_REGISTRY } from "@/domain";

import { CATS, CONNECTORS } from "./connector-catalog";

/**
 * The Roadmap tab exists to say "this isn't built yet". Saying that about
 * something that IS built is the worst thing it can do — a customer reads the
 * roadmap, concludes Slack/HubSpot/Mailchimp/Resend/Webhooks don't exist, and
 * never opens the Live tab where all five have working cards. That is exactly
 * what shipped, because the filter excluded two connectors by display name and
 * nobody updated it as the others landed.
 *
 * The view now subtracts the live connector list by `liveKey`, so these tests
 * guard the one thing that can still silently break it: a liveKey that stops
 * matching a real connector, which puts a shipped integration back under a
 * "Planned" badge with no error anywhere.
 */
const REGISTRY_KEYS = new Set(CONNECTOR_REGISTRY.map((entry) => entry.key));
// The email connection is its own read-model, not a `workspace_connectors` row,
// so it is the one liveKey with no registry entry behind it.
const NON_REGISTRY_LIVE_KEYS = new Set(["resend"]);

describe("roadmap connector catalog", () => {
  it("points every liveKey at a connector that actually exists", () => {
    const dangling = CONNECTORS.filter(
      (c) => c.liveKey && !REGISTRY_KEYS.has(c.liveKey) && !NON_REGISTRY_LIVE_KEYS.has(c.liveKey),
    ).map((c) => `${c.n} → ${c.liveKey}`);
    // A dangling key is invisible in the UI: the row simply never matches a live
    // connector, so it keeps rendering as "Planned" forever.
    expect(dangling).toEqual([]);
  });

  it("claims a liveKey for every shipped integration it also lists", () => {
    // Each of these shipped while sitting in the catalog un-flagged, and each
    // was therefore advertised as Planned. Named individually so a regression
    // reports which one came back.
    const expected: Record<string, string> = {
      Resend: "resend",
      Slack: "slack-alerts",
      HubSpot: "hubspot-import",
      Mailchimp: "mailchimp-import",
      Webhooks: "webhook-dispatch",
      "Gemini Web Research": "gemini-research",
      Higgsfield: "higgsfield",
    };
    for (const [name, key] of Object.entries(expected)) {
      const row = CONNECTORS.find((c) => c.n === name);
      expect(row, `${name} is missing from the catalog`).toBeDefined();
      expect(row?.liveKey, `${name} would be listed as "Planned"`).toBe(key);
    }
  });

  it("files every roadmap-visible row under a category the filter chips can reach", () => {
    // A row in a category with no chip is unreachable once anything but "All"
    // is selected. Only rows the roadmap can actually render need one — the
    // catalog also carries shipped connectors (filtered out by liveKey), and
    // "Research" deliberately has no chip because its only member is live.
    const chips = new Set(CATS.filter((c) => c !== "All"));
    const orphaned = CONNECTORS.filter((c) => !c.liveKey && !chips.has(c.cat)).map((c) => `${c.n} (${c.cat})`);
    expect(orphaned).toEqual([]);
  });

  it("does not name a real tenant in its example copy", () => {
    // This catalog is shown to every prospect in the backend-less preview.
    const blob = JSON.stringify(CONNECTORS).toLowerCase();
    for (const forbidden of ["big shoulders", "bigshoulders", "servpro", "summit restoration"]) {
      expect(blob).not.toContain(forbidden);
    }
  });
});

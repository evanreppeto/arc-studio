import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The media lightbox is a `Modal`, and `Modal` portals to `#arc-overlay-root` —
 * a child of `.arc-app`, not of the campaign page. Every rule the dialog needs
 * is written `.arc-campaign .lb…`, so the portal put the whole dialog outside
 * its own stylesheet: it shipped rendering as raw markup, with a full-bleed
 * uncapped image and the risk-flag warning icon at its intrinsic size, taller
 * than the creative it was flagging. Nothing failed — the markup was right, the
 * selectors just never matched.
 *
 * That is unreviewable by eye and invisible to a render test that only asserts
 * text, so the contract is asserted here: the scope travels with the portaled
 * subtree on a `display: contents` wrapper (same shape as `.rq-scope` for the
 * review queue), and it is on BOTH halves — `Modal` renders `footer` as a
 * sibling of the body, not inside it, so one wrapper covers only one of them.
 */
const DIR = join(process.cwd(), "src/app/(app)/campaigns");
const view = readFileSync(join(DIR, "[campaignId]/_components/campaign-detail-view.tsx"), "utf8");
const css = readFileSync(join(DIR, "campaign.css"), "utf8");

/** The lightbox's own classes — every one of them route-scoped in campaign.css. */
const LIGHTBOX_CLASSES = ["lbgrid", "lbstage", "lbside", "lbstatus", "lbrisk", "lbmeta", "lbsec", "lbstepper"];

describe("media lightbox portal scope", () => {
  it("keeps every lightbox rule scoped to the campaign route", () => {
    // If this ever stops being true the wrapper below may be unnecessary — but
    // find that out here rather than by shipping an unstyled dialog again.
    for (const cls of LIGHTBOX_CLASSES) {
      expect(css, `${cls} should be scoped .arc-campaign`).toMatch(
        new RegExp(`\\.arc-campaign\\s+\\.${cls}\\b`),
      );
    }
  });

  it("declares the scope hook as display: contents", () => {
    // A wrapper that contributed a box would become a flex/grid item of the
    // modal body and change its layout; `contents` carries the class and no box.
    expect(css).toMatch(/\.arc-app\s+\.lb-scope\s*\{[^}]*display:\s*contents/);
  });

  it("carries the scope into the portal on both the body and the footer", () => {
    const wrappers = view.match(/className="arc-campaign lb-scope"/g) ?? [];
    expect(wrappers.length).toBeGreaterThanOrEqual(2);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const VIEW_SOURCE = readFileSync(
  new URL("../../app/(app)/arc/_components/arc-view.tsx", import.meta.url),
  "utf8",
);
const CSS_SOURCE = readFileSync(
  new URL("../../app/(app)/arc/arc.css", import.meta.url),
  "utf8",
);

describe("Arc UI accessibility contract", () => {
  it("exposes the resolved workspace capability beside the composer", () => {
    expect(VIEW_SOURCE).toContain("arc-mode-button");
    expect(VIEW_SOURCE).toContain("Capability: ${capabilityLabel}");
    expect(VIEW_SOURCE).toContain('aria-label={composerMenu === "commands" ? "Skills menu" : composerMenu === "mode" ? "Capability menu"');
  });

  it("keeps the icon-only mobile review action named", () => {
    expect(VIEW_SOURCE).toContain('aria-label={`${needsReviewCards.length} items need review`}');
  });

  it("does not steal the global Command-K shortcut for drawer search", () => {
    expect(VIEW_SOURCE).not.toContain("event.metaKey || event.ctrlKey");
    expect(VIEW_SOURCE).not.toContain("⌘K");
  });

  it("keeps phone drawer actions visible and touch-sized", () => {
    expect(CSS_SOURCE).toContain(".arc-history-menu-btn { width: 44px; height: 44px; margin-right: 0; opacity: 1; }");
    // The drawer runs on one type scale (`--dz-*` on `.arc-history`); on phones
    // the nav steps up one rung from the base `--dz-xs` for touch. Asserting the
    // token rather than a literal keeps this from breaking every time the scale
    // is retuned — the contract is "bigger than the desktop size", not "10.5px".
    expect(CSS_SOURCE).toContain(".arc-drawer-nav button { font-size: var(--dz-sm); }");
    expect(CSS_SOURCE).toContain(".arc-drawer-nav button { flex: 1 1 auto;");
  });

  it("keeps mobile safety visible while shrinking the context ring inside its tap target", () => {
    expect(CSS_SOURCE).toContain(".arc-mode-button small { display: inline; font-size: 8px; }");
    expect(CSS_SOURCE).toContain(".arc-context-meter { --arc-context-ring: 21px; min-height: 44px; }");
    expect(VIEW_SOURCE).toContain("Automatic → {capabilityLabel}");
  });

  it("uses compact composer popovers", () => {
    expect(CSS_SOURCE).toContain("width: min(310px, calc(100% - 22px));");
    expect(CSS_SOURCE).toContain("width: min(272px, calc(100% - 56px));");
    expect(CSS_SOURCE).toContain("width: min(190px, calc(100vw - 28px));");
  });

  it("never prefetches the blank-chat transition and explains live history failures", () => {
    expect(VIEW_SOURCE).toContain('href="/arc?new=1" className="arc-new-chat" prefetch={false}');
    expect(VIEW_SOURCE).toContain("History is temporarily unavailable.");
    expect(VIEW_SOURCE).toContain("live && historyLoadError");
  });
});

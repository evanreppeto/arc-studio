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

  it("never calls a connector that was only ever off 'Paused'", () => {
    // `disabled` is simply `!enabled`. Calling it "Paused" told operators a
    // connector had been running and got suspended, which on a fresh workspace
    // was true of nothing and shown on every row.
    expect(VIEW_SOURCE).toContain('if (status === "disabled") return "Off";');
    expect(VIEW_SOURCE).toContain('if (status === "unavailable") return "Not available yet";');
    expect(VIEW_SOURCE).not.toContain('return "Paused"');
  });

  it("switches connectors through the shared Settings action, not a second write path", () => {
    // The operator gate, org scoping and upsert behaviour must stay in one
    // place; the drawer adds a control, not another way into the rows.
    expect(VIEW_SOURCE).toContain('import { toggleConnectorEnabled } from "../../settings/connectors-actions"');
    expect(VIEW_SOURCE).toContain("toggleConnectorEnabled({ connectorKey: connector.key, enabled: !connector.enabled })");
    // A switch that silently fails to save is the failure this surface removes.
    expect(VIEW_SOURCE).toContain("else if (!result.persisted) setConnectorError(");
  });

  it("does not clamp connector copy into an unreadable stub", () => {
    // The old 2-line clamp cut settings prose mid-word in a 386px panel, and the
    // rest was unreachable. Rows size to the registry's one-line summary instead.
    expect(CSS_SOURCE).toContain(".arc-connector-copy p { margin: 0;");
    expect(VIEW_SOURCE).toContain("connector.capabilitySummary || connector.description");
  });
});

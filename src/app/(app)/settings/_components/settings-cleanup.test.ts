import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const SETTINGS_VIEW = readFileSync(new URL("./settings-view.tsx", import.meta.url), "utf8");
const WORKSPACE_IDENTITY = readFileSync(new URL("./workspace-identity-modal.tsx", import.meta.url), "utf8");

describe("settings information architecture", () => {
  it("keeps unfinished behavior and notification controls out of primary settings", () => {
    expect(SETTINGS_VIEW).not.toContain('["behavior", "Behavior"]');
    expect(SETTINGS_VIEW).not.toContain('["notifications", "Notifications"]');
    expect(SETTINGS_VIEW).not.toContain("data-soon=");
  });

  it("names organization branding and workspace overrides honestly", () => {
    expect(SETTINGS_VIEW).toContain('["general", "Organization & brand"]');
    expect(SETTINGS_VIEW).toContain('label="Brand logo"');
    expect(WORKSPACE_IDENTITY).toContain("Sidebar logo override");
    expect(WORKSPACE_IDENTITY).toContain("Leave blank to use the organization’s brand logo.");
  });
});

describe("settings interaction semantics", () => {
  it("uses native buttons for navigation and interactive cards", () => {
    expect(SETTINGS_VIEW).toContain('className={`setitem${it[0] === cur ? " on" : ""}`}');
    // The `ovcard` row this used to assert on is gone: Overview's four tiles
    // restated the Workspace panel directly beneath them (Team twice, less
    // completely in the tile), so they were folded into it as rows. The rule
    // the assertion was protecting — native <button>, never role="button" —
    // still binds every remaining clickable, including those rows' buttons.
    expect(SETTINGS_VIEW).not.toContain('className="ovcard"');
    expect(SETTINGS_VIEW).toContain('type="button" className="ccard ccard-btn"');
    expect(SETTINGS_VIEW).not.toContain('role="button"');
  });

  it("routes runner shortcuts to the real Agent subtab", () => {
    expect(SETTINGS_VIEW).not.toContain('navTo("agent")');
    expect(SETTINGS_VIEW).toContain('navTo("general", "Agent")');
  });
});

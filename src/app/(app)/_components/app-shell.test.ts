import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const APP_SHELL = readFileSync(new URL("./app-shell.tsx", import.meta.url), "utf8");
const ACCOUNT_MENU = readFileSync(new URL("./account-menu.tsx", import.meta.url), "utf8");
const WORKSPACE_SWITCHER = readFileSync(new URL("./workspace-switcher.tsx", import.meta.url), "utf8");
const APP_SHELL_CSS = readFileSync(new URL("../arc-app.css", import.meta.url), "utf8");

describe("app shell navigation contract", () => {
  it("names Arc as a chat destination and exposes the active page", () => {
    expect(APP_SHELL).toContain('{ label: "Arc Chat", href: "/arc"');
    expect(APP_SHELL).toContain('"/arc": "Arc Chat"');
    expect(APP_SHELL).toContain('aria-current={active ? "page" : undefined}');
  });

  it("describes attention badges instead of announcing an unexplained number", () => {
    expect(APP_SHELL).toContain("campaign approval");
    expect(APP_SHELL).toContain("waiting on you");
    expect(APP_SHELL).toContain("open opportunit");
    expect(APP_SHELL).toContain("aria-label={attentionLabel}");
    expect(APP_SHELL).toContain("title={attentionLabel}");
  });

  it("treats the mobile rail as a modal drawer", () => {
    expect(APP_SHELL).toContain('aria-controls="app-navigation"');
    expect(APP_SHELL).toContain('aria-label="Close navigation"');
    expect(APP_SHELL).toContain("inert={isMobileNav && !navOpen ? true : undefined}");
    expect(APP_SHELL).toContain("inert={isMobileNav && navOpen ? true : undefined}");
    expect(APP_SHELL).toContain('event.key === "Escape"');
    expect(APP_SHELL).toContain("FOCUSABLE_NAV_SELECTOR");
  });

  it("makes both account entry points open the same menu", () => {
    expect(APP_SHELL).toContain('aria-label={`Open account menu for ${displayName}`}');
    expect(APP_SHELL).toContain('new Event("arc:open-account-menu")');
    expect(ACCOUNT_MENU).toContain('"arc:open-account-menu"');
    expect(ACCOUNT_MENU).toContain('querySelector<HTMLElement>(\'[role="menuitem"]\')');
  });

  it("does not repeat an identical workspace subtitle", () => {
    expect(WORKSPACE_SWITCHER).toContain("const showSubtitle =");
    expect(WORKSPACE_SWITCHER).toContain("{showSubtitle &&");
  });

  it("keeps a custom workspace label without repeating the derived default", () => {
    expect(APP_SHELL).toContain("const showWorkspaceShortLabel =");
    expect(APP_SHELL).toContain("derivedShortLabel(orgName)");
    expect(APP_SHELL).toContain("{showWorkspaceShortLabel &&");
  });

  it("separates workspace identity from navigation and surfaces recent Arc work", () => {
    expect(APP_SHELL).toContain('className="rail-divider"');
    expect(APP_SHELL).toContain('id="rail-recents-title"');
    expect(APP_SHELL).toContain('href={`/arc?c=${encodeURIComponent(conversation.id)}`}');
    expect(APP_SHELL).toContain('href="/arc?new=1"');
    expect(APP_SHELL_CSS).toContain("& .rail-divider");
    expect(APP_SHELL_CSS).toContain("& .rail-recents");
  });

  it("keeps mobile shell controls at a touch-friendly size", () => {
    expect(APP_SHELL_CSS).toContain("& .menubtn { display: inline-grid; width: 44px; height: 44px; }");
    expect(APP_SHELL_CSS).toContain("& .topav { width: 44px; height: 44px; }");
    expect(APP_SHELL_CSS).toContain("& .railclose:focus-visible");
    expect(APP_SHELL_CSS).toContain("outline: 2px solid var(--accent)");
  });
});

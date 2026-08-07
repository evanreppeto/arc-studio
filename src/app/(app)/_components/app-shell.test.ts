import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const APP_SHELL = readFileSync(new URL("./app-shell.tsx", import.meta.url), "utf8");
const ACCOUNT_MENU = readFileSync(new URL("./account-menu.tsx", import.meta.url), "utf8");
const WORKSPACE_SWITCHER = readFileSync(new URL("./workspace-switcher.tsx", import.meta.url), "utf8");
const RAIL_RECENTS = readFileSync(new URL("./rail-recents.tsx", import.meta.url), "utf8");
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
    expect(APP_SHELL).toContain("<RailRecents");
    // The rows moved into their own component when the list gained campaign
    // grouping and a per-chat menu; the shell still owns the section around them.
    expect(RAIL_RECENTS).toContain('href={`/arc?c=${encodeURIComponent(conversation.id)}`}');
    expect(APP_SHELL).toContain('href="/arc?new=1"');
    expect(APP_SHELL_CSS).toContain("& .rail-divider");
    expect(APP_SHELL_CSS).toContain("& .rail-recents");
  });

  /**
   * The rail's campaign grouping shipped in #921 and never rendered once on
   * prod: it needed two chats sharing a campaign AND both inside the newest
   * five, and every campaign-bearing chat is older than that. These pin the
   * three things that make a folder a folder rather than a coincidence.
   */
  it("files chats under standing campaign folders, not a conditional grouping", () => {
    // Reserved budget. Reverting to a flat top-5 read puts folders back out of
    // reach no matter what this component does with them.
    expect(RAIL_RECENTS).toContain("groupRailConversations");
    expect(RAIL_RECENTS).not.toContain("items.length < 2");
    // A folder is a control: a real button that says whether it is open.
    expect(RAIL_RECENTS).toContain('className="rail-folder-head"');
    expect(RAIL_RECENTS).toContain("aria-expanded={open}");
    // ...and it opens where the work is, without overriding a deliberate collapse.
    expect(RAIL_RECENTS).toContain("folderOpen[folder.campaignId] ?? (holdsOpen || running || index === 0)");
    expect(RAIL_RECENTS).toContain("Show {folder.items.length - shown.length} more");
    expect(APP_SHELL_CSS).toContain("& .rail-folder-head");
    expect(APP_SHELL_CSS).toContain("& .rail-folder-body");
  });

  /**
   * Third time for this exact failure. A grid/flex item's default
   * `min-width: auto` floors it at its content's intrinsic width, so
   * `text-overflow: ellipsis` on the label inside never fires and the row grows
   * past the rail instead. #978 fixed it on the old group header; measured again
   * here on the folder head with prod's longest campaign name — 386px inside a
   * 252px rail, 175px clipped, taking the chat count with it. Demo names are
   * short enough to hide it, which is why it needs a test and not an eyeball.
   */
  it("lets a long campaign name ellipsize instead of growing the rail", () => {
    for (const rule of ["& .rail-folder {", "& .rail-folder-head {", "& .rail-folder-body {"]) {
      const declarations = APP_SHELL_CSS.slice(APP_SHELL_CSS.indexOf(rule)).split("}")[0];
      expect(declarations, `${rule} needs min-width: 0`).toContain("min-width: 0");
    }
    expect(APP_SHELL_CSS).toContain("& .rail-folder-name { min-width: 0;");
    expect(APP_SHELL_CSS).toContain("& .rail-folder-body .rail-recent-wrap { min-width: 0; }");
    // The backstop that turns a future miss into clipping rather than a rail
    // that scrolls sideways.
    expect(APP_SHELL_CSS).toContain("overflow-y: auto; overflow-x: hidden;");
  });

  it("gives nav destinations room to read as separate rows", () => {
    // 13 destinations at 32px, flush, under headers 13px away read as one
    // striped block. The rail had the height to spare.
    expect(APP_SHELL).toContain('className="nav-group"');
    // `flex: none` because .navwrap is a flex column now (the chat list below is
    // the part that flexes). Without it these default to `flex: 0 1 auto` and
    // squash on a short viewport, which is the striped block this fixed.
    expect(APP_SHELL_CSS).toContain("& .nav-primary, & .nav-group { flex: none; display: grid; gap: 2px; }");
    expect(APP_SHELL_CSS).toContain("min-height: 36px");
    expect(APP_SHELL_CSS).toContain("& .grp { font-size: 10.5px; font-weight: 600; letter-spacing: 0.11em; color: color-mix(in srgb, var(--muted) 72%, var(--text-2)); padding: 16px 10px 6px; }");
  });

  it("keeps mobile shell controls at a touch-friendly size", () => {
    expect(APP_SHELL_CSS).toContain("& .menubtn { display: inline-grid; width: 44px; height: 44px; }");
    expect(APP_SHELL_CSS).toContain("& .topav { width: 44px; height: 44px; }");
    expect(APP_SHELL_CSS).toContain("& .railclose:focus-visible");
    expect(APP_SHELL_CSS).toContain("outline: 2px solid var(--accent)");
  });
});

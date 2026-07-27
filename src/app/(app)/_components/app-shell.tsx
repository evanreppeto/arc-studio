"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { getProductLanguage } from "@/lib/product-language";

import { AccountMenu } from "./account-menu";
import { ComingSoonToasts } from "./coming-soon";
import { CommandPalette, type CommandItem } from "./command-palette";
import { NavProgress } from "./nav-progress";
import { RoutePrewarm } from "./route-prewarm";
import { WorkspaceSwitcher, type WorkspaceOption } from "./workspace-switcher";

function initials(name: string): string {
  return (
    (name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "A"
  );
}

const IconArc = <span className="nav-arc-icon" aria-hidden="true" />;
const IconHome = <svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>;
const IconCampaigns = <svg viewBox="0 0 24 24"><path d="M4 5h16v6H4z" /><path d="M4 15h10v4H4z" /></svg>;
const IconCrm = <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3" /><path d="M4 20c0-3 2-5 5-5s5 2 5 5" /><path d="M16 6h5M16 10h5" /></svg>;
const IconOpp = <svg viewBox="0 0 24 24"><path d="M12 3l2.5 5 5.5.8-4 4 1 5.5L12 21l-5-2.7 1-5.5-4-4 5.5-.8z" /></svg>;
const IconAnalytics = <svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-8" /></svg>;
const IconBrain = <svg viewBox="0 0 24 24"><path d="M12 4a4 4 0 00-4 4 3 3 0 00-1 6 3 3 0 003 3 3 3 0 006 0 3 3 0 003-3 3 3 0 00-1-6 4 4 0 00-4-4z" /></svg>;
const IconPersonas = <svg viewBox="0 0 24 24"><circle cx="8" cy="9" r="2.5" /><circle cx="16" cy="9" r="2.5" /><path d="M3 19c0-3 2-4.5 5-4.5M21 19c0-3-2-4.5-5-4.5M9 19c0-2 1.5-3 3-3s3 1 3 3" /></svg>;
const IconJourneys = <svg viewBox="0 0 24 24"><path d="M6 6h6a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h10" /><circle cx="6" cy="6" r="1.7" /><circle cx="18" cy="18" r="1.7" /></svg>;
const IconStudio = <svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z" /><path d="M4 14l5-4 4 3 3-2 4 3" /><circle cx="9" cy="9" r="1.4" /></svg>;
const IconLibrary = <svg viewBox="0 0 24 24"><path d="M4 7h6l2 2h8v10H4z" /></svg>;
const IconBrand = <svg viewBox="0 0 24 24"><path d="M12 3l8 4v6c0 4-3.5 7-8 8-4.5-1-8-4-8-8V7z" /></svg>;
const IconOutbox = <svg viewBox="0 0 24 24"><path d="M3 12l18-8-8 18-2-7z" /></svg>;

type NavGroup = { group: string; items: { label: string; href: string; icon: React.ReactNode }[] };

const PRIMARY_NAV_ITEMS: NavGroup["items"] = [
  { label: "Arc", href: "/arc", icon: IconArc },
  { label: "Home", href: "/home", icon: IconHome },
  { label: "Campaigns", href: "/campaigns", icon: IconCampaigns },
  { label: "Relationships", href: "/crm", icon: IconCrm },
  { label: "Opportunities", href: "/opportunities", icon: IconOpp },
];

const ADVANCED_NAV_GROUPS: NavGroup[] = [
  { group: "Measure", items: [{ label: "Analytics", href: "/analytics", icon: IconAnalytics }] },
  {
    group: "Intelligence",
    items: [
      { label: "Journeys", href: "/journeys", icon: IconJourneys },
      { label: "Brain", href: "/brain", icon: IconBrain },
      { label: "Personas", href: "/personas", icon: IconPersonas },
    ],
  },
  {
    group: "Create & manage",
    items: [
      { label: "Studio", href: "/studio", icon: IconStudio },
      { label: "Library", href: "/library", icon: IconLibrary },
      { label: "Brand", href: "/brand", icon: IconBrand },
      { label: "Outbox", href: "/outbox", icon: IconOutbox },
    ],
  },
];

function navGroupsFor(crmLabel: string): NavGroup[] {
  return [
    {
      group: "Workspace",
      items: PRIMARY_NAV_ITEMS.map((item) => (item.href === "/crm" ? { ...item, label: crmLabel } : item)),
    },
    ...ADVANCED_NAV_GROUPS,
  ];
}

// Every top-level route, warmed in the background after load (see RoutePrewarm)
// so the first click on each tab is primed rather than a cold fetch.
const PREWARM_HREFS = navGroupsFor("Relationships").flatMap((g) => g.items.map((it) => it.href));

const CRUMBS: Record<string, string> = {
  "/arc": "Arc",
  "/home": "Home",
  "/campaigns": "Campaigns",
  "/campaigns/new": "New campaign",
  "/crm": "Relationships",
  "/analytics": "Analytics",
  "/brain": "Brain",
  "/journeys": "Journeys",
  "/opportunities": "Opportunities",
  "/personas": "Personas",
  "/outbox": "Outbox",
  "/library": "Library",
  "/brand": "Brand",
  "/studio": "Studio",
  "/settings": "Settings",
};

export function AppShell({
  workspaceName,
  orgName,
  userName,
  userEmail,
  logoUrl = null,
  avatarUrl = null,
  industry = "general",
  workspaces = [],
  navBadges = {},
  children,
}: {
  workspaceName: string;
  orgName: string;
  userName: string;
  userEmail: string;
  logoUrl?: string | null;
  avatarUrl?: string | null;
  industry?: string | null;
  workspaces?: WorkspaceOption[];
  navBadges?: Record<string, number>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const language = getProductLanguage(industry);
  const navGroups = navGroupsFor(language.crmLabel);
  // Mobile nav drawer. Below the shell breakpoint the rail is an off-canvas
  // drawer toggled from the top bar; on desktop `navOpen` is inert (the rail is
  // always visible). Tapping a destination closes it (see the nav links), and
  // so does the backdrop.
  const [navOpen, setNavOpen] = useState(false);
  const displayName = userName || orgName;
  // No signed-in user (local/demo, open mode) → a neutral label instead of a
  // bare "there". Prod shows the real viewer's first name.
  const firstName = userName.split(/\s+/)[0] || "Account";
  const baseCrumb = CRUMBS[pathname] ?? CRUMBS[`/${pathname.split("/")[1] ?? ""}`] ?? "Home";
  const crumb = pathname === "/crm" || pathname.startsWith("/crm/") ? language.crmLabel : baseCrumb;
  const commandItems: CommandItem[] = [
    ...navGroups.flatMap((g) => g.items.map((it) => ({ label: it.label, href: it.href, group: g.group }))),
    { label: "New campaign", href: "/campaigns", group: "Action", keywords: "create draft" },
    { label: "Scan for opportunities", href: "/opportunities", group: "Action", keywords: "find leads" },
    { label: "Settings", href: "/settings", group: "Workspace", keywords: "team account tokens" },
  ];

  // The static mockup gallery can load a ported real screen inside its crossfade
  // iframe. When that happens the gallery host already provides the sidebar, so
  // this shell must drop its own rail (the two would stack — the double-sidebar
  // bug). Mirrors the mockup pages' own `is-embedded` contract. Read via
  // useSyncExternalStore so the server renders "not embedded" and the client
  // corrects after hydration without a mismatch (the value never changes).
  const embedded = useSyncExternalStore(
    () => () => {},
    () => window.self !== window.top,
    () => false,
  );

  return (
    <div className={embedded ? "arc-app is-embedded" : "arc-app"}>
      <NavProgress />
      <RoutePrewarm hrefs={PREWARM_HREFS} />
      <div className="app" data-nav-open={navOpen}>
        {/* Backdrop behind the mobile drawer — tap to dismiss. Inert on desktop
            (the rail is docked, so this never covers content there). */}
        <button
          type="button"
          className="rail-scrim"
          aria-hidden={!navOpen}
          tabIndex={-1}
          onClick={() => setNavOpen(false)}
        />
        <aside className="rail" data-open={navOpen}>
          <WorkspaceSwitcher workspaceName={workspaceName} orgName={orgName} logoUrl={logoUrl} workspaces={workspaces} />
          <div className="indtag">
            <i />
            {orgName.split(/\s+/)[0]?.toUpperCase()} workspace
          </div>
          <div className="navwrap">
            {navGroups.slice(0, 1).map((g) => (
              <div key={g.group}>
                <div className="grp">{g.group.toUpperCase()}</div>
                {g.items.map((it) => {
                  const active = pathname === it.href || (it.href !== "/" && pathname.startsWith(`${it.href}/`));
                  const badge = navBadges[it.href] ?? 0;
                  return (
                    // Default prefetch is ON: with (app)/loading.tsx each route has a
                    // loading boundary, so prefetch only fetches the cheap skeleton shell
                    // (no DB reads) and clicks resolve to instant feedback + a crossfade.
                    <Link
                      key={it.label}
                      href={it.href}
                      className={`nav${active ? " on" : ""}`}
                      onClick={() => setNavOpen(false)}
                    >
                      {active && <span className="tick" />}
                      {it.icon}
                      {it.label}
                      {badge > 0 && (
                        <span className="navbadge" aria-label={`${badge} needing attention`}>
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
            {navGroups.slice(1).map((g) => (
              <div key={g.group}>
                <div className="grp">{g.group.toUpperCase()}</div>
                {g.items.map((it) => {
                  const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
                  const badge = navBadges[it.href] ?? 0;
                  return (
                    <Link key={it.label} href={it.href} className={`nav${active ? " on" : ""}`} onClick={() => setNavOpen(false)}>
                      {active && <span className="tick" />}
                      {it.icon}
                      {it.label}
                      {badge > 0 && <span className="navbadge" aria-label={`${badge} needing attention`}>{badge > 99 ? "99+" : badge}</span>}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
          <AccountMenu
            firstName={firstName}
            displayName={displayName}
            email={userEmail}
            initials={initials(displayName)}
            avatarUrl={avatarUrl}
            settingsHref="/settings"
          />
        </aside>

        <div className="main">
          <header className="top">
            {/* Hamburger — opens the nav drawer. Shown only below the shell
                breakpoint (CSS); on desktop the docked rail makes it redundant. */}
            <button
              type="button"
              className="menubtn"
              aria-label="Open navigation"
              aria-expanded={navOpen}
              onClick={() => setNavOpen((v) => !v)}
            >
              <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <span className="crumb">{crumb}</span>
            <button
              type="button"
              className="search"
              onClick={() => window.dispatchEvent(new Event("arc:open-command"))}
            >
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
              Search or jump to…
              <span className="k">⌘K</span>
            </button>
            <span className="topav">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- user-uploaded avatar; next/image would need per-host remotePatterns
                <img src={avatarUrl} alt={displayName} />
              ) : (
                initials(displayName)
              )}
            </span>
          </header>
          <CommandPalette items={commandItems} />
          {children}
        </div>
      </div>
      <ComingSoonToasts />
    </div>
  );
}

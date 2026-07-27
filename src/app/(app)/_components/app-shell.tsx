"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { getProductLanguage } from "@/lib/product-language";

import { AccountMenu } from "./account-menu";
import { ComingSoonToasts } from "./coming-soon";
import { type TrialBanner } from "@/lib/billing/trial-banner";

import { CommandPalette, type CommandItem } from "./command-palette";
import { NavProgress } from "./nav-progress";
import { RoutePrewarm } from "./route-prewarm";
import { TrialNotice } from "./trial-notice";
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

function NavIcon({ src }: { src: string }) {
  return (
    <span
      className="nav-image-icon"
      aria-hidden="true"
      style={{ "--nav-icon": `url(${src})` } as React.CSSProperties}
    />
  );
}

const IconArc = <NavIcon src="/brand/nav-icons/arc-chat-icon.png" />;
const IconHome = <NavIcon src="/brand/nav-icons/sidebar-v2/home.png" />;
const IconCampaigns = <NavIcon src="/brand/nav-icons/sidebar-v2/campaigns.png" />;
const IconCrm = <NavIcon src="/brand/nav-icons/sidebar-v2/relationships.png" />;
const IconOpp = <NavIcon src="/brand/nav-icons/sidebar-v2/opportunities.png" />;
const IconAnalytics = <NavIcon src="/brand/nav-icons/sidebar-v2/analytics.png" />;
const IconJourneys = <NavIcon src="/brand/nav-icons/sidebar-v2/journeys.png" />;
const IconBrain = <NavIcon src="/brand/nav-icons/sidebar-v2/brain.png" />;
const IconPersonas = <NavIcon src="/brand/nav-icons/sidebar-v2/personas.png" />;
const IconStudio = <NavIcon src="/brand/nav-icons/sidebar-v2/studio.png" />;
const IconLibrary = <NavIcon src="/brand/nav-icons/sidebar-v2/library.png" />;
const IconBrand = <NavIcon src="/brand/nav-icons/sidebar-v2/brand.png" />;
const IconOutbox = <NavIcon src="/brand/nav-icons/sidebar-v2/outbox.png" />;

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
  "/support": "Help & support",
};

export function AppShell({
  workspaceName,
  orgName,
  workspaceSubtitle,
  workspaceShortLabel,
  workspaceAccentColor = null,
  userName,
  userEmail,
  logoUrl = null,
  avatarUrl = null,
  industry = "general",
  workspaces = [],
  navBadges = {},
  trialBanner = null,
  children,
}: {
  workspaceName: string;
  orgName: string;
  /** Resolved rail identity — see resolveWorkspaceIdentity in @/domain. */
  workspaceSubtitle: string;
  workspaceShortLabel: string;
  workspaceAccentColor?: string | null;
  userName: string;
  userEmail: string;
  logoUrl?: string | null;
  avatarUrl?: string | null;
  industry?: string | null;
  workspaces?: WorkspaceOption[];
  navBadges?: Record<string, number>;
  trialBanner?: TrialBanner | null;
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
    {
      label: "Help & support",
      href: "/support",
      group: "Workspace",
      keywords: "help support contact bug report issue problem broken feedback",
    },
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
          <WorkspaceSwitcher
            workspaceName={workspaceName}
            orgName={orgName}
            subtitle={workspaceSubtitle}
            logoUrl={logoUrl}
            accentColor={workspaceAccentColor}
            workspaces={workspaces}
          />
          <div
            className="indtag"
            style={workspaceAccentColor ? ({ "--ws-accent": workspaceAccentColor } as React.CSSProperties) : undefined}
          >
            <i />
            {workspaceShortLabel}
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
          {/* Pinned above the account control: when something is broken, the way
              to reach a human has to be visible without hunting through a menu. */}
          <Link
            href="/support"
            className={`railhelp${pathname === "/support" || pathname.startsWith("/support/") ? " on" : ""}`}
            onClick={() => setNavOpen(false)}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4" />
              <path d="M12 17h.01" />
            </svg>
            Help &amp; support
          </Link>
          <AccountMenu
            firstName={firstName}
            displayName={displayName}
            email={userEmail}
            initials={initials(displayName)}
            avatarUrl={avatarUrl}
            settingsHref="/settings"
            supportHref="/support"
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
          <TrialNotice banner={trialBanner} />
          {children}
        </div>
      </div>
      <ComingSoonToasts />
    </div>
  );
}

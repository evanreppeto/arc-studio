"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { derivedShortLabel, type BillingNotice } from "@/domain";
import type { ArcRecentConversationVM } from "@/lib/arc-chat/read-model";
import { getProductLanguage, type ObjectLabelSettings } from "@/lib/product-language";

import { AccountMenu } from "./account-menu";
import { BillingNoticeBar } from "./billing-notice";
import { ComingSoonToasts } from "./coming-soon";
import { CommandPalette, type CommandItem } from "./command-palette";
import { IdentifierLeakCheck } from "./identifier-leak-check";
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

type NavItem = { label: string; href: string; icon: React.ReactNode; hint: string };
type NavGroup = { group: string; items: NavItem[] };

const PRIMARY_NAV_ITEMS: NavItem[] = [
  { label: "Arc Chat", href: "/arc", icon: IconArc, hint: "Ask Arc to find work or draft something" },
  { label: "Home", href: "/home", icon: IconHome, hint: "What needs you today" },
  { label: "Campaigns", href: "/campaigns", icon: IconCampaigns, hint: "Everything Arc has drafted, and its approval state" },
  { label: "Relationships", href: "/crm", icon: IconCrm, hint: "Your contacts, companies and leads" },
  { label: "Opportunities", href: "/opportunities", icon: IconOpp, hint: "Chances Arc found, with the evidence behind them" },
];

const ADVANCED_NAV_GROUPS: NavGroup[] = [
  {
    group: "See how it's going",
    items: [{ label: "Analytics", href: "/analytics", icon: IconAnalytics, hint: "Leads, jobs and revenue over time" }],
  },
  {
    group: "What Arc knows",
    items: [
      { label: "Journeys", href: "/journeys", icon: IconJourneys, hint: "How each customer got to you" },
      { label: "Brain", href: "/brain", icon: IconBrain, hint: "What Arc knows about your business" },
      { label: "Personas", href: "/personas", icon: IconPersonas, hint: "The customer types you sell to" },
    ],
  },
  {
    group: "Make & send",
    items: [
      { label: "Studio", href: "/studio", icon: IconStudio, hint: "Design ads and images" },
      { label: "Library", href: "/library", icon: IconLibrary, hint: "Your photos, logos and files" },
      { label: "Brand", href: "/brand", icon: IconBrand, hint: "Your colours, voice and proof points" },
      { label: "Outbox", href: "/outbox", icon: IconOutbox, hint: "Approved messages waiting to go out" },
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
  "/arc": "Arc Chat",
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

const MOBILE_NAV_QUERY = "(max-width: 900px)";
const FOCUSABLE_NAV_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function subscribeToMobileNav(onStoreChange: () => void): () => void {
  const mediaQuery = window.matchMedia(MOBILE_NAV_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getMobileNavSnapshot(): boolean {
  return window.matchMedia(MOBILE_NAV_QUERY).matches;
}

function badgeLabel(href: string, count: number): string {
  if (href === "/campaigns") {
    return `${count} campaign approval${count === 1 ? "" : "s"} waiting on you`;
  }
  if (href === "/opportunities") {
    return `${count} open opportunit${count === 1 ? "y" : "ies"}`;
  }
  return `${count} item${count === 1 ? "" : "s"} needing attention`;
}

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
  objectLabels = null,
  workspaces = [],
  navBadges = {},
  recentConversations = [],
  billingNotice = null,
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
  /** The workspace's own object names. Renames the CRM section in the rail. */
  objectLabels?: ObjectLabelSettings | null;
  workspaces?: WorkspaceOption[];
  navBadges?: Record<string, number>;
  recentConversations?: ArcRecentConversationVM[];
  billingNotice?: BillingNotice | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const language = getProductLanguage(industry, objectLabels);
  const navGroups = navGroupsFor(language.crmLabel);
  // Mobile nav drawer. Below the shell breakpoint the rail is an off-canvas
  // drawer toggled from the top bar; on desktop `navOpen` is inert (the rail is
  // always visible). Tapping a destination closes it (see the nav links), and
  // so does the backdrop.
  const [navOpen, setNavOpen] = useState(false);
  const navToggleRef = useRef<HTMLButtonElement>(null);
  const navCloseRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const isMobileNav = useSyncExternalStore(subscribeToMobileNav, getMobileNavSnapshot, () => false);
  const displayName = userName || orgName;
  // No signed-in user (local/demo, open mode) → a neutral label instead of a
  // bare "there". Prod shows the real viewer's first name.
  const firstName = userName.split(/\s+/)[0] || "Account";
  const showWorkspaceShortLabel =
    workspaceShortLabel.trim().toLocaleLowerCase() !==
    derivedShortLabel(orgName).trim().toLocaleLowerCase();
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

  const closeMobileNav = useCallback((restoreFocus = true) => {
    setNavOpen(false);
    window.dispatchEvent(new Event("arc:close-account-menu"));
    if (restoreFocus) window.requestAnimationFrame(() => navToggleRef.current?.focus());
  }, [setNavOpen]);

  function openAccountMenu() {
    if (isMobileNav) setNavOpen(true);
    window.requestAnimationFrame(() => window.dispatchEvent(new Event("arc:open-account-menu")));
  }

  useEffect(() => {
    if (!isMobileNav || !navOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => navCloseRef.current?.focus());

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileNav();
        return;
      }
      if (event.key !== "Tab" || !railRef.current) return;

      const focusable = Array.from(
        railRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_NAV_SELECTOR),
      ).filter((element) => !element.hasAttribute("disabled") && element.getClientRects().length > 0);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeMobileNav, isMobileNav, navOpen]);

  return (
    <div className={embedded ? "arc-app is-embedded" : "arc-app"}>
      <NavProgress />
      <RoutePrewarm hrefs={PREWARM_HREFS} />
      {/* First thing in the tab order, invisible until focused. Without it a
          keyboard user tabs through the whole rail on every page before
          reaching content. */}
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="app" data-nav-open={navOpen}>
        {/* Backdrop behind the mobile drawer — tap to dismiss. Inert on desktop
            (the rail is docked, so this never covers content there). */}
        <button
          type="button"
          className="rail-scrim"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => closeMobileNav()}
        />
        <aside
          id="app-navigation"
          ref={railRef}
          className="rail"
          data-open={navOpen}
          aria-label="Primary navigation"
          aria-hidden={isMobileNav && !navOpen ? true : undefined}
          inert={isMobileNav && !navOpen ? true : undefined}
        >
          <div className="rail-mobile-head">
            <span>Navigation</span>
            <button
              ref={navCloseRef}
              type="button"
              className="railclose"
              aria-label="Close navigation"
              onClick={() => closeMobileNav()}
            >
              <svg viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <WorkspaceSwitcher
            workspaceName={workspaceName}
            orgName={orgName}
            subtitle={workspaceSubtitle}
            logoUrl={logoUrl}
            accentColor={workspaceAccentColor}
            workspaces={workspaces}
          />
          {showWorkspaceShortLabel && (
            <div
              className="indtag"
              style={workspaceAccentColor ? ({ "--ws-accent": workspaceAccentColor } as React.CSSProperties) : undefined}
            >
              <i />
              {workspaceShortLabel}
            </div>
          )}
          <div className="rail-divider" aria-hidden="true" />
          <nav className="navwrap" aria-label="Workspace destinations">
            {navGroups.slice(0, 1).map((g) => (
              <div key={g.group} className="nav-primary">
                {g.items.map((it) => {
                  const active = pathname === it.href || (it.href !== "/" && pathname.startsWith(`${it.href}/`));
                  const badge = navBadges[it.href] ?? 0;
                  const attentionLabel = badgeLabel(it.href, badge);
                  return (
                    // Default prefetch is ON: with (app)/loading.tsx each route has a
                    // loading boundary, so prefetch only fetches the cheap skeleton shell
                    // (no DB reads) and clicks resolve to instant feedback + a crossfade.
                    <Link
                      key={it.label}
                      href={it.href}
                      className={`nav${active ? " on" : ""}`}
                      aria-current={active ? "page" : undefined}
                      title={it.hint}
                      onClick={() => closeMobileNav(false)}
                    >
                      {active && <span className="tick" />}
                      {it.icon}
                      {it.label}
                      {badge > 0 && (
                        <span className="navbadge" aria-label={attentionLabel} title={attentionLabel}>
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
                  const attentionLabel = badgeLabel(it.href, badge);
                  return (
                    <Link
                      key={it.label}
                      href={it.href}
                      className={`nav${active ? " on" : ""}`}
                      aria-current={active ? "page" : undefined}
                      title={it.hint}
                      onClick={() => closeMobileNav(false)}
                    >
                      {active && <span className="tick" />}
                      {it.icon}
                      {it.label}
                      {badge > 0 && <span className="navbadge" aria-label={attentionLabel} title={attentionLabel}>{badge > 99 ? "99+" : badge}</span>}
                    </Link>
                  );
                })}
              </div>
            ))}
            <section className="rail-recents" aria-labelledby="rail-recents-title">
              <div className="rail-recents-head">
                <h2 id="rail-recents-title">Recent chats</h2>
                <Link
                  href="/arc?new=1"
                  prefetch={false}
                  onClick={() => closeMobileNav(false)}
                >
                  New
                </Link>
              </div>
              {recentConversations.length > 0 ? (
                <div className="rail-recents-list">
                  {recentConversations.map((conversation) => (
                    <Link
                      key={conversation.id}
                      href={`/arc?c=${encodeURIComponent(conversation.id)}`}
                      className="rail-recent"
                      prefetch={false}
                      onClick={() => closeMobileNav(false)}
                    >
                      <span className="rail-recent-dot" aria-hidden="true" />
                      <span className="rail-recent-title">{conversation.title}</span>
                      <time>{conversation.when}</time>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="rail-recents-empty">Start a chat to keep active work close by.</p>
              )}
            </section>
          </nav>
          {/* Pinned above the account control: when something is broken, the way
              to reach a human has to be visible without hunting through a menu. */}
          <Link
            href="/support"
            className={`railhelp${pathname === "/support" || pathname.startsWith("/support/") ? " on" : ""}`}
            aria-current={pathname === "/support" || pathname.startsWith("/support/") ? "page" : undefined}
            onClick={() => closeMobileNav(false)}
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

        <div
          className="main"
          aria-hidden={isMobileNav && navOpen ? true : undefined}
          inert={isMobileNav && navOpen ? true : undefined}
        >
          <header className="top">
            {/* Hamburger — opens the nav drawer. Shown only below the shell
                breakpoint (CSS); on desktop the docked rail makes it redundant. */}
            <button
              ref={navToggleRef}
              type="button"
              className="menubtn"
              aria-label={navOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={navOpen}
              aria-controls="app-navigation"
              onClick={() => setNavOpen((v) => !v)}
            >
              <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <h1 className="crumb">{crumb}</h1>
            <button
              type="button"
              className="search"
              onClick={() => window.dispatchEvent(new Event("arc:open-command"))}
            >
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
              Search or jump to…
              <span className="k">⌘K</span>
            </button>
            <button
              type="button"
              className="topav topavbtn"
              aria-label={`Open account menu for ${displayName}`}
              aria-haspopup="menu"
              onClick={openAccountMenu}
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- user-uploaded avatar; next/image would need per-host remotePatterns
                <img src={avatarUrl} alt={displayName} />
              ) : (
                initials(displayName)
              )}
            </button>
          </header>
          <CommandPalette items={commandItems} />
          <BillingNoticeBar banner={billingNotice} />
          {/* Dev/preview only — no-op in production. Warns when a stored value
              reaches the screen as text (BSR-709). */}
          <IdentifierLeakCheck />
          {/* The app had no <main> on any route, so assistive tech had no way to
              skip the rail and the header on every single page. This is the one
              main landmark; Arc's own scroll region is a <div> beneath it. */}
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
      <ComingSoonToasts />
    </div>
  );
}

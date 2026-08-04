import { redirect } from "next/navigation";

import { resolveWorkspaceIdentity } from "@/domain";
import { getAuthMode } from "@/lib/auth/auth-mode";
import { getViewerAvatarUrl, resolveViewerName } from "@/lib/auth/display-name";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getSettingsWorkspacesView } from "@/lib/auth/workspaces-view";
import { reportDegraded } from "@/lib/observability/report-degraded";
import { getBusinessProfile } from "@/lib/brand-kit/persistence";
import { getBillingNoticeView } from "@/lib/billing/billing-notice";
import { getRecentArcConversations } from "@/lib/arc-chat/read-model";
import { getAppSettings } from "@/lib/settings/store";
import { getSupabaseAuthenticatedUser } from "@/lib/supabase/auth-server";
import { resolveWorkspaceLogoUrl } from "@/lib/branding/logo";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { getNavBadges } from "@/lib/workspace-summary/read-model";

import { AppShell } from "./_components/app-shell";
import { DEMO_RECENT_CONVERSATIONS } from "./arc/_components/arc-demo-data";
import "./arc-app.css";

// Every signed-in screen requires per-request auth + live per-workspace data, so
// this segment is always dynamic — it must never be statically prerendered. This
// is also load-bearing for the build: (app)/loading.tsx makes Next try to
// prerender each route's shell, which runs this auth layout; at build time (CI,
// no Supabase env) that throws WorkspaceUnavailableError. Forcing dynamic skips
// the build-time prerender while the loading boundary still streams instantly at
// runtime.
export const dynamic = "force-dynamic";

// Shared shell for the signed-in app screens (Home, Campaigns, … as they are
// ported). Resolves the workspace once here — a screen inside can re-read it via
// the cached getCurrentWorkspaceContext() without another round trip.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let ctx;
  try {
    ctx = await getCurrentWorkspaceContext();
  } catch {
    redirect("/login");
  }
  if (!ctx.workspaceId) redirect("/onboarding");

  const user = await getSupabaseAuthenticatedUser();
  // Defense in depth. The edge gate in proxy.ts is the primary check, but it is
  // driven by a path matcher, and a matcher entry that accidentally covers a page
  // silently unprotects it — the layout still renders, so nothing looks wrong.
  // In account mode no signed-in screen may render without a session, whatever
  // the matcher says. Open/demo mode has no session by design and is unaffected.
  if (getAuthMode() === "supabase" && !user) redirect("/login");

  const resolvedName = await resolveViewerName(ctx.orgId, user);
  // Offline demo has no signed-in identity, so the account row would read the
  // literal "Account". Name the sample operator instead (demo only — a real
  // viewer's own name always wins).
  const userName = resolvedName || (isDemoDataEnabled() ? "Maya Ellis" : "");
  // Rail attention counts from the shared summary — same source the screens
  // render, so a badge never disagrees with the page it points at.
  const navBadges = await getNavBadges(ctx.orgId).catch(() => ({}));
  // Trial position + quota pressure resolve to ONE console-wide notice, so the
  // operator never gets two stacked strips. Never throws — a billing read must
  // not be able to take down every signed-in screen.
  const { notice: billingNotice } = await getBillingNoticeView();
  // Workspaces the viewer can switch between — powers the rail's workspace menu.
  // The shell's workspace switcher. An erased failure here reads as "this
  // account has one workspace" on EVERY page, not just Settings (BSR-578).
  const workspacesView = await getSettingsWorkspacesView().catch((error) => {
    reportDegraded(error, { scope: "layout.getSettingsWorkspacesView", surface: "primary" });
    return {
      isDemo: false,
      workspaces: [],
      failed: error instanceof Error ? error.message : "Could not list your workspaces.",
    };
  });
  // Branding: workspace logo (org-scoped) + the viewer's profile photo, rendered
  // in the rail in place of the initials monograms when set.
  const [appSettings, businessProfile, avatarUrl, recentConversationResult] = await Promise.all([
    getAppSettings(ctx.orgId).catch(() => null),
    getBusinessProfile(ctx.orgId).catch(() => null),
    getViewerAvatarUrl(user).catch(() => null),
    getRecentArcConversations({ orgId: ctx.orgId, workspaceId: ctx.workspaceId }),
  ]);
  const recentConversations =
    recentConversationResult ?? (isDemoDataEnabled() ? DEMO_RECENT_CONVERSATIONS : []);
  const viewerAvatarUrl = avatarUrl ?? (isDemoDataEnabled() ? "/brand/demo/avatar-operator.jpg" : null);
  // A real workspace logo is an uploaded absolute URL. The offline demo has no
  // uploads, so it falls back to bundled sample branding — that's what makes the
  // rail show a company logo + operator photo instead of initials monograms in
  // the marketing screenshots. Never overrides a workspace's own logo.
  const uploadedLogo = resolveWorkspaceLogoUrl(businessProfile?.logoUrl, appSettings?.brandLogoUrl);
  const industry = appSettings?.industry || businessProfile?.industry || "general";

  // The workspace's own display identity, with the org-name fallbacks applied.
  // A workspace that has customized nothing resolves to exactly what the rail
  // rendered before these columns existed.
  const identity = resolveWorkspaceIdentity(
    {
      name: ctx.workspaceName,
      subtitle: ctx.workspaceSubtitle,
      shortLabel: ctx.workspaceShortLabel,
      accentKey: ctx.workspaceAccentKey,
      logoUrl: ctx.workspaceLogoUrl,
    },
    ctx.orgName,
  );
  // A workspace logo beats the org logo in the rail — it is the more specific
  // choice — and both beat the bundled demo sample.
  const logoUrl =
    identity.logoUrl ?? uploadedLogo ?? (isDemoDataEnabled() ? "/brand/demo/meridian-logo.png" : null);

  return (
    <AppShell
      demoData={isDemoDataEnabled()}
      workspaceName={identity.name}
      orgName={ctx.orgName}
      workspaceSubtitle={identity.subtitle}
      workspaceShortLabel={identity.shortLabel}
      workspaceAccentColor={identity.accentColor}
      userName={userName}
      userEmail={user?.email ?? (isDemoDataEnabled() ? "maya@meridian.example" : "")}
      logoUrl={logoUrl}
      avatarUrl={viewerAvatarUrl}
      industry={industry}
      workspaces={workspacesView.workspaces}
      navBadges={navBadges}
      recentConversations={recentConversations}
      billingNotice={billingNotice}
    >
      {children}
    </AppShell>
  );
}

import { redirect } from "next/navigation";

import { getViewerAvatarUrl, resolveViewerName } from "@/lib/auth/display-name";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getSettingsWorkspacesView } from "@/lib/auth/workspaces-view";
import { getBusinessProfile } from "@/lib/brand-kit/persistence";
import { getAppSettings } from "@/lib/settings/store";
import { getSupabaseAuthenticatedUser } from "@/lib/supabase/auth-server";
import { resolveWorkspaceLogoUrl } from "@/lib/branding/logo";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { getNavBadges } from "@/lib/workspace-summary/read-model";

import { AppShell } from "./_components/app-shell";
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
  const resolvedName = await resolveViewerName(ctx.orgId, user);
  // Offline demo has no signed-in identity, so the account row would read the
  // literal "Account". Name the sample operator instead (demo only — a real
  // viewer's own name always wins).
  const userName = resolvedName || (isDemoDataEnabled() ? "Maya Ellis" : "");
  // Rail attention counts from the shared summary — same source the screens
  // render, so a badge never disagrees with the page it points at.
  const navBadges = await getNavBadges(ctx.orgId).catch(() => ({}));
  // Workspaces the viewer can switch between — powers the rail's workspace menu.
  const workspacesView = await getSettingsWorkspacesView().catch(() => ({ isDemo: false, workspaces: [] }));
  // Branding: workspace logo (org-scoped) + the viewer's profile photo, rendered
  // in the rail in place of the initials monograms when set.
  const [appSettings, businessProfile, avatarUrl] = await Promise.all([
    getAppSettings(ctx.orgId).catch(() => null),
    getBusinessProfile(ctx.orgId).catch(() => null),
    getViewerAvatarUrl(user).catch(() => null),
  ]);
  const viewerAvatarUrl = avatarUrl ?? (isDemoDataEnabled() ? "/brand/demo/avatar-operator.jpg" : null);
  // A real workspace logo is an uploaded absolute URL. The offline demo has no
  // uploads, so it falls back to bundled sample branding — that's what makes the
  // rail show a company logo + operator photo instead of initials monograms in
  // the marketing screenshots. Never overrides a workspace's own logo.
  const uploadedLogo = resolveWorkspaceLogoUrl(businessProfile?.logoUrl, appSettings?.brandLogoUrl);
  const logoUrl = uploadedLogo ?? (isDemoDataEnabled() ? "/brand/demo/meridian-logo.png" : null);
  const industry = appSettings?.industry || businessProfile?.industry || "general";

  return (
    <AppShell
      workspaceName={ctx.workspaceName}
      orgName={ctx.orgName}
      userName={userName}
      userEmail={user?.email ?? (isDemoDataEnabled() ? "maya@meridian.example" : "")}
      logoUrl={logoUrl}
      avatarUrl={viewerAvatarUrl}
      industry={industry}
      workspaces={workspacesView.workspaces}
      navBadges={navBadges}
    >
      {children}
    </AppShell>
  );
}

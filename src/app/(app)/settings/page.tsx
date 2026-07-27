import { resolveAgentConnection } from "@/lib/agent/connection";
import { getViewerAvatarUrl } from "@/lib/auth/display-name";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getSettingsTeamView } from "@/lib/auth/team-view";
import { getSettingsWorkspacesView } from "@/lib/auth/workspaces-view";
import { getSettingsUsageView } from "@/lib/ai-usage/settings-summary";
import { getSettingsBillingView } from "@/lib/billing/settings-billing";
import { getSettingsConnectorsView } from "@/lib/connectors/settings-connectors";
import { isHubspotOAuthConfigured } from "@/lib/connectors/hubspot-oauth";
import { isGoogleOAuthConfigured } from "@/lib/connectors/google-oauth";
import { getEmailConnection } from "@/lib/connections/read-model";
import { getConnectorSpendView } from "@/lib/connectors/spend-summary";
import { isLiveSendEnabled } from "@/lib/dispatch/live-send";
import { getOrgPersonaOptions } from "@/lib/personas/read-model";
import { resolveWorkspaceLogoUrl } from "@/lib/branding/logo";
import { getBusinessProfile } from "@/lib/brand-kit/persistence";
import { getAppSettings } from "@/lib/settings/store";
import { getSupabaseAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getWaitlistView } from "@/lib/waitlist/read-model";

import { SettingsView } from "./_components/settings-view";
import "./settings.css";

export const metadata = { title: "Settings — Arc Studio" };

export default async function SettingsPage() {
  // Resolve the workspace first (React-cached) so its org scopes the settings read.
  const ctx = await getCurrentWorkspaceContext().catch(() => null);
  const [user, team, usage, connectorSpend, billing, settings, connectors, workspaces, emailConnection, agentConnection] = await Promise.all([
    getSupabaseAuthenticatedUser().catch(() => null),
    getSettingsTeamView().catch(() => ({ workspaceId: null, isDemo: false, members: [], invites: [], activity: [] })),
    getSettingsUsageView().catch(() => null),
    getConnectorSpendView().catch(() => null),
    getSettingsBillingView().catch(() => null),
    getAppSettings(ctx?.orgId ?? null),
    getSettingsConnectorsView().catch(() => ({ configured: false, connectors: [] })),
    getSettingsWorkspacesView().catch(() => ({ isDemo: false, workspaces: [] })),
    getEmailConnection().catch(() => null),
    resolveAgentConnection().catch(() => null),
  ]);
  // Platform waitlist — null unless the viewer is on ARC_PLATFORM_ADMIN_EMAILS.
  // The gate runs server-side inside the read-model, so a non-admin never reads a row.
  const waitlist = await getWaitlistView().catch(() => null);
  // The workspace's own personas, for the connector "Default persona" picker.
  const personaOptions = await getOrgPersonaOptions(ctx?.orgId ?? undefined).catch(() => []);
  const brandName = ctx?.orgName?.trim() || "Your workspace";
  // No fabricated fallback. This renders under "Signed in as" in a panel whose
  // own copy says the email is live, so inventing one ("owner@bsr.test", a test
  // account) told a real operator they were signed in as someone they weren't.
  // Empty is honest, and the view says so in place of showing a blank line.
  const email = user?.email ?? "";
  const avatarUrl = await getViewerAvatarUrl(user);
  // One workspace logo, canonical on the brand record — the same image the rail
  // draws and Arc stamps on creative. The legacy settings key is only a fallback
  // for workspaces that uploaded before the two stores were unified.
  const businessProfile = ctx?.orgId ? await getBusinessProfile(ctx.orgId).catch(() => null) : null;
  const workspaceLogoUrl = resolveWorkspaceLogoUrl(businessProfile?.logoUrl, settings.brandLogoUrl);
  // The deployment-level send kill-switch. Read here (server-side env) so the
  // email card can tell the truth: an enabled Resend connection still sends
  // nothing while this is dark.
  const liveSendEnabled = isLiveSendEnabled();
  // Whether the deployment has a HubSpot app configured — gates the OAuth "Connect
  // with HubSpot" button (falls back to the private-app-token form when absent).
  const hubspotOAuthConfigured = isHubspotOAuthConfigured();
  // Whether the deployment has a Google Cloud OAuth app configured — gates the
  // "Connect with Google" button on the reviews connector.
  const googleOAuthConfigured = isGoogleOAuthConfigured();
  return <SettingsView brandName={brandName} workspaceName={ctx?.workspaceName?.trim() || brandName} email={email} avatarUrl={avatarUrl} workspaceLogoUrl={workspaceLogoUrl} team={team} usage={usage} connectorSpend={connectorSpend} billing={billing} settings={settings} connectors={connectors} workspaces={workspaces} emailConnection={emailConnection} liveSendEnabled={liveSendEnabled} agentConnection={agentConnection} personaOptions={personaOptions} hubspotOAuthConfigured={hubspotOAuthConfigured} googleOAuthConfigured={googleOAuthConfigured} waitlist={waitlist} />;
}

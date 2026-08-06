import { resolveAgentConnection } from "@/lib/agent/connection";
import { getViewerAvatarUrl, resolveViewerName } from "@/lib/auth/display-name";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import {
  CUSTOM_FIELD_OBJECT_KEYS,
  DEFAULT_PIPELINE_STAGES,
  PIPELINE_OBJECT_KEYS,
  type CustomFieldObjectKey,
  type PipelineObjectKey,
  type PipelineStage,
} from "@/domain";
import { listAllFieldDefinitions } from "@/lib/custom-fields/definitions";
import { listCustomObjects } from "@/lib/custom-objects/definitions";
import { countRecordsByStage, listAllStageSets } from "@/lib/pipeline-stages/definitions";
import { getProductLanguage } from "@/lib/product-language";
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
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { getWaitlistView } from "@/lib/waitlist/read-model";
import { getHealthConsoleView } from "@/lib/observability/health-console";
import { getSuppressionView } from "@/lib/email-suppression/read-model";

import { SettingsView } from "./_components/settings-view";
import { reportDegraded } from "@/lib/observability/report-degraded";
import "./settings.css";

export const metadata = { title: "Settings — Arc Studio" };

export default async function SettingsPage() {
  // Resolve the workspace first (React-cached) so its org scopes the settings read.
  const ctx = await getCurrentWorkspaceContext().catch(() => null);
  const [user, team, usage, connectorSpend, billing, settings, connectors, workspaces, emailConnection, agentConnection] = await Promise.all([
    getSupabaseAuthenticatedUser().catch(() => null),
    // The read handles its own failures now and reports them on `failed`; this
    // is only for an unexpected throw, and it must not erase that distinction
    // by handing the view a benign empty team (BSR-578).
    getSettingsTeamView().catch((error) => {
      reportDegraded(error, { scope: "settings.getSettingsTeamView", surface: "primary" });
      return {
        workspaceId: null,
        isDemo: false,
        members: [],
        invites: [],
        activity: [],
        failed: error instanceof Error ? error.message : "Could not read this workspace's team.",
      };
    }),
    // PRIMARY: these render SPEND. Failing to null shows no usage and no cost,
    // which is a false statement about money — an operator reads "nothing spent"
    // and either relaxes about a cap they are actually near, or files a bug
    // because the numbers vanished. Either way they act on a wrong figure.
    getSettingsUsageView().catch((error) => {
      reportDegraded(error, { scope: "settings.getSettingsUsageView", surface: "primary" });
      return null;
    }),
    getConnectorSpendView().catch((error) => {
      reportDegraded(error, { scope: "settings.getConnectorSpendView", surface: "primary" });
      return null;
    }),
    getSettingsBillingView().catch(() => null),
    getAppSettings(ctx?.orgId ?? null),
    getSettingsConnectorsView().catch(() => ({ configured: false, connectors: [] })),
    getSettingsWorkspacesView().catch((error) => {
      reportDegraded(error, { scope: "settings.getSettingsWorkspacesView", surface: "primary" });
      return {
        isDemo: false,
        workspaces: [],
        failed: error instanceof Error ? error.message : "Could not list your workspaces.",
      };
    }),
    // PRIMARY: a failed connection READ renders identically to "not connected".
    // The operator reconnects something that was already fine, or concludes
    // sending is off when it isn't. Status that lies is worse than status absent.
    getEmailConnection().catch((error) => {
      reportDegraded(error, { scope: "settings.getEmailConnection", surface: "primary" });
      return null;
    }),
    resolveAgentConnection().catch((error) => {
      reportDegraded(error, { scope: "settings.resolveAgentConnection", surface: "primary" });
      return null;
    }),
  ]);
  // Platform waitlist — null unless the viewer is on ARC_PLATFORM_ADMIN_EMAILS.
  // The gate runs server-side inside the read-model, so a non-admin never reads a row.
  // Correctly silent (BSR-546): null here means "not a platform admin" far more
  // often than "failed", and the section simply doesn't render. Alerting would
  // fire for every non-admin page load.
  const waitlist = await getWaitlistView().catch(() => null);
  // Operator health console — same platform-admin gate as the waitlist, enforced
  // server-side inside the read-model, so a non-admin never reads a connector row
  // and the section never reaches their browser.
  const health = await getHealthConsoleView().catch(() => null);
  // PRIMARY: an empty suppression list and a failed read look identical, and one
  // of them says "nobody has opted out" about a compliance register. The panel
  // renders `failed` as an explicit unknown rather than a clean list.
  const suppression = await getSuppressionView().catch((error) => {
    reportDegraded(error, { scope: "settings.getSuppressionView", surface: "primary" });
    return {
      entries: [],
      total: 0,
      failed: error instanceof Error ? error.message : "Could not read the suppression list.",
    };
  });
  // The workspace's own personas, for the connector "Default persona" picker.
  // Correctly silent (BSR-546): picker options; an empty dropdown is visible.
  const personaOptions = await getOrgPersonaOptions(ctx?.orgId ?? undefined).catch(() => []);
  const brandName = ctx?.orgName?.trim() || "Your workspace";
  // No fabricated fallback. This renders under "Signed in as" in a panel whose
  // own copy says the email is live, so inventing one ("owner@bsr.test", a test
  // account) told a real operator they were signed in as someone they weren't.
  // Empty is honest, and the view says so in place of showing a blank line.
  const email = user?.email ?? "";
  const avatarUrl = await getViewerAvatarUrl(user);
  // The name the shell and every invitation email already use — Account is now
  // where you can correct it, so it has to read the same value.
  const viewerName = ctx?.orgId ? await resolveViewerName(ctx.orgId, user).catch(() => "") : "";
  // The "active sign-in session" the Account heading has always promised.
  const session = user
    ? {
        lastSignInAt: user.last_sign_in_at ?? null,
        createdAt: user.created_at ?? null,
        provider: typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : null,
      }
    : null;
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
  // A tenant's own custom fields, plus its own word for each CRM object — the
  // settings screen must not be the one place the product reverts to our
  // internal vocabulary ("Properties" to a firm that calls them Matters).
  const customFields = ctx?.orgId
    ? await listAllFieldDefinitions(ctx.orgId, { includeArchived: true }).catch((error) => {
        // I wrote this silent yesterday so a missing field layer couldn't take
        // the screen down — right instinct, wrong on reflection. Empty renders
        // as "No custom fields yet", which tells a tenant their own schema is
        // gone. Keep degrading; stop asserting.
        reportDegraded(error, { scope: "settings.listAllFieldDefinitions", surface: "primary" });
        return [];
      })
    : [];
  // The workspace's own record types. Same reasoning as the fields above:
  // reporting empty would tell a tenant the object types they defined are
  // gone, and the CRM tabs are built from this list.
  const customObjects = await listCustomObjects(ctx?.orgId ?? "", { includeArchived: true }).catch((error) => {
    reportDegraded(error, { scope: "settings.listCustomObjects", surface: "primary" });
    return [];
  });
  // The tenant's own pipeline, plus how many records sit in each stage — the
  // occupancy is what lets the panel refuse to archive a stage full of records
  // without asking where they go.
  //
  // PRIMARY on both halves. Falling back to the defaults here would show a
  // tenant a pipeline that isn't theirs and invite them to "fix" it, overwriting
  // the one they have; reporting zero occupants would let them archive an
  // occupied stage with no warning at all. Null renders as unavailable instead.
  const pipeline = ctx?.orgId && isSupabaseAdminConfigured()
    ? await Promise.all([
        listAllStageSets(ctx.orgId),
        Promise.all(
          PIPELINE_OBJECT_KEYS.map((k) =>
            countRecordsByStage(ctx.orgId, k).then((counts) => [k, counts] as const),
          ),
        ).then((entries) => Object.fromEntries(entries) as Record<PipelineObjectKey, Record<string, number>>),
      ]).catch((error) => {
        reportDegraded(error, { scope: "settings.pipelineStages", surface: "primary" });
        return null;
      })
    : // No workspace, or no database at all — the backend-less preview. The
      // defaults are honest there, being exactly what every read falls back to in
      // that state, and it stays distinct from the FAILED read above, which shows
      // nothing rather than inviting an edit over data we could not see.
      //
      // The distinction matters: "there is no database" and "the database did not
      // answer" look identical from a null, and only one of them is safe to show
      // an editable pipeline for.
      ([
        DEFAULT_PIPELINE_STAGES as unknown as Record<PipelineObjectKey, PipelineStage[]>,
        Object.fromEntries(PIPELINE_OBJECT_KEYS.map((k) => [k, {}])) as Record<
          PipelineObjectKey,
          Record<string, number>
        >,
      ] as [Record<PipelineObjectKey, PipelineStage[]>, Record<PipelineObjectKey, Record<string, number>>]);

  const industryValue = settings.industry || businessProfile?.industry;
  // Two resolutions on purpose. `language` is what this workspace calls things —
  // it labels the fields and stages panels. `industryLanguage` is what its
  // industry would call them, and it is what the rename panel shows as
  // placeholders: an operator needs to see the default they'd fall back to, not
  // their own override echoed at them.
  const language = getProductLanguage(industryValue, settings.objectLabels);
  const industryLanguage = getProductLanguage(industryValue);
  const crmObjectLabels = Object.fromEntries(
    CUSTOM_FIELD_OBJECT_KEYS.map((k) => [k, language.crmObjects[k].label]),
  ) as Record<CustomFieldObjectKey, string>;
  const pipelineObjectLabels = Object.fromEntries(
    PIPELINE_OBJECT_KEYS.map((k) => [k, language.crmObjects[k].label]),
  ) as Record<PipelineObjectKey, string>;
  return <SettingsView brandName={brandName} workspaceName={ctx?.workspaceName?.trim() || brandName} email={email} viewerName={viewerName} session={session} avatarUrl={avatarUrl} workspaceLogoUrl={workspaceLogoUrl} team={team} usage={usage} connectorSpend={connectorSpend} billing={billing} settings={settings} connectors={connectors} workspaces={workspaces} emailConnection={emailConnection} liveSendEnabled={liveSendEnabled} agentConnection={agentConnection} personaOptions={personaOptions} hubspotOAuthConfigured={hubspotOAuthConfigured} googleOAuthConfigured={googleOAuthConfigured} waitlist={waitlist} health={health} suppression={suppression} customFields={customFields} customObjects={customObjects} crmObjectLabels={crmObjectLabels} pipelineStages={pipeline?.[0] ?? null} pipelineOccupancy={pipeline?.[1] ?? null} pipelineObjectLabels={pipelineObjectLabels} industryObjectLanguage={industryLanguage.crmObjects} industrySectionLabel={industryLanguage.crmLabel} savedObjectLabels={settings.objectLabels.objects ?? {}} />;
}

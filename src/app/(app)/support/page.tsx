import { buildSupportMailto } from "@/domain";

import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getSupabaseAuthenticatedUser } from "@/lib/supabase/auth-server";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { resolveAppVersion, resolveSupportInbox } from "@/lib/support/inbox";
import { listSupportRequests } from "@/lib/support/read-model";

import { SupportView } from "./_components/support-view";
import "./support.css";

export const metadata = { title: "Help & support — Arc Studio" };

export default async function SupportPage() {
  // Everything here is best-effort: this is the page people reach *because*
  // something else is broken, so no lookup is allowed to take it down with it.
  const [ctx, user] = await Promise.all([
    getCurrentWorkspaceContext().catch(() => null),
    getSupabaseAuthenticatedUser().catch(() => null),
  ]);
  const requests = await listSupportRequests(ctx?.orgId ?? null).catch(() => []);

  const workspaceName = ctx?.workspaceName || ctx?.orgName || "Your workspace";
  const email = user?.email ?? "";
  const inbox = resolveSupportInbox();
  const appVersion = resolveAppVersion();

  return (
    <SupportView
      workspaceName={workspaceName}
      viewerEmail={email}
      supportInbox={inbox}
      appVersion={appVersion}
      mailtoHref={buildSupportMailto({ inbox, workspaceName, submittedByEmail: email, appVersion })}
      requests={requests}
      canPersist={Boolean(ctx?.orgId) && isSupabaseAdminConfigured()}
    />
  );
}

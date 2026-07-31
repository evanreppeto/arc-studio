import { type SupabaseClient } from "@supabase/supabase-js";

import { CONNECTOR_REGISTRY, parseConnectorCredential } from "@/domain";
import { reportDegraded } from "@/lib/observability/report-degraded";

import { readConnectorCredential } from "./credentials";
import { ensureFreshAccessToken } from "./oauth-refresh";
import { listWorkspaceConnectors, resolveConnectorCredentialRef } from "./read-model";

/** A remote MCP connector the runner should load: namespace, endpoint, header, token. */
export type RunnerRemoteConnector = {
  toolNamespace: string;
  mcpUrl: string;
  authHeader: string;
  token: string;
};

/**
 * Enabled, credentialed, remote-MCP connectors for this workspace, with their
 * decrypted token. Native connectors (mcpUrl === null, e.g. gemini-research) are
 * excluded — they have no remote server to load. Secrets are resolved here and only
 * ever returned over the bearer-gated runner route, never to a browser.
 */
export async function resolveRemoteConnectorsForRunner(
  client: SupabaseClient,
  workspaceId: string,
): Promise<RunnerRemoteConnector[]> {
  const views = await listWorkspaceConnectors(client, workspaceId);
  const enabledKeys = new Set(views.filter((v) => v.enabled && v.credentialPresent).map((v) => v.key));

  const out: RunnerRemoteConnector[] = [];
  for (const entry of CONNECTOR_REGISTRY) {
    if (!entry.mcpUrl || !entry.authHeader || !enabledKeys.has(entry.key)) continue;
    const ref = await resolveConnectorCredentialRef(client, workspaceId, entry.key);
    const raw = await readConnectorCredential(client, ref);
    if (!raw) {
      // The connector is enabled AND reports `credentialPresent`, so a missing
      // bundle here is an inconsistency, not a configuration choice. Dropping it
      // silently made Arc look like it chose not to use the tool.
      reportDegraded(new Error(`${entry.key}: credential is referenced but could not be read`), {
        scope: "connectors.resolveRemoteConnectorsForRunner",
        surface: "primary",
        detail: { connector: entry.key, workspaceId, reason: "credential_unreadable" },
      });
      continue;
    }

    const cred = parseConnectorCredential(raw);
    let token: string;
    if (cred.kind === "oauth_refresh") {
      const fresh = await ensureFreshAccessToken(client, ref, cred);
      if (!fresh.ok) {
        // Still degrade rather than throw — one dead connector must not take the
        // whole run down. But say so: a revoked or rotated refresh token
        // otherwise removes a capability the operator explicitly enabled, with
        // no log, no Sentry, and nothing on any screen. Arc simply stops having
        // the tool and reports nothing (BSR-479).
        reportDegraded(new Error(`${entry.key}: ${fresh.error}`), {
          scope: "connectors.resolveRemoteConnectorsForRunner",
          surface: "primary",
          detail: { connector: entry.key, workspaceId, reason: fresh.reason },
        });
        continue;
      }
      token = fresh.accessToken;
    } else {
      token = cred.token;
    }
    out.push({ toolNamespace: entry.toolNamespace, mcpUrl: entry.mcpUrl, authHeader: entry.authHeader, token });
  }
  return out;
}

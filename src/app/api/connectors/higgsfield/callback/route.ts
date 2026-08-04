import { NextResponse } from "next/server";

import { serializeOAuthBundle } from "@/domain";
import { requireOperator } from "@/lib/auth/operator";
import { writeConnectorCredential } from "@/lib/connectors/credentials";
import { exchangeCode, HIGGSFIELD_OAUTH } from "@/lib/connectors/higgsfield-oauth";
import { setConnectorCredentialRef, setConnectorEnabled } from "@/lib/connectors/persistence";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { HF_OAUTH_COOKIE } from "../authorize/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function origin(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

function done(base: string, hf: string): NextResponse {
  const response = NextResponse.redirect(`${base}/settings?s=connections&c=higgsfield&hf=${encodeURIComponent(hf)}`);
  response.cookies.delete({ name: HF_OAUTH_COOKIE, path: "/api/connectors/higgsfield" });
  return response;
}

type FlowState = { state: string; verifier: string; clientId: string; workspaceId: string; orgId: string | null };

/**
 * Complete the Higgsfield "Connect" OAuth flow: validate state against the
 * httpOnly cookie, exchange the code (PKCE) for tokens, and store the refresh
 * bundle on the workspace's connector (enabled) — same serializeOAuthBundle
 * format the runner reads and oauth-refresh.ts auto-renews. Redirects back to
 * Settings → Connections with a success/error marker.
 */
export async function GET(request: Request): Promise<NextResponse> {
  await requireOperator();
  const base = origin(request);
  const url = new URL(request.url);

  const providerError = url.searchParams.get("error");
  if (providerError) return done(base, providerError.slice(0, 40));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const raw = request.headers.get("cookie")?.match(/(?:^|;\s*)hf_oauth=([^;]+)/)?.[1];
  if (!code || !state || !raw) return done(base, "missing_params");

  let flow: FlowState;
  try {
    flow = JSON.parse(decodeURIComponent(raw)) as FlowState;
  } catch {
    return done(base, "bad_state");
  }
  if (flow.state !== state) return done(base, "state_mismatch");
  if (!isSupabaseAdminConfigured()) return done(base, "not_configured");

  const redirectUri = `${base}/api/connectors/higgsfield/callback`;
  const exchanged = await exchangeCode({ code, redirectUri, clientId: flow.clientId, verifier: flow.verifier });
  if (!exchanged.ok) return done(base, "exchange_failed");

  const bundle = serializeOAuthBundle({
    kind: "oauth_refresh",
    accessToken: exchanged.tokens.accessToken,
    refreshToken: exchanged.tokens.refreshToken,
    expiresAt: exchanged.tokens.expiresAt,
    clientId: flow.clientId,
    tokenEndpoint: HIGGSFIELD_OAUTH.tokenEndpoint,
  });

  try {
    const client = getSupabaseAdminClient();
    const credentialRef = await writeConnectorCredential(client, { workspaceId: flow.workspaceId, connectorKey: "higgsfield", plaintext: bundle });
    await setConnectorCredentialRef(client, { workspaceId: flow.workspaceId, orgId: flow.orgId, connectorKey: "higgsfield", credentialRef });
    await setConnectorEnabled(client, { workspaceId: flow.workspaceId, connectorKey: "higgsfield", enabled: true });
  } catch (error) {
    // The operator only ever sees `store_failed`, so the reason has to reach the
    // server log or it is lost. A bare `catch {}` here is what made this failure
    // take a database census to diagnose: OAuth had succeeded, and the three
    // calls above could not say which one broke or why (BSR-733).
    console.error(
      `[connectors] Higgsfield connect succeeded at the provider but could not be stored for workspace ${flow.workspaceId}:`,
      error,
    );
    return done(base, "store_failed");
  }

  return done(base, "connected");
}

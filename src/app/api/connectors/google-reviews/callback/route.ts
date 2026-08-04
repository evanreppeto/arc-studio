import { NextResponse } from "next/server";

import { requireOperator } from "@/lib/auth/operator";
import { writeConnectorCredential } from "@/lib/connectors/credentials";
import { buildGoogleBundle, exchangeGoogleCode, googleOAuthClientId } from "@/lib/connectors/google-oauth";
import { setConnectorCredentialRef, setConnectorEnabled } from "@/lib/connectors/persistence";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { GR_OAUTH_COOKIE } from "../authorize/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONNECTOR_KEY = "reviews-signals";

function origin(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

function done(base: string, gb: string): NextResponse {
  const response = NextResponse.redirect(`${base}/settings?s=connections&c=reviews-signals&gb=${encodeURIComponent(gb)}`);
  response.cookies.delete({ name: GR_OAUTH_COOKIE, path: "/api/connectors/google-reviews" });
  return response;
}

type FlowState = { state: string; workspaceId: string; orgId: string | null };

/**
 * Complete the Google Business Profile OAuth flow: validate state against the
 * httpOnly cookie, exchange the code (with the app client_secret) for tokens, and
 * store the refresh bundle on the workspace's reviews-signals connector (enabled).
 * detect() + Test read it through resolveGoogleAccessToken, which auto-refreshes.
 */
export async function GET(request: Request): Promise<NextResponse> {
  await requireOperator();
  const base = origin(request);
  const url = new URL(request.url);

  const providerError = url.searchParams.get("error");
  if (providerError) return done(base, providerError.slice(0, 40));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const raw = request.headers.get("cookie")?.match(/(?:^|;\s*)gr_oauth=([^;]+)/)?.[1];
  if (!code || !state || !raw) return done(base, "missing_params");

  let flow: FlowState;
  try {
    flow = JSON.parse(decodeURIComponent(raw)) as FlowState;
  } catch {
    return done(base, "bad_state");
  }
  if (flow.state !== state) return done(base, "state_mismatch");
  if (!isSupabaseAdminConfigured()) return done(base, "not_configured");

  const clientId = googleOAuthClientId();
  if (!clientId) return done(base, "not_configured");

  const redirectUri = `${base}/api/connectors/google-reviews/callback`;
  const exchanged = await exchangeGoogleCode({ code, redirectUri });
  if (!exchanged.ok) return done(base, "exchange_failed");

  const bundle = buildGoogleBundle(exchanged.tokens, clientId);

  try {
    const client = getSupabaseAdminClient();
    const credentialRef = await writeConnectorCredential(client, { workspaceId: flow.workspaceId, connectorKey: CONNECTOR_KEY, plaintext: bundle });
    await setConnectorCredentialRef(client, { workspaceId: flow.workspaceId, orgId: flow.orgId, connectorKey: CONNECTOR_KEY, credentialRef });
    await setConnectorEnabled(client, { workspaceId: flow.workspaceId, connectorKey: CONNECTOR_KEY, enabled: true });
  } catch (error) {
    // The operator only sees `store_failed`; without this the reason is lost
    // and the failure takes a database census to diagnose (BSR-733).
    console.error(`[connectors] google-reviews connect could not be stored for workspace ${flow.workspaceId}:`, error);
    return done(base, "store_failed");
  }

  return done(base, "connected");
}

"use server";

import { revalidatePath } from "next/cache";

import { connectorIsAvailable, findConnector, isWeatherServiceAreaConfigured, parseConnectorCredential, parseWeatherServiceArea } from "@/domain";
import { requireOperator } from "@/lib/auth/operator";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getOrgPersonaKeys } from "@/lib/personas/read-model";
import { getConnectorConfig, setConnectorConfig } from "@/lib/connectors/config";
import { platformCredentialFor, readConnectorCredential, writeConnectorCredential } from "@/lib/connectors/credentials";
import { listWorkspaceConnectors, resolveConnectorCredentialRef } from "@/lib/connectors/read-model";
import { checkConnectorCredential, checkEnrichmentEndpoint } from "@/lib/connectors/health";
import { checkHiggsfieldToken } from "@/lib/connectors/higgsfield-health";
import { runCrmImport, runCsvImport, runMailchimpImport, CSV_IMPORT_CONNECTOR_KEY, MAILCHIMP_IMPORT_CONNECTOR_KEY } from "@/lib/connectors/import";
import { checkHubspotConnection } from "@/lib/integrations/crm/hubspot";
import { resolveHubspotAccessToken } from "@/lib/connectors/hubspot-oauth";
import { checkMailchimpConnection } from "@/lib/integrations/crm/mailchimp";
import { checkGbpConnection } from "@/lib/integrations/reviews/gbp";
import { checkMetaAdLibrary } from "@/lib/integrations/ads/meta-ad-library";
import { parseAdWatchConfig } from "@/lib/connectors/builtin/competitor-ads";
import { resolveGoogleAccessToken } from "@/lib/connectors/google-oauth";
import { buildOpportunityDigest, postSlackWebhook } from "@/lib/integrations/slack/notify";
import { postWebhook } from "@/lib/integrations/webhook/post";
import { readEndpoint as readWebhookEndpoint } from "@/lib/connectors/builtin/webhook-channel";
import { listOpenOpportunities } from "@/lib/opportunities/read-model";
import { checkNwsConnection } from "@/lib/integrations/weather/nws-source";
import {
  disconnectConnector as disconnectConnectorRow,
  recordConnectorTest,
  setConnectorCredentialRef,
  setConnectorEnabled as setConnectorEnabledRow,
  upsertConnectorEnabled,
} from "@/lib/connectors/persistence";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { type SupabaseClient } from "@supabase/supabase-js";

import type { SettingsWriteResult } from "./actions";

/**
 * Operator-side connect flow for the real workspace connectors (Gemini research,
 * Higgsfield). The credential (API key / token) is written to the Vault via
 * create_secret; the workspace_connectors row stores only the returned ref +
 * enable switch — the plaintext never touches the row and is never echoed to the
 * browser. The runner later reads it through GET /api/v1/arc/connectors. Nothing
 * here goes outbound; a connected connector still only acts under approval.
 */
/**
 * API-key connectors whose provider health check needs only the key (no extra
 * per-workspace config), so it can run at connect time. Higgsfield is validated by
 * its own dedicated branch above; config-dependent connectors (Mailchimp, HubSpot,
 * lead-enrichment, Slack) are validated by Test once their config is set.
 */
const CONNECT_TIME_VALIDATED = new Set(["gemini-research", "gemini-media", "news-search"]);

export async function connectConnector(input: {
  connectorKey: string;
  credential: string;
}): Promise<SettingsWriteResult> {
  await requireOperator();

  const connector = findConnector(input.connectorKey);
  if (!connector) return { ok: false, error: "Unknown connector." };
  if (!connectorIsAvailable(connector)) {
    return { ok: false, error: `${connector.label} isn't built yet — it can't be connected or switched on.` };
  }
  const credential = (input.credential ?? "").trim();
  if (!credential) return { ok: false, error: "Paste a credential to connect." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.workspaceId) return { ok: false, error: "No active workspace to connect into." };

  // Higgsfield: validate BEFORE storing, whichever credential form was pasted
  // (a Cloud API key or an OAuth token bundle). Their MCP is the authority —
  // storing a rejected key would read "Connected" until someone hit Test.
  if (connector.key === "higgsfield") {
    const parsed = parseConnectorCredential(credential);
    const accessToken = parsed.kind === "oauth_refresh" ? parsed.accessToken : parsed.token;
    const health = await checkHiggsfieldToken(accessToken);
    if (!health.ok) {
      return { ok: false, error: `Higgsfield rejected that credential (${health.error ?? "unknown error"}) — check the key and try again.` };
    }
  }

  // Config-free API-key connectors: validate the key against the provider BEFORE
  // storing, so a wrong key is rejected at connect time instead of silently reading
  // "Connected" until someone hits Test. Connectors whose health needs extra config
  // (Mailchimp audience id, enrichment endpoint) are validated by Test instead.
  if (CONNECT_TIME_VALIDATED.has(connector.key)) {
    const health = await checkConnectorCredential(connector.key, credential);
    if (!health.ok) {
      return { ok: false, error: `That credential was rejected (${health.error ?? "unknown error"}) — check it and try again.` };
    }
  }

  try {
    const client = getSupabaseAdminClient();
    const credentialRef = await writeConnectorCredential(client, {
      workspaceId: ctx.workspaceId,
      connectorKey: connector.key,
      plaintext: credential,
    });
    await setConnectorCredentialRef(client, {
      workspaceId: ctx.workspaceId,
      orgId: ctx.orgId ?? null,
      connectorKey: connector.key,
      credentialRef,
    });
    await setConnectorEnabledRow(client, { workspaceId: ctx.workspaceId, connectorKey: connector.key, enabled: true });
    // The connect probe IS a successful test — record it so the card shows a
    // fresh healthy state instead of "never tested".
    if (connector.key === "higgsfield") {
      await recordConnectorTest(client, { workspaceId: ctx.workspaceId, connectorKey: connector.key, result: { ok: true } });
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not connect." };
  }

  revalidatePath("/settings");
  return { ok: true, persisted: true, message: `${connector.label} connected.` };
}

export async function disconnectConnector(input: { connectorKey: string }): Promise<SettingsWriteResult> {
  await requireOperator();

  const connector = findConnector(input.connectorKey);
  if (!connector) return { ok: false, error: "Unknown connector." };
  // Deliberately NOT availability-gated. Every other mutation here refuses a
  // `planned` connector, but disconnect is the undo direction: if a stale row from
  // before it was marked planned still says enabled, the operator must be able to
  // clear it. A guard here would lock that row in place with no way out.

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.workspaceId) return { ok: false, error: "No active workspace." };

  try {
    await disconnectConnectorRow(getSupabaseAdminClient(), { workspaceId: ctx.workspaceId, connectorKey: connector.key });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not disconnect." };
  }

  revalidatePath("/settings");
  return { ok: true, persisted: true, message: `${connector.label} disconnected.` };
}

/**
 * Test a connected connector. Credentialed connectors read their stored Vault
 * secret and make a real minimal provider call (Higgsfield balance / Gemini
 * models). No-credential signal sources with a connectivity probe (weather-signals
 * → live NWS/NOAA) instead hit the source with the workspace's configured service
 * area and report the current active-alert count. Either way the outcome is
 * recorded on the row. ok:true = healthy; ok:false = failed/unavailable.
 */
export async function testConnector(input: { connectorKey: string }): Promise<SettingsWriteResult> {
  await requireOperator();

  const connector = findConnector(input.connectorKey);
  if (!connector) return { ok: false, error: "Unknown connector." };
  if (!connectorIsAvailable(connector)) {
    return { ok: false, error: `${connector.label} isn't built yet — it can't be connected or switched on.` };
  }
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect this workspace to test the connection." };

  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.workspaceId) return { ok: false, error: "No active workspace." };
  const workspaceId = ctx.workspaceId;

  // No-credential connectivity probe: the NWS weather source. Reads the
  // per-workspace service area and returns the live active-alert count.
  if (connector.key === "weather-signals") {
    try {
      const client = getSupabaseAdminClient();
      const config = await getConnectorConfig(client, workspaceId, connector.key);
      const area = parseWeatherServiceArea(config);
      // Say what's missing rather than probing somewhere arbitrary and reporting a
      // live alert count for a place this workspace never asked about.
      if (!isWeatherServiceAreaConfigured(area)) {
        return { ok: false, error: "Set a service area first (e.g. IL, WI) — NWS needs to know where to watch." };
      }
      const result = await checkNwsConnection(area);
      await recordConnectorTest(client, {
        workspaceId,
        connectorKey: connector.key,
        result: { ok: result.ok, error: result.error },
      });
      revalidatePath("/settings");
      if (!result.ok) return { ok: false, error: `Test failed: ${result.error ?? "NWS unreachable"}` };
      const areaLabel = area.states.length ? area.states.join(", ") : `${area.points.length} point(s)`;
      const forecastNote = result.forecast ? ` · ${result.forecast}` : "";
      return {
        ok: true,
        persisted: true,
        message: `NWS reachable — ${result.count ?? 0} active alert(s) for ${areaLabel}${forecastNote}.`,
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not run the test." };
    }
  }

  // No-credential outbound channel: post a test payload to the configured endpoint.
  // Like weather-signals, this runs before the credential lookup (there is no key).
  if (connector.key === "webhook-dispatch") {
    try {
      const client = getSupabaseAdminClient();
      const config = await getConnectorConfig(client, workspaceId, connector.key);
      const endpoint = readWebhookEndpoint(config);
      if (!endpoint) return { ok: false, error: "Set the webhook endpoint URL first, then test." };
      const wh = await postWebhook(endpoint, { type: "arc.test", message: "Arc is connected. Approved sends will POST here after your confirmation." });
      await recordConnectorTest(client, { workspaceId, connectorKey: connector.key, result: wh.ok ? { ok: true } : { ok: false, error: wh.error } });
      revalidatePath("/settings");
      return wh.ok
        ? { ok: true, persisted: true, message: `Endpoint reachable — test payload delivered (HTTP ${wh.status}).` }
        : { ok: false, error: `Test failed: ${wh.error}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not run the test." };
    }
  }

  try {
    const client = getSupabaseAdminClient();
    const { data } = await (client as unknown as SupabaseClient)
      .from("workspace_connectors")
      .select("credential_ref")
      .eq("workspace_id", workspaceId)
      .eq("connector_key", connector.key)
      .maybeSingle<{ credential_ref: string | null }>();
    const ref = data?.credential_ref ?? null;
    // Dual credential model: the workspace's own key wins; otherwise a
    // platform-credits connector tests against the platform key — "Test" must
    // work out of the box for exactly the connectors that claim to.
    const platformKey = ref ? null : platformCredentialFor(connector);
    if (!ref && !platformKey) return { ok: false, error: "No credential to test — connect the connector first." };

    const plaintext = ref ? await readConnectorCredential(client, ref) : platformKey;
    if (!plaintext) return { ok: false, error: "Stored credential could not be read." };

    // CRM import: a real HubSpot probe that also reports how many contacts an
    // import would see, so Test connection returns record counts (BSR-368).
    if (connector.key === "hubspot-import") {
      // Resolve a live access token from whichever path connected: an OAuth bundle
      // (refreshed) or a pasted private-app token (used as-is).
      const resolved = await resolveHubspotAccessToken(client, ref, plaintext);
      if (!resolved.ok) {
        await recordConnectorTest(client, { workspaceId, connectorKey: connector.key, result: { ok: false, error: resolved.error } });
        revalidatePath("/settings");
        return { ok: false, error: `Test failed: ${resolved.error}` };
      }
      const hs = await checkHubspotConnection(resolved.accessToken);
      await recordConnectorTest(client, { workspaceId, connectorKey: connector.key, result: { ok: hs.ok, error: hs.error } });
      revalidatePath("/settings");
      if (!hs.ok) return { ok: false, error: `Test failed: ${hs.error ?? "HubSpot unreachable"}` };
      const countNote = typeof hs.count === "number" ? `${hs.count} contact(s) available to import` : "contacts available to import";
      return { ok: true, persisted: true, message: `HubSpot reachable — ${countNote}.` };
    }

    // Google Business reviews: resolve/refresh the OAuth token, then read one page
    // of reviews for the configured location so Test reports real reachability.
    if (connector.key === "reviews-signals") {
      const config = await getConnectorConfig(client, workspaceId, connector.key);
      const location = typeof config.gbpLocation === "string" ? config.gbpLocation.trim() : "";
      if (!location) return { ok: false, error: "Set the Business Profile location first, then test." };
      const resolved = await resolveGoogleAccessToken(client, ref, plaintext);
      if (!resolved.ok) {
        await recordConnectorTest(client, { workspaceId, connectorKey: connector.key, result: { ok: false, error: resolved.error } });
        revalidatePath("/settings");
        return { ok: false, error: `Test failed: ${resolved.error}` };
      }
      const gb = await checkGbpConnection(resolved.accessToken, location);
      await recordConnectorTest(client, { workspaceId, connectorKey: connector.key, result: gb.ok ? { ok: true } : { ok: false, error: gb.error } });
      revalidatePath("/settings");
      return gb.ok
        ? { ok: true, persisted: true, message: `Google Business Profile reachable — reviews readable for this location.` }
        : { ok: false, error: `Test failed: ${gb.error}` };
    }

    // Competitor ads: probe the Meta Ad Library with the configured terms. A zero
    // match is reported honestly (Meta's non-EU coverage is political ads only), so
    // an empty result never reads as "no competitor activity".
    if (connector.key === "competitor-ads") {
      const config = await getConnectorConfig(client, workspaceId, connector.key);
      const watch = parseAdWatchConfig(config);
      const ma = await checkMetaAdLibrary(plaintext, { searchTerms: watch.terms, countries: watch.countries, adType: watch.adType });
      await recordConnectorTest(client, { workspaceId, connectorKey: connector.key, result: ma.ok ? { ok: true } : { ok: false, error: ma.error } });
      revalidatePath("/settings");
      if (!ma.ok) return { ok: false, error: `Test failed: ${ma.error}` };
      return {
        ok: true,
        persisted: true,
        message: ma.count
          ? `Meta Ad Library reachable — matching ads found for “${watch.terms[0]}”.`
          : `Meta Ad Library reachable, but no ads matched “${watch.terms[0]}”. Outside the EU only political & social-issue ads are exposed by Meta's API.`,
      };
    }

    // Slack: the natural test is posting a message to the webhook.
    if (connector.key === SLACK_ALERTS_CONNECTOR_KEY) {
      const sl = await postSlackWebhook(plaintext, { text: "✅ Arc is connected. Opportunity alerts will post here when you send them." });
      await recordConnectorTest(client, { workspaceId, connectorKey: connector.key, result: { ok: sl.ok, error: sl.ok ? undefined : sl.error } });
      revalidatePath("/settings");
      return sl.ok ? { ok: true, persisted: true, message: "Test alert posted to your Slack channel." } : { ok: false, error: `Test failed: ${sl.error}` };
    }

    // Lead enrichment needs both the vendor key and the configured endpoint to probe
    // — the endpoint is where the key gets exercised, so a key-only test is meaningless.
    if (connector.key === "lead-enrichment") {
      const config = await getConnectorConfig(client, workspaceId, connector.key);
      const endpoint = typeof config.endpoint === "string" ? config.endpoint.trim() : "";
      if (!endpoint) return { ok: false, error: "Set the enrichment endpoint URL first, then test." };
      const en = await checkEnrichmentEndpoint(endpoint, plaintext);
      await recordConnectorTest(client, { workspaceId, connectorKey: connector.key, result: en });
      revalidatePath("/settings");
      return en.ok
        ? { ok: true, persisted: true, message: "Enrichment vendor reachable — the key authenticated." }
        : { ok: false, error: `Test failed: ${en.error ?? "endpoint unreachable"}` };
    }

    // Mailchimp needs both the key and the configured audience id to probe.
    if (connector.key === MAILCHIMP_IMPORT_CONNECTOR_KEY) {
      const config = await getConnectorConfig(client, workspaceId, connector.key);
      const audienceId = typeof config.audienceId === "string" ? config.audienceId.trim() : "";
      if (!audienceId) return { ok: false, error: "Set the Mailchimp audience id first, then test." };
      const mc = await checkMailchimpConnection(plaintext, audienceId);
      await recordConnectorTest(client, { workspaceId, connectorKey: connector.key, result: { ok: mc.ok, error: mc.error } });
      revalidatePath("/settings");
      if (!mc.ok) return { ok: false, error: `Test failed: ${mc.error ?? "Mailchimp unreachable"}` };
      return { ok: true, persisted: true, message: `Mailchimp reachable — ${mc.count ?? 0} member(s) available to import.` };
    }

    const result = await checkConnectorCredential(connector.key, plaintext);
    await recordConnectorTest(client, { workspaceId, connectorKey: connector.key, result });
    revalidatePath("/settings");

    return result.ok
      ? { ok: true, persisted: true, message: `${connector.label} connection is healthy.` }
      : { ok: false, error: `Test failed: ${result.error ?? "unknown error"}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not run the test." };
  }
}

export async function toggleConnectorEnabled(input: {
  connectorKey: string;
  enabled: boolean;
}): Promise<SettingsWriteResult> {
  await requireOperator();

  const connector = findConnector(input.connectorKey);
  if (!connector) return { ok: false, error: "Unknown connector." };
  if (!connectorIsAvailable(connector)) {
    return { ok: false, error: `${connector.label} isn't built yet — it can't be connected or switched on.` };
  }

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.workspaceId) return { ok: false, error: "No active workspace." };

  try {
    // Upsert, not update: no-credential connectors (e.g. a public signal source)
    // have no connect step to seed the row, so enabling must create it.
    await upsertConnectorEnabled(getSupabaseAdminClient(), {
      workspaceId: ctx.workspaceId,
      orgId: ctx.orgId ?? null,
      connectorKey: connector.key,
      enabled: input.enabled,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not update the connector." };
  }

  revalidatePath("/settings");
  // The Arc drawer switches connectors on and off too, and reads the same rows.
  revalidatePath("/arc");
  // "Paused" implied it had been running; `enabled: false` just means off.
  return { ok: true, persisted: true, message: input.enabled ? `${connector.label} turned on.` : `${connector.label} turned off.` };
}

/**
 * Save a connector's per-workspace config (e.g. a signal source's watched
 * locations, a channel's endpoint). Config lives in workspace_connectors.config;
 * no credential is involved, so this works for no-credential connectors too.
 */
export async function saveConnectorConfig(input: {
  connectorKey: string;
  config: Record<string, unknown>;
}): Promise<SettingsWriteResult> {
  await requireOperator();

  const connector = findConnector(input.connectorKey);
  if (!connector) return { ok: false, error: "Unknown connector." };
  if (!connectorIsAvailable(connector)) {
    return { ok: false, error: `${connector.label} isn't built yet — it can't be connected or switched on.` };
  }

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.workspaceId) return { ok: false, error: "No active workspace." };

  try {
    const client = getSupabaseAdminClient();
    // MERGE, don't replace. setConnectorConfig writes the whole `config` jsonb, and a
    // connector can expose more than one field (weather takes states AND points), each
    // with its own Save. Replacing would make saving one field silently wipe the other.
    // Read-then-merge here rather than in setConnectorConfig, so that stays a plain
    // setter and this partial-update intent is explicit.
    const existing = await getConnectorConfig(client, ctx.workspaceId, connector.key);
    await setConnectorConfig(client, {
      workspaceId: ctx.workspaceId,
      orgId: ctx.orgId ?? null,
      connectorKey: connector.key,
      config: { ...existing, ...input.config },
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save the connector config." };
  }

  revalidatePath("/settings");
  return { ok: true, persisted: true, message: `${connector.label} settings saved.` };
}

/**
 * Explicit operator-triggered CRM import (BSR-368). Import is a read-IN action that
 * writes CRM rows through the gated ingest path, so it runs ONLY on this deliberate
 * operator click — never automatically. Idempotent on the HubSpot record id (a
 * re-run updates, never duplicates), and org-scoped. Reports a per-run summary.
 */
export async function runConnectorImport(input: { connectorKey: string }): Promise<SettingsWriteResult> {
  await requireOperator();

  const connector = findConnector(input.connectorKey);
  if (!connector || connector.kind !== "import_source") return { ok: false, error: "Not an import connector." };
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect this workspace to run an import." };

  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.workspaceId || !ctx.orgId) return { ok: false, error: "No active workspace." };

  try {
    // Dispatch to the right import runner by connector — each fetches from its own
    // source but shares the ImportRunResult shape and the same downstream engine.
    const runImport = connector.key === MAILCHIMP_IMPORT_CONNECTOR_KEY ? runMailchimpImport : runCrmImport;
    const outcome = await runImport({
      workspaceId: ctx.workspaceId,
      orgId: ctx.orgId,
      allowedPersonaKeys: await getOrgPersonaKeys(ctx.orgId),
    });
    if (!outcome.ok) return { ok: false, error: importErrorMessage(outcome.error) };
    revalidatePath("/settings");
    const r = outcome.result;
    const enrichNote = outcome.enrichmentEnabled ? ` · ${r.enriched} enriched` : "";
    return {
      ok: true,
      persisted: true,
      message: `Import complete — ${r.imported} new, ${r.updated} updated, ${r.skipped} skipped${enrichNote}.`,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not run the import." };
  }
}

const SLACK_ALERTS_CONNECTOR_KEY = "slack-alerts";

/** Resolve the workspace's stored Slack webhook URL, or a structured miss. */
async function resolveSlackWebhook(): Promise<{ ok: true; url: string; orgId: string | null } | { ok: false; error: string }> {
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect this workspace first." };
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.workspaceId) return { ok: false, error: "No active workspace." };
  const client = getSupabaseAdminClient();
  const views = await listWorkspaceConnectors(client, ctx.workspaceId);
  const view = views.find((v) => v.key === SLACK_ALERTS_CONNECTOR_KEY);
  if (!view || view.status !== "connected") return { ok: false, error: "Connect + enable Slack Alerts first." };
  const ref = await resolveConnectorCredentialRef(client, ctx.workspaceId, SLACK_ALERTS_CONNECTOR_KEY);
  const url = await readConnectorCredential(client, ref);
  if (!url) return { ok: false, error: "No Slack webhook stored — connect Slack Alerts first." };
  return { ok: true, url, orgId: ctx.orgId ?? null };
}

/**
 * Post a digest of the current open opportunities to Slack. Operator-triggered — a
 * button, never automatic — so it stays inside "no outbound without a human". Internal
 * only: it summarises what Arc found for the team, never contacts a customer.
 */
export async function sendSlackDigestAction(): Promise<SettingsWriteResult> {
  await requireOperator();
  const resolved = await resolveSlackWebhook();
  if (!resolved.ok) return { ok: false, error: resolved.error };
  try {
    const opps = await listOpenOpportunities(getSupabaseAdminClient(), resolved.orgId ?? undefined);
    const digest = buildOpportunityDigest(
      opps.map((o) => ({ title: o.title, urgency: o.urgency, confidence: o.confidence })),
      { appUrl: "https://arc-studio.ai" },
    );
    const res = await postSlackWebhook(resolved.url, digest);
    return res.ok
      ? { ok: true, persisted: true, message: `Posted a digest of ${opps.length} open opportunit${opps.length === 1 ? "y" : "ies"} to Slack.` }
      : { ok: false, error: res.error };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not build the digest." };
  }
}

/**
 * Import leads from a pasted CSV. Unlike runConnectorImport (which fetches from a
 * connected source), the CSV arrives here from the operator, so it's its own action.
 * Operator-gated; nothing outbound.
 */
export async function runCsvImportAction(input: { csvText: string }): Promise<SettingsWriteResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect this workspace to run an import." };
  if (!input.csvText?.trim()) return { ok: false, error: "Paste some CSV first." };

  const ctx = await getCurrentWorkspaceContext();
  if (!ctx.workspaceId || !ctx.orgId) return { ok: false, error: "No active workspace." };

  try {
    const outcome = await runCsvImport({
      workspaceId: ctx.workspaceId,
      orgId: ctx.orgId,
      csvText: input.csvText,
      allowedPersonaKeys: await getOrgPersonaKeys(ctx.orgId),
    });
    if (!outcome.ok) return { ok: false, error: importErrorMessage(outcome.error) };
    revalidatePath("/settings");
    const r = outcome.result;
    const cols = Object.entries(outcome.parse.mappedColumns).map(([f, h]) => `${h}→${f}`).join(", ");
    return {
      ok: true,
      persisted: true,
      message:
        `Imported ${r.imported} new, ${r.updated} updated, ${r.skipped} skipped from ${outcome.parse.totalRows} rows.` +
        (cols ? ` Columns: ${cols}.` : ""),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not run the CSV import." };
  }
}

function importErrorMessage(code: string): string {
  switch (code) {
    case "hubspot_import_not_connected":
      return "Connect + enable HubSpot CRM Import first.";
    case "csv_import_not_connected":
      return `Enable ${findConnector(CSV_IMPORT_CONNECTOR_KEY)?.label ?? "CSV Import"} and set a default persona first.`;
    case "mailchimp_import_not_connected":
      return `Connect + enable ${findConnector(MAILCHIMP_IMPORT_CONNECTOR_KEY)?.label ?? "Mailchimp Import"} first.`;
    case "missing_audience":
      return "Set the Mailchimp audience id in the connector config before importing.";
    case "no_rows":
      return "No usable rows found — the CSV needs a header and at least one contact with a name, email, or phone.";
    case "missing_credential":
      return "No credential stored — connect the connector first.";
    case "missing_default_persona":
      return "Set a Default persona in the connector config before importing.";
    case "not_configured":
      return "Connect this workspace to run an import.";
    default:
      return `Import failed: ${code}`;
  }
}

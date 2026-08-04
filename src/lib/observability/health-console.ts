/**
 * Operator health console read-model (BSR-476).
 *
 * Answering "is prod actually working?" used to mean reading Vercel env, the
 * Supabase dashboard, Cloud Run logs, Sentry, and the connectors table — five
 * places, none of which agree on a moment in time. That is the environment in
 * which five stacked silent failures hid. This assembles one answer.
 *
 * Two rules this module must never break:
 *
 *  1. **Platform scope.** It reads across every workspace with the service-role
 *     client, so it is gated to `ARC_PLATFORM_ADMIN_EMAILS` BEFORE any query
 *     runs — a non-admin's request never touches a row. Same posture as the
 *     waitlist read-model (`src/lib/waitlist/read-model.ts`).
 *  2. **Presence, never value.** Env readiness reports set/unset only. No
 *     secret, key, token, or connection string is read into the view.
 */
import { resolveAgentConnection } from "@/lib/agent/connection";
import { getEmailConnection } from "@/lib/connections/read-model";
import { isMediaGenEnabled } from "@/lib/media";
import { isLiveSendEnabled } from "@/lib/dispatch/live-send";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { getSupabaseAuthenticatedUser } from "@/lib/supabase/auth-server";
import {
  ENV_CAPABILITIES,
  isEnvVarSet,
  reportCapabilities,
  type CapabilityState,
  type EnvRequirement,
} from "@/domain";
import { isPlatformAdmin } from "@/lib/waitlist/admin";

import {
  gradeAgentLoop,
  gradeMediaLoop,
  gradeSendLoop,
  worstState,
  type LoopState,
  type LoopVerdict,
} from "./health-grading";

/** Connector keys that power the media loop. */
const MEDIA_CONNECTOR_KEYS = ["gemini-media", "higgsfield"];
const RECENT_FAILURE_LIMIT = 10;
const FAILURE_WINDOW_HOURS = 24;

export type EnvFlag = {
  name: string;
  set: boolean;
  /** What breaks while it is unset. Shown verbatim to the operator. */
  purpose: string;
  /** Whether being unset actually costs this capability anything. */
  requirement: EnvRequirement;
};

export type EnvGroup = {
  capability: string;
  flags: EnvFlag[];
  /** ready / partial / inert, from the required vars only. */
  state: CapabilityState;
  /** One line: what is off and what that costs. */
  detail: string;
};

export type ConnectorHealthRow = {
  workspace: string;
  connectorKey: string;
  enabled: boolean;
  credentialPresent: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastError: string | null;
};

export type RunnerHealth = {
  configured: boolean;
  lastSeenAt: string | null;
  lastStatus: "ok" | "error" | "unreachable" | null;
  lastError: string | null;
  queued: number;
  running: number;
  oldestQueuedMinutes: number | null;
  failedLast24h: number;
};

export type Vital = {
  label: string;
  at: string | null;
  /** What it means when this has never happened. */
  emptyMeaning: string;
};

export type RecentFailure = {
  at: string | null;
  source: string;
  summary: string;
};

export type HealthConsoleView = {
  generatedAt: string;
  /** False when Supabase isn't configured — env readiness still renders. */
  databaseConfigured: boolean;
  overall: LoopState;
  loops: Array<{ key: "send" | "agent" | "media"; label: string } & LoopVerdict>;
  envGroups: EnvGroup[];
  connectors: ConnectorHealthRow[];
  runner: RunnerHealth;
  vitals: Vital[];
  failures: RecentFailure[];
  sentryConfigured: boolean;
};

const isSet = (value: string | undefined): boolean => Boolean(value?.trim());

/**
 * The capability-gating flags, grouped by the loop they gate.
 *
 * Deliberately declarative: adding a capability means adding a row here, not
 * threading a new boolean through the view. Values are never read — only
 * whether the variable is present.
 */
function readEnvGroups(env: NodeJS.ProcessEnv): EnvGroup[] {
  return reportCapabilities(env as Record<string, string | undefined>).map((report) => {
    const spec = ENV_CAPABILITIES.find((c) => c.key === report.key);
    return {
      capability: report.label,
      state: report.state,
      detail: report.detail,
      flags: (spec?.vars ?? []).map((varSpec) => ({
        name: varSpec.name,
        set: isEnvVarSet(env as Record<string, string | undefined>, varSpec),
        purpose: varSpec.ifUnset,
        requirement: varSpec.requirement,
      })),
    };
  });
}

function minutesSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.max(0, (now - then) / 60000);
}

/**
 * The whole console, or null for anyone who isn't a platform admin.
 *
 * Every database read is individually guarded — one broken query degrades its
 * own card rather than blanking the page an operator opened *because* something
 * is broken.
 */
export async function getHealthConsoleView(): Promise<HealthConsoleView | null> {
  const user = await getSupabaseAuthenticatedUser().catch(() => null);
  if (!isPlatformAdmin(user?.email)) return null;

  const now = Date.now();
  const env = process.env;
  const envGroups = readEnvGroups(env);
  const databaseConfigured = isSupabaseAdminConfigured();

  const [emailConnection, agentConnection] = await Promise.all([
    getEmailConnection().catch(() => null),
    resolveAgentConnection().catch(() => null),
  ]);

  let connectors: ConnectorHealthRow[] = [];
  let runnerCounts = { queued: 0, running: 0, oldestQueuedAt: null as string | null, failedLast24h: 0 };
  // Whether those zeros are a reading or an absence of one (BSR-575).
  let queueEvidenceMissing = false;
  let failures: RecentFailure[] = [];
  let lastOutboundAt: string | null = null;
  let lastInboundAt: string | null = null;
  let lastScanAt: string | null = null;
  let lastEmbeddingAt: string | null = null;

  if (databaseConfigured) {
    const supabase = getSupabaseAdminClient();
    const since = new Date(now - FAILURE_WINDOW_HOURS * 3600_000).toISOString();

    // Keep "this read failed" distinct from "there is nothing here" (BSR-575).
    //
    // Every read below used `.then((r) => r.data ?? [], () => [])`, which
    // collapses both a PostgREST `{ error }` result and a thrown rejection into
    // an empty list. For this console specifically that is self-defeating: zero
    // queued tasks and zero recent failures is precisely what a healthy idle
    // system looks like, so a database it could not read graded as `live` and
    // told the operator "Runner reachable and the queue is moving."
    //
    // The grading module already models `unknown` as distinct from `live` — the
    // information was simply being destroyed before it got there.
    const readFailures = new Set<string>();
    const rowsOf = <T>(table: string) =>
      [
        (r: { data: T[] | null; error: unknown }): T[] => {
          if (r.error) readFailures.add(table);
          return r.data ?? [];
        },
        (): T[] => {
          readFailures.add(table);
          return [];
        },
      ] as const;
    const countOf = (table: string) =>
      [
        (r: { count: number | null; error: unknown }): number => {
          // A null count with no error means the relation is missing or
          // inaccessible — NOT zero rows (BSR-575). Reporting 0 here would put a
          // confident number on the one screen whose job is saying whether prod
          // works.
          if (r.error || r.count === null) readFailures.add(table);
          return r.count ?? 0;
        },
        (): number => {
          readFailures.add(table);
          return 0;
        },
      ] as const;
    const oneOf = <T>(table: string) =>
      [
        (r: { data: T | null; error: unknown }): T | null => {
          if (r.error) readFailures.add(table);
          return r.data;
        },
        (): T | null => {
          readFailures.add(table);
          return null;
        },
      ] as const;

    const [
      connectorRows,
      workspaceRows,
      queuedRows,
      runningCount,
      failedCount,
      failureRows,
      outboundRow,
      inboundRow,
      scanRow,
      embeddingRow,
    ] = await Promise.all([
      supabase.from("workspace_connectors").select("workspace_id, connector_key, enabled, credential_ref, last_tested_at, last_test_ok, last_test_error").then(...rowsOf<Record<string, unknown>>("workspace_connectors")),
      supabase.from("workspaces").select("id, name").then(...rowsOf<{ id: string; name: string | null }>("workspaces")),
      supabase.from("agent_tasks").select("created_at").eq("status", "queued").order("created_at", { ascending: true }).then(...rowsOf<{ created_at: string }>("agent_tasks")),
      supabase.from("agent_tasks").select("id", { count: "exact", head: true }).eq("status", "running").then(...countOf("agent_tasks")),
      supabase.from("agent_tasks").select("id", { count: "exact", head: true }).eq("status", "failed").gte("updated_at", since).then(...countOf("agent_tasks")),
      supabase.from("agent_tasks").select("objective, task_type, updated_at, metadata").eq("status", "failed").order("updated_at", { ascending: false }).limit(RECENT_FAILURE_LIMIT).then(...rowsOf<Record<string, unknown>>("agent_tasks")),
      supabase.from("journey_touchpoints").select("occurred_at").eq("direction", "outbound").order("occurred_at", { ascending: false }).limit(1).maybeSingle().then(...oneOf<{ occurred_at?: string }>("journey_touchpoints")),
      supabase.from("journey_touchpoints").select("occurred_at").eq("direction", "inbound").order("occurred_at", { ascending: false }).limit(1).maybeSingle().then(...oneOf<{ occurred_at?: string }>("journey_touchpoints")),
      supabase.from("agent_tasks").select("created_at").eq("task_type", "arc_opportunity_scan").order("created_at", { ascending: false }).limit(1).maybeSingle().then(...oneOf<{ created_at?: string }>("agent_tasks")),
      supabase.from("knowledge_nodes").select("updated_at").not("embedding", "is", null).order("updated_at", { ascending: false }).limit(1).maybeSingle().then(...oneOf<{ updated_at?: string }>("knowledge_nodes")),
    ]);

    const workspaceNames = new Map<string, string>();
    for (const row of workspaceRows as Array<{ id: string; name: string | null }>) {
      workspaceNames.set(row.id, row.name?.trim() || row.id.slice(0, 8));
    }

    connectors = (connectorRows as Array<Record<string, unknown>>)
      .map((row) => ({
        workspace: workspaceNames.get(String(row.workspace_id)) ?? String(row.workspace_id).slice(0, 8),
        connectorKey: String(row.connector_key),
        enabled: Boolean(row.enabled),
        // Presence only — the credential itself lives in the Vault and is never read here.
        credentialPresent: row.credential_ref !== null && row.credential_ref !== undefined,
        lastTestedAt: (row.last_tested_at as string) ?? null,
        lastTestOk: (row.last_test_ok as boolean) ?? null,
        lastError: (row.last_test_error as string) ?? null,
      }))
      .sort((a, b) => a.workspace.localeCompare(b.workspace) || a.connectorKey.localeCompare(b.connectorKey));

    const queued = queuedRows as Array<{ created_at: string }>;
    runnerCounts = {
      queued: queued.length,
      running: runningCount as number,
      oldestQueuedAt: queued[0]?.created_at ?? null,
      failedLast24h: failedCount as number,
    };
    // The queue figures are only evidence if the queue was actually readable.
    queueEvidenceMissing = readFailures.has("agent_tasks");

    failures = (failureRows as Array<Record<string, unknown>>).map((row) => {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      const reason = typeof metadata.error === "string" ? metadata.error : typeof metadata.reason === "string" ? metadata.reason : null;
      return {
        at: (row.updated_at as string) ?? null,
        source: String(row.task_type ?? "agent_task"),
        summary: reason?.trim() || String(row.objective ?? "").trim() || "Failed with no recorded reason.",
      };
    });

    lastOutboundAt = (outboundRow as { occurred_at?: string } | null)?.occurred_at ?? null;
    lastInboundAt = (inboundRow as { occurred_at?: string } | null)?.occurred_at ?? null;
    lastScanAt = (scanRow as { created_at?: string } | null)?.created_at ?? null;
    lastEmbeddingAt = (embeddingRow as { updated_at?: string } | null)?.updated_at ?? null;
  }

  const enabledMediaConnectors = connectors.filter((c) => MEDIA_CONNECTOR_KEYS.includes(c.connectorKey) && c.enabled);

  const send = gradeSendLoop({
    killSwitchOn: isLiveSendEnabled(),
    connectionEnabled: Boolean(emailConnection?.enabled),
    credentialPresent: Boolean(emailConnection?.credentialPresent) || isSet(env.RESEND_API_KEY),
    lastTestOk: emailConnection?.lastTestOk ?? null,
    lastTestError: emailConnection?.lastTestError ?? null,
  });

  const runner: RunnerHealth = {
    configured: Boolean(agentConnection?.webhookUrl) && Boolean(agentConnection?.agentKey),
    lastSeenAt: agentConnection?.health.lastSeenAt ?? null,
    lastStatus: agentConnection?.health.lastStatus ?? null,
    lastError: agentConnection?.health.lastError ?? null,
    queued: runnerCounts.queued,
    running: runnerCounts.running,
    oldestQueuedMinutes: minutesSince(runnerCounts.oldestQueuedAt, now),
    failedLast24h: runnerCounts.failedLast24h,
  };

  const agent = gradeAgentLoop({
    configured: runner.configured,
    lastStatus: runner.lastStatus,
    lastError: runner.lastError,
    oldestQueuedMinutes: runner.oldestQueuedMinutes,
    failedRecently: runner.failedLast24h,
    evidenceMissing: queueEvidenceMissing,
  });

  const media = gradeMediaLoop({
    envEnabled: isMediaGenEnabled(),
    enabledConnectors: enabledMediaConnectors.map((c) => `${c.connectorKey} (${c.workspace})`),
    credentialledConnectors: enabledMediaConnectors.filter((c) => c.credentialPresent).map((c) => `${c.connectorKey} (${c.workspace})`),
  });

  const loops = [
    { key: "send" as const, label: "Send loop", ...send },
    { key: "agent" as const, label: "Agent loop", ...agent },
    { key: "media" as const, label: "Media loop", ...media },
  ];

  return {
    generatedAt: new Date(now).toISOString(),
    databaseConfigured,
    overall: worstState(loops.map((l) => l.state)),
    loops,
    envGroups,
    connectors,
    runner,
    vitals: [
      { label: "Last outbound touchpoint", at: lastOutboundAt, emptyMeaning: "Nothing has ever been sent." },
      { label: "Last inbound event", at: lastInboundAt, emptyMeaning: "No delivery, open, click, or reply has ever arrived — check RESEND_WEBHOOK_SECRET." },
      { label: "Last opportunity scan", at: lastScanAt, emptyMeaning: "The scan has never run." },
      { label: "Last embedding write", at: lastEmbeddingAt, emptyMeaning: "The Brain has never embedded a node." },
    ],
    failures,
    sentryConfigured: isSet(env.NEXT_PUBLIC_SENTRY_DSN),
  };
}

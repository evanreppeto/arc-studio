/**
 * Pure grading rules for the operator health console (BSR-476).
 *
 * Kept I/O-free and separate from the read-model so the judgement calls — "is
 * the send loop actually live?" — are unit-testable without a database. The
 * read-model gathers raw signals; everything here decides what they mean.
 *
 * Grading principle: **never report healthy on missing evidence.** An absent
 * signal is `unknown`, not `live`. This console exists because five stacked
 * silent failures hid behind screens that looked fine, so ambiguity has to read
 * as ambiguity.
 */

/** A capability's verdict. `off` is a deliberate choice; `unknown` is ignorance. */
export type LoopState = "live" | "degraded" | "down" | "off" | "unknown";

export type LoopVerdict = {
  state: LoopState;
  /** One line an operator can act on. Never contains a secret value. */
  detail: string;
};

export type SendSignals = {
  /** ARC_SEND_ENABLED — the deployment-wide kill switch. */
  killSwitchOn: boolean;
  /** An email connection row exists and is toggled on. */
  connectionEnabled: boolean;
  /** Its credential resolves (presence only — never the value). */
  credentialPresent: boolean;
  /** Result of the last connection test, if one has ever run. */
  lastTestOk: boolean | null;
  lastTestError: string | null;
};

export function gradeSendLoop(s: SendSignals): LoopVerdict {
  // The kill switch is checked first because it overrides everything below it:
  // a perfectly configured connection still sends nothing while it is dark.
  if (!s.killSwitchOn) {
    return { state: "off", detail: "ARC_SEND_ENABLED is unset — no mail can leave, whatever else is configured." };
  }
  if (!s.connectionEnabled) {
    return { state: "down", detail: "Send is armed but no email connection is enabled." };
  }
  if (!s.credentialPresent) {
    return { state: "down", detail: "Email connection is enabled but its credential is missing." };
  }
  if (s.lastTestOk === false) {
    return { state: "degraded", detail: s.lastTestError?.trim() || "The last connection test failed." };
  }
  if (s.lastTestOk === null) {
    return { state: "unknown", detail: "Armed and credentialled, but never tested — health is unproven." };
  }
  return { state: "live", detail: "Armed, credentialled, and the last test passed." };
}

export type AgentSignals = {
  /** Runner URL + agent key are configured. */
  configured: boolean;
  lastStatus: "ok" | "error" | "unreachable" | null;
  lastError: string | null;
  /** Age of the oldest task still sitting in `queued`, in minutes. */
  oldestQueuedMinutes: number | null;
  failedRecently: number;
  /**
   * True when the queue/failure figures could not be read at all.
   *
   * Without this they arrive as zeros, and "no queued work, no recent failures"
   * is exactly what a healthy idle system looks like — so a database this
   * console cannot read graded as `live` (BSR-575).
   */
  evidenceMissing?: boolean;
};

/**
 * A queued task older than this with nothing picking it up is a stall.
 *
 * The runner is webhook-driven, not polled, so a *stale heartbeat* is NOT by
 * itself a fault — it may simply have had nothing to do. Work sitting unclaimed
 * is the signal that actually means something is broken, which is why grading
 * keys off the queue rather than off last-seen.
 */
export const QUEUE_STALL_MINUTES = 30;

export function gradeAgentLoop(s: AgentSignals): LoopVerdict {
  if (!s.configured) {
    return { state: "off", detail: "No runner URL or agent key configured." };
  }
  if (s.lastStatus === "unreachable") {
    return { state: "down", detail: s.lastError?.trim() || "The runner is unreachable." };
  }
  if (s.lastStatus === "error") {
    return { state: "degraded", detail: s.lastError?.trim() || "The runner's last call returned an error." };
  }
  // Checked after the runner-connection verdicts above, which come from the
  // heartbeat rather than from the queue — a genuinely unreachable runner is
  // still `down` even when the queue is unreadable. But everything BELOW this
  // line reasons from figures that default to zero, so without evidence they
  // must not be reasoned from at all.
  if (s.evidenceMissing) {
    return { state: "unknown", detail: "The task queue could not be read, so the runner's health is unproven." };
  }
  if (s.oldestQueuedMinutes !== null && s.oldestQueuedMinutes >= QUEUE_STALL_MINUTES) {
    return {
      state: "down",
      detail: `A task has been queued for ${formatMinutes(s.oldestQueuedMinutes)} with nothing picking it up.`,
    };
  }
  if (s.lastStatus === null) {
    return { state: "unknown", detail: "Configured, but the runner has never checked in." };
  }
  if (s.failedRecently > 0) {
    return { state: "degraded", detail: `${s.failedRecently} task${s.failedRecently === 1 ? "" : "s"} failed in the last 24h.` };
  }
  return { state: "live", detail: "Runner reachable and the queue is moving." };
}

export type MediaSignals = {
  /** Legacy deployment-wide ARC_MEDIA_ENABLED + GEMINI_API_KEY. */
  envEnabled: boolean;
  /** Per-workspace `gemini-media` / `higgsfield` connectors that are switched on. */
  enabledConnectors: readonly string[];
  /** Of those, the ones whose stored credential actually resolves. */
  credentialledConnectors: readonly string[];
};

export function gradeMediaLoop(s: MediaSignals): LoopVerdict {
  if (s.credentialledConnectors.length > 0) {
    return { state: "live", detail: `Enabled via ${s.credentialledConnectors.join(", ")}.` };
  }
  if (s.enabledConnectors.length > 0) {
    return {
      state: "down",
      detail: `${s.enabledConnectors.join(", ")} enabled but no credential is stored.`,
    };
  }
  if (s.envEnabled) {
    return { state: "live", detail: "Enabled by the legacy ARC_MEDIA_ENABLED path." };
  }
  return { state: "off", detail: "No media connector enabled for any workspace." };
}

/** Minutes → a short human phrase. Used in operator-facing copy. */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Worst state across several verdicts — drives the page's single top-line answer. */
export function worstState(states: readonly LoopState[]): LoopState {
  const rank: Record<LoopState, number> = { down: 4, degraded: 3, unknown: 2, off: 1, live: 0 };
  return states.reduce<LoopState>((worst, s) => (rank[s] > rank[worst] ? s : worst), "live");
}

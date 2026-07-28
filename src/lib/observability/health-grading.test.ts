import { describe, expect, it } from "vitest";

import {
  QUEUE_STALL_MINUTES,
  formatMinutes,
  gradeAgentLoop,
  gradeMediaLoop,
  gradeSendLoop,
  worstState,
  type AgentSignals,
  type MediaSignals,
  type SendSignals,
} from "./health-grading";

const send = (over: Partial<SendSignals> = {}): SendSignals => ({
  killSwitchOn: true,
  connectionEnabled: true,
  credentialPresent: true,
  lastTestOk: true,
  lastTestError: null,
  ...over,
});

const agent = (over: Partial<AgentSignals> = {}): AgentSignals => ({
  configured: true,
  lastStatus: "ok",
  lastError: null,
  oldestQueuedMinutes: null,
  failedRecently: 0,
  ...over,
});

const media = (over: Partial<MediaSignals> = {}): MediaSignals => ({
  envEnabled: false,
  enabledConnectors: [],
  credentialledConnectors: [],
  ...over,
});

describe("gradeSendLoop", () => {
  it("is live only when armed, connected, credentialled, and tested", () => {
    expect(gradeSendLoop(send()).state).toBe("live");
  });

  it("reports off when the kill switch is dark, even if everything else is perfect", () => {
    // The whole point of ARC_SEND_ENABLED: a fully configured connection still
    // sends nothing. Reporting this as `live` would be a lie an operator acts on.
    const verdict = gradeSendLoop(send({ killSwitchOn: false }));
    expect(verdict.state).toBe("off");
    expect(verdict.detail).toContain("ARC_SEND_ENABLED");
  });

  it("is down when armed but nothing is enabled or credentialled", () => {
    expect(gradeSendLoop(send({ connectionEnabled: false })).state).toBe("down");
    expect(gradeSendLoop(send({ credentialPresent: false })).state).toBe("down");
  });

  it("surfaces the real error text when the last test failed", () => {
    const verdict = gradeSendLoop(send({ lastTestOk: false, lastTestError: "401 unauthorized" }));
    expect(verdict.state).toBe("degraded");
    expect(verdict.detail).toBe("401 unauthorized");
  });

  it("is unknown — never live — when it has never been tested", () => {
    // Missing evidence must not read as health.
    expect(gradeSendLoop(send({ lastTestOk: null })).state).toBe("unknown");
  });
});

describe("gradeAgentLoop", () => {
  it("is live when reachable and the queue is moving", () => {
    expect(gradeAgentLoop(agent()).state).toBe("live");
  });

  it("does NOT fault a stale heartbeat on its own", () => {
    // The runner is webhook-driven, so "hasn't been seen in a while" can simply
    // mean it had nothing to do. Grading off last-seen would cry wolf nightly.
    expect(gradeAgentLoop(agent({ oldestQueuedMinutes: null })).state).toBe("live");
  });

  it("is down when work sits unclaimed past the stall threshold", () => {
    const verdict = gradeAgentLoop(agent({ oldestQueuedMinutes: QUEUE_STALL_MINUTES }));
    expect(verdict.state).toBe("down");
    expect(verdict.detail).toContain("queued");
  });

  it("tolerates a queue that is merely young", () => {
    expect(gradeAgentLoop(agent({ oldestQueuedMinutes: QUEUE_STALL_MINUTES - 1 })).state).toBe("live");
  });

  it("ranks unreachable above a plain error", () => {
    expect(gradeAgentLoop(agent({ lastStatus: "unreachable" })).state).toBe("down");
    expect(gradeAgentLoop(agent({ lastStatus: "error" })).state).toBe("degraded");
  });

  it("is unknown when configured but never seen", () => {
    expect(gradeAgentLoop(agent({ lastStatus: null })).state).toBe("unknown");
  });

  it("degrades on recent failures", () => {
    expect(gradeAgentLoop(agent({ failedRecently: 3 })).detail).toContain("3 tasks failed");
  });

  it("is off when nothing is configured", () => {
    expect(gradeAgentLoop(agent({ configured: false })).state).toBe("off");
  });
});

describe("gradeMediaLoop", () => {
  it("is live when a connector has a resolving credential", () => {
    const verdict = gradeMediaLoop(media({ enabledConnectors: ["gemini-media"], credentialledConnectors: ["gemini-media"] }));
    expect(verdict.state).toBe("live");
  });

  it("is DOWN — not live — when enabled without a credential", () => {
    // This is the exact Higgsfield situation: switched on, no stored credential,
    // generates nothing. A naive "enabled?" check would call this healthy.
    const verdict = gradeMediaLoop(media({ enabledConnectors: ["higgsfield"] }));
    expect(verdict.state).toBe("down");
    expect(verdict.detail).toContain("no credential");
  });

  it("still honours the legacy env path", () => {
    expect(gradeMediaLoop(media({ envEnabled: true })).state).toBe("live");
  });

  it("is off when nothing is enabled anywhere", () => {
    expect(gradeMediaLoop(media()).state).toBe("off");
  });
});

describe("worstState", () => {
  it("ranks down above degraded above unknown above off above live", () => {
    expect(worstState(["live", "off", "unknown", "degraded", "down"])).toBe("down");
    expect(worstState(["live", "off", "unknown", "degraded"])).toBe("degraded");
    expect(worstState(["live", "off", "unknown"])).toBe("unknown");
    expect(worstState(["live", "off"])).toBe("off");
    expect(worstState(["live", "live"])).toBe("live");
  });

  it("is live for an empty list", () => {
    expect(worstState([])).toBe("live");
  });
});

describe("formatMinutes", () => {
  it("scales the unit to the magnitude", () => {
    expect(formatMinutes(5)).toBe("5m");
    expect(formatMinutes(59)).toBe("59m");
    expect(formatMinutes(90)).toBe("2h");
    expect(formatMinutes(60 * 24 * 3)).toBe("3d");
  });
});

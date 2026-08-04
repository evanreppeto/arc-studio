import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BSR-479: a connector that cannot produce a token must not disappear silently.
 *
 * `resolveRemoteConnectorsForRunner` dropped a connector with a bare `continue`
 * in two places — a refresh that failed, and a credential that could not be
 * read. Both removed a capability the operator had explicitly enabled, with no
 * log, no Sentry, and nothing on any screen. Arc simply stopped having the tool,
 * which reads as Arc choosing not to use it.
 *
 * It still degrades rather than throwing — one dead connector must not take the
 * whole run down — so the only thing distinguishing "correctly degraded" from
 * "silently broken" is the report. That is what these pin.
 */

const reportDegraded = vi.fn();
const ensureFreshAccessToken = vi.fn();
const readConnectorCredential = vi.fn();

vi.mock("@/lib/observability/report-degraded", () => ({ reportDegraded }));
vi.mock("./oauth-refresh", () => ({ ensureFreshAccessToken: (...a: unknown[]) => ensureFreshAccessToken(...a) }));
vi.mock("./credentials", () => ({ readConnectorCredential: (...a: unknown[]) => readConnectorCredential(...a) }));
vi.mock("./read-model", () => ({
  listWorkspaceConnectors: async () => [{ key: "higgsfield", enabled: true, credentialPresent: true }],
  resolveConnectorCredentialRef: async () => "cred-ref-1",
}));

// The WIRE shape. `serializeOAuthBundle` emits `type`, while callers pass
// `kind` for the in-memory discriminator — a mismatch that looks like a bug and
// is not. Getting this wrong makes the bundle parse as a plain bearer whose
// token is the entire JSON string, which is exactly what this fixture did first.
const OAUTH_BUNDLE = JSON.stringify({
  type: "oauth_refresh",
  accessToken: "at",
  refreshToken: "rt",
  expiresAt: 0,
  clientId: "cid",
  tokenEndpoint: "https://mcp.higgsfield.ai/token",
});

beforeEach(() => {
  vi.clearAllMocks();
  readConnectorCredential.mockResolvedValue(OAUTH_BUNDLE);
});

// Imported once here rather than inside `resolve()`. It has to stay DYNAMIC —
// the mock factories above close over consts declared below the import block,
// and a static import is hoisted past them into a TDZ error — but at module
// scope the transform is paid during collection instead of being charged to
// whichever test called `resolve()` first (BSR-739).
const { resolveRemoteConnectorsForRunner } = await import("./runner-connectors");

async function resolve() {
  return resolveRemoteConnectorsForRunner({} as never, "ws-1");
}

describe("a connector dropped because its refresh failed", () => {
  beforeEach(() => {
    ensureFreshAccessToken.mockResolvedValue({
      ok: false,
      reason: "needs_reconnect",
      error: "refresh failed (401): invalid_grant",
    });
  });

  it("is still dropped — one dead connector must not fail the whole run", async () => {
    await expect(resolve()).resolves.toEqual([]);
  });

  it("reports the failure instead of vanishing", async () => {
    await resolve();
    expect(reportDegraded).toHaveBeenCalledTimes(1);
  });

  it("names the connector, the workspace and the reason", async () => {
    await resolve();
    const [error, context] = reportDegraded.mock.calls[0] as [Error, { detail: Record<string, unknown>; surface: string }];
    expect(error.message).toContain("higgsfield");
    expect(error.message).toContain("invalid_grant");
    expect(context.detail).toMatchObject({ connector: "higgsfield", workspaceId: "ws-1", reason: "needs_reconnect" });
  });

  it("treats it as primary — a lost capability is not a warning", async () => {
    await resolve();
    expect((reportDegraded.mock.calls[0]![1] as { surface: string }).surface).toBe("primary");
  });
});

describe("a connector dropped because its credential could not be read", () => {
  it("reports rather than dropping silently", async () => {
    // `credentialPresent` is true, so an unreadable bundle is an inconsistency,
    // not a configuration choice.
    readConnectorCredential.mockResolvedValue(null);
    await expect(resolve()).resolves.toEqual([]);
    expect(reportDegraded).toHaveBeenCalledTimes(1);
    expect((reportDegraded.mock.calls[0]![1] as { detail: Record<string, unknown> }).detail).toMatchObject({
      reason: "credential_unreadable",
    });
  });
});

describe("the healthy path", () => {
  it("returns the connector and reports nothing", async () => {
    ensureFreshAccessToken.mockResolvedValue({ ok: true, accessToken: "fresh-token" });
    const out = await resolve();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ token: "fresh-token" });
    // A working connector must stay quiet, or the signal becomes noise.
    expect(reportDegraded).not.toHaveBeenCalled();
  });
});

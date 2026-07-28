import { beforeEach, describe, expect, it, vi } from "vitest";

// The console reads across every workspace with the service-role client, so the
// platform-admin gate is the only thing standing between an ordinary operator
// and every tenant's connector state. These tests pin that gate, and pin that it
// runs BEFORE any query — "returns null" is not enough if a row was read first.

const getSupabaseAuthenticatedUser = vi.fn(async () => ({ email: "admin@arc.test" }) as { email: string } | null);
const getSupabaseAdminClient = vi.fn();
const isSupabaseAdminConfigured = vi.fn(() => false);
const getEmailConnection = vi.fn(async () => null);
const resolveAgentConnection = vi.fn(async () => null);

vi.mock("@/lib/supabase/auth-server", () => ({ getSupabaseAuthenticatedUser: () => getSupabaseAuthenticatedUser() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdminClient: () => getSupabaseAdminClient(),
  isSupabaseAdminConfigured: () => isSupabaseAdminConfigured(),
}));
vi.mock("@/lib/connections/read-model", () => ({ getEmailConnection: () => getEmailConnection() }));
vi.mock("@/lib/agent/connection", () => ({ resolveAgentConnection: () => resolveAgentConnection() }));
vi.mock("@/lib/media", () => ({ isMediaGenEnabled: () => false }));
vi.mock("@/lib/dispatch/live-send", () => ({ isLiveSendEnabled: () => false }));

import { getHealthConsoleView } from "./health-console";

beforeEach(() => {
  vi.clearAllMocks();
  isSupabaseAdminConfigured.mockReturnValue(false);
  getSupabaseAuthenticatedUser.mockResolvedValue({ email: "admin@arc.test" });
  vi.stubEnv("ARC_PLATFORM_ADMIN_EMAILS", "admin@arc.test");
});

describe("the platform-admin gate", () => {
  it("returns null for a signed-in operator who is not a platform admin", async () => {
    getSupabaseAuthenticatedUser.mockResolvedValue({ email: "teammate@bsr.test" });
    await expect(getHealthConsoleView()).resolves.toBeNull();
  });

  it("returns null for a signed-out visitor", async () => {
    getSupabaseAuthenticatedUser.mockResolvedValue(null);
    await expect(getHealthConsoleView()).resolves.toBeNull();
  });

  it("returns null for EVERYONE when the allowlist is unset", async () => {
    // Unset must mean nobody — not "anybody", and not "the first signed-in user".
    vi.stubEnv("ARC_PLATFORM_ADMIN_EMAILS", "");
    await expect(getHealthConsoleView()).resolves.toBeNull();
  });

  it("never touches the database for a non-admin", async () => {
    // The strong form of the gate: a rejected caller must not have read a single
    // connector row on their way to being rejected.
    getSupabaseAuthenticatedUser.mockResolvedValue({ email: "teammate@bsr.test" });
    isSupabaseAdminConfigured.mockReturnValue(true);
    await getHealthConsoleView();
    expect(getSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("matches the allowlist case-insensitively", async () => {
    vi.stubEnv("ARC_PLATFORM_ADMIN_EMAILS", "Admin@Arc.Test");
    getSupabaseAuthenticatedUser.mockResolvedValue({ email: "admin@arc.test" });
    await expect(getHealthConsoleView()).resolves.not.toBeNull();
  });
});

describe("degrading without a database", () => {
  it("still returns env readiness so an unconfigured deployment is legible", async () => {
    const view = await getHealthConsoleView();
    expect(view).not.toBeNull();
    expect(view!.databaseConfigured).toBe(false);
    expect(view!.envGroups.length).toBeGreaterThan(0);
    expect(view!.connectors).toEqual([]);
  });

  it("reports flag presence without ever exposing a value", async () => {
    vi.stubEnv("ARC_SEND_ENABLED", "1");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_super_secret_value");
    const view = await getHealthConsoleView();
    const flags = view!.envGroups.flatMap((g) => g.flags);

    expect(flags.find((f) => f.name === "ARC_SEND_ENABLED")?.set).toBe(true);
    expect(flags.find((f) => f.name === "STRIPE_SECRET_KEY")?.set).toBe(true);
    // The whole view, serialized, must not contain the secret anywhere.
    expect(JSON.stringify(view)).not.toContain("sk_live_super_secret_value");
  });

  it("treats a whitespace-only variable as unset", async () => {
    vi.stubEnv("ARC_SEND_ENABLED", "   ");
    const view = await getHealthConsoleView();
    const flag = view!.envGroups.flatMap((g) => g.flags).find((f) => f.name === "ARC_SEND_ENABLED");
    expect(flag?.set).toBe(false);
  });
});

describe("the top-line verdict", () => {
  it("names all three loops", async () => {
    const view = await getHealthConsoleView();
    expect(view!.loops.map((l) => l.key)).toEqual(["send", "agent", "media"]);
  });

  it("does not claim health when the send switch is dark and the runner is absent", async () => {
    const view = await getHealthConsoleView();
    expect(view!.overall).not.toBe("live");
  });
});

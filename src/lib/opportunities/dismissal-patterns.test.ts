import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/org", () => ({ getCurrentOrgId: async () => "org-1" }));

import { getDismissalPatterns } from "./read-model";
import { dismissOpportunity } from "./persistence";

/**
 * BSR-686. Dismiss recorded nothing; 46 of prod's 134 opportunities sat
 * dismissed with the judgement behind them thrown away.
 */

/** Minimal chainable stand-in for the two calls each path makes. */
function selectClient(rows: Array<{ kind: string | null; dismissed_reason: string | null }>) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) chain[m] = () => chain;
  chain.not = async () => ({ data: rows, error: null });
  return { from: () => chain } as never;
}

function updateClient() {
  const captured: Array<Record<string, unknown>> = [];
  const chain: Record<string, unknown> = {};
  chain.update = (patch: Record<string, unknown>) => {
    captured.push(patch);
    return chain;
  };
  let eqCalls = 0;
  chain.eq = () => {
    eqCalls += 1;
    // setStatus chains .eq("org_id").eq("id"); the second resolves the query.
    return eqCalls >= 2 ? Promise.resolve({ error: null }) : chain;
  };
  return { client: { from: () => chain } as never, captured };
}

describe("dismissOpportunity records the reason", () => {
  // setStatus short-circuits on the unconfigured-Supabase guard before it ever
  // reaches the client, so the write path needs the env present to be exercised.
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  });

  it("writes the operator's reason onto the row", async () => {
    const { client, captured } = updateClient();
    await dismissOpportunity("opp-1", "not_relevant", client, { orgId: "org-1" });
    expect(captured[0]).toMatchObject({ status: "dismissed", dismissed_reason: "not_relevant" });
    expect(captured[0].dismissed_at).toBeTruthy();
  });

  it("still dismisses when no reason is given — the reason is optional by design", async () => {
    const { client, captured } = updateClient();
    await dismissOpportunity("opp-1", undefined, client, { orgId: "org-1" });
    expect(captured[0]).toMatchObject({ status: "dismissed", dismissed_reason: null });
  });

  it("drops a value outside the vocabulary instead of letting the DB reject the whole dismissal", async () => {
    // The CHECK constraint is the backstop, not the first line: a bad reason
    // must cost the reason, never the dismissal itself.
    const { client, captured } = updateClient();
    await dismissOpportunity("opp-1", "nonsense" as never, client, { orgId: "org-1" });
    expect(captured[0]).toMatchObject({ status: "dismissed", dismissed_reason: null });
  });
});

describe("getDismissalPatterns", () => {
  it("groups by reason AND kind — the pair is the sentence", async () => {
    const out = await getDismissalPatterns(
      "org-1",
      selectClient([
        { kind: "crm_inactivity", dismissed_reason: "not_relevant" },
        { kind: "crm_inactivity", dismissed_reason: "not_relevant" },
        { kind: "weather_event", dismissed_reason: "not_relevant" },
      ]),
    );
    expect(out).toEqual([
      { reason: "not_relevant", kind: "crm_inactivity", count: 2 },
      { reason: "not_relevant", kind: "weather_event", count: 1 },
    ]);
  });

  it("ignores rows whose reason is not in the vocabulary", async () => {
    const out = await getDismissalPatterns(
      "org-1",
      selectClient([
        { kind: "crm_inactivity", dismissed_reason: "retired_reason" },
        { kind: "crm_inactivity", dismissed_reason: "not_relevant" },
      ]),
    );
    expect(out).toEqual([{ reason: "not_relevant", kind: "crm_inactivity", count: 1 }]);
  });

  it("returns an empty list rather than throwing when the read fails", async () => {
    // This feeds Arc's per-turn context; a degraded read must not take a turn down.
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) chain[m] = () => chain;
    chain.not = async () => ({ data: null, error: { message: "boom" } });
    await expect(getDismissalPatterns("org-1", { from: () => chain } as never)).resolves.toEqual([]);
  });
});

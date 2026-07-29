import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";
import { type OpportunityCandidate } from "@/domain";

/**
 * runColdLeadDetection is what writes the Opportunity Inbox — 64 of prod's 82 open
 * cards came from it. Every test that mentioned it mocked it with vi.fn(), so its
 * body had never once executed under test: the suite stayed green while the card
 * titles it produces were "Lead c1aa307a" for months.
 *
 * This runs the real thing against a fake client, and asserts on the candidates it
 * hands to persistence — the actual product of the function.
 */

const listLeads = vi.fn();
vi.mock("@/lib/repos/leads", () => ({ listLeads: (...args: unknown[]) => listLeads(...args) }));

// Typed so the captured candidates keep their shape — an `unknown[]` mock would
// let a wrong assertion typecheck.
const upsertOpportunities =
  vi.fn<(candidates: OpportunityCandidate[], db?: unknown) => Promise<{ ok: true; count: number }>>();
vi.mock("./persistence", () => ({
  upsertOpportunities: (candidates: OpportunityCandidate[], db?: unknown) => upsertOpportunities(candidates, db),
}));

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: () => true,
  getSupabaseAdminClient: () => {
    throw new Error("detector must use the injected client");
  },
}));

const { runColdLeadDetection } = await import("./detector");

const NOW = "2026-07-16T13:00:00.000Z";
const QUIET = "2026-06-06T13:00:00.000Z"; // 40 days before NOW

const lead = (over: Record<string, unknown> = {}) => ({
  id: "c1aa307a-1111-2222-3333-444444444444",
  companyId: "co_1",
  contactId: "ct_1",
  persona: "persona_property_manager",
  leadScore: 71,
  status: "qualified",
  lossSummary: null,
  receivedAt: QUIET,
  ...over,
});

/** The candidates handed to persistence — what the inbox actually gets. */
const captured = (): OpportunityCandidate[] => {
  const call = upsertOpportunities.mock.calls[0];
  if (!call) throw new Error("persistence was never called — the detector produced nothing");
  return call[0];
};

const client = (over: Record<string, unknown> = {}) =>
  createSupabaseQueryMock({
    events: { data: [], error: null },
    campaigns: { data: [], error: null },
    companies: { data: [{ id: "co_1", name: "North Shore Property Group" }], error: null },
    contacts: { data: [{ id: "ct_1", full_name: "Dana Whitfield" }], error: null },
    ...over,
  });

beforeEach(() => {
  vi.clearAllMocks();
  upsertOpportunities.mockResolvedValue({ ok: true, count: 1 });
});

describe("runColdLeadDetection card titles", () => {
  it("names the card after the person and their account", async () => {
    listLeads.mockResolvedValue([lead()]);
    await runColdLeadDetection(client(), NOW);

    // The regression this pins: it used to read "Lead c1aa307a — quiet 40 days".
    expect(captured()[0].title).toBe("Dana Whitfield (North Shore Property Group) — quiet 40 days");
  });

  it("falls back to the company when the lead has no contact", async () => {
    listLeads.mockResolvedValue([lead({ contactId: null })]);
    await runColdLeadDetection(client(), NOW);
    expect(captured()[0].title).toBe("North Shore Property Group — quiet 40 days");
  });

  it("uses the uuid only when nothing else identifies the lead", async () => {
    listLeads.mockResolvedValue([lead({ contactId: null, companyId: null })]);
    await runColdLeadDetection(client(), NOW);
    expect(captured()[0].title).toBe("Lead c1aa307a — quiet 40 days");
  });

  it("prefers a real name over the loss summary", async () => {
    // The original bug: lossSummary won, and it was set on 1 of 64 prod leads.
    listLeads.mockResolvedValue([lead({ lossSummary: "Basement flood, 2 units" })]);
    await runColdLeadDetection(client(), NOW);
    expect(captured()[0].title).toContain("Dana Whitfield");
  });

  it("falls back to the loss summary when the record is nameless", async () => {
    listLeads.mockResolvedValue([lead({ contactId: null, companyId: null, lossSummary: "Basement flood, 2 units" })]);
    await runColdLeadDetection(client(), NOW);
    expect(captured()[0].title).toBe("Basement flood, 2 units — quiet 40 days");
  });

  it("survives a name lookup returning nothing rather than titling the card null", async () => {
    listLeads.mockResolvedValue([lead()]);
    await runColdLeadDetection(client({ companies: { data: [], error: null }, contacts: { data: [], error: null } }), NOW);
    const title = captured()[0].title;
    expect(title).toBe("Lead c1aa307a — quiet 40 days");
    expect(title).not.toMatch(/null|undefined/);
  });

  it("resolves names and fit signals in bulk — constant lookups regardless of lead count", async () => {
    // N+1 here would mean 500 round-trips on the daily scan (listLeads takes 500).
    // What matters is that the count does NOT grow with the number of leads —
    // three leads produce the same queries as five hundred.
    listLeads.mockResolvedValue([
      lead(),
      lead({ id: "74d34ec4-0000-0000-0000-000000000000", contactId: "ct_1", companyId: "co_1" }),
      lead({ id: "94e4fdb5-0000-0000-0000-000000000000", contactId: "ct_1", companyId: "co_1" }),
    ]);
    const db = client();
    await runColdLeadDetection(db, NOW);

    const from = (db as unknown as { calls: Array<[string, ...unknown[]]> }).calls.filter((c) => c[0] === "from");
    expect(from.filter((c) => c[1] === "companies")).toHaveLength(1);
    // Two bulk contacts reads: names, then the email/phone/city that feed the
    // fit score for records with no intent signals. Both are single `in(...)`
    // queries over the same org-scoped ids.
    expect(from.filter((c) => c[1] === "contacts")).toHaveLength(2);
    expect(captured()).toHaveLength(3);
  });
});

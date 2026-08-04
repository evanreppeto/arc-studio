import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

// countPendingOpportunities resolves the org even when handed an explicit
// client; the demo/unconfigured tests below return before reaching it.
vi.mock("@/lib/auth/org", () => ({ getCurrentOrgId: async () => "org-1" }));

import {
  countPendingOpportunities,
  getOpportunityForCampaign,
  getOpportunityForDraft,
  listOpenOpportunities,
} from "./read-model";

const SUPABASE_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_MARKETING_SUPABASE_URL",
  "MARKETING_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MARKETING_SUPABASE_SERVICE_ROLE_KEY",
];

function unconfigureSupabase() {
  for (const key of SUPABASE_ENV) vi.stubEnv(key, "");
}

describe("opportunities demo fallback", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("serves a populated, source-backed inbox when Supabase is unconfigured and demo mode is on", async () => {
    unconfigureSupabase();
    vi.stubEnv("ARC_DEMO_DATA", "1");

    const records = await listOpenOpportunities();

    expect(records.length).toBeGreaterThan(0);
    for (const rec of records) {
      expect(rec.title).toBeTruthy();
      expect(rec.summary).toBeTruthy();
      expect(rec.recommended_action).toBeTruthy();
      expect(["low", "medium", "high"]).toContain(rec.urgency);
      expect(rec.confidence).toBeGreaterThan(0);
      expect(["pending", "drafting", "drafted"]).toContain(rec.status);
    }
  });

  it("threads campaign_id onto a drafted opportunity so the inbox can link it", async () => {
    unconfigureSupabase();
    vi.stubEnv("ARC_DEMO_DATA", "1");

    const records = await listOpenOpportunities();
    const drafted = records.find((r) => r.status === "drafted");

    // A drafted opportunity is one that has already been converted, so it must
    // carry the linked campaign id the UI turns into an "Open campaign →" CTA.
    expect(drafted).toBeDefined();
    expect(drafted?.campaign_id).toBeTruthy();
  });

  it("keeps the home hero count and the pending count derived from one source", async () => {
    unconfigureSupabase();
    vi.stubEnv("ARC_DEMO_DATA", "1");

    const records = await listOpenOpportunities();
    const pending = await countPendingOpportunities();

    // The pending count is exactly the pending slice of the same inbox — so the
    // /arc chip can't disagree with the Opportunities screen.
    expect(pending).toBe(records.filter((r) => r.status === "pending").length);
  });

  it("loads a single demo opportunity for the Draft-with-Arc flow", async () => {
    unconfigureSupabase();
    vi.stubEnv("ARC_DEMO_DATA", "1");

    const [first] = await listOpenOpportunities();
    const draft = await getOpportunityForDraft(first.id);

    expect(draft).not.toBeNull();
    expect(draft?.id).toBe(first.id);
    expect(draft?.title).toBe(first.title);
    expect(draft?.persona).toBe(first.evidence?.persona ?? "");
  });

  it("loads a single demo opportunity (campaignId null) for the campaign-conversion flow", async () => {
    unconfigureSupabase();
    vi.stubEnv("ARC_DEMO_DATA", "1");

    const [first] = await listOpenOpportunities();
    const opp = await getOpportunityForCampaign(first.id);

    expect(opp).not.toBeNull();
    expect(opp?.id).toBe(first.id);
    expect(opp?.subjectType).toBe(first.subject_type);
    expect(opp?.subjectId).toBe(first.subject_id);
    // The demo read-model carries no DB link, so conversion always starts fresh.
    expect(opp?.campaignId).toBeNull();
  });

  it("returns empty / null (no crash) when Supabase is unconfigured and demo mode is off", async () => {
    unconfigureSupabase();
    vi.stubEnv("ARC_DEMO_DATA", "0");

    await expect(listOpenOpportunities()).resolves.toEqual([]);
    await expect(countPendingOpportunities()).resolves.toBe(0);
    await expect(getOpportunityForDraft("demo-opp-storm-riverside")).resolves.toBeNull();
    await expect(getOpportunityForCampaign("demo-opp-storm-riverside")).resolves.toBeNull();
  });
});

describe("listOpenOpportunities (snooze wake-up)", () => {
  // `snoozeOpportunity` writes snoozed_until, but nothing ever read it back: the
  // list filtered on status in (pending, drafting, drafted), so a snoozed card
  // never returned and "Snooze 1 week" was a silent permanent dismissal.
  function snoozeFilter(supabase: ReturnType<typeof createSupabaseQueryMock>): string {
    const call = supabase.calls.find(([method]) => method === "or");
    return String(call?.[1] ?? "");
  }

  it("asks for open opportunities AND snoozes whose snoozed_until has passed", async () => {
    const supabase = createSupabaseQueryMock({ opportunities: { data: [], error: null } });

    await listOpenOpportunities(supabase, "org-1");

    const filter = snoozeFilter(supabase);
    expect(filter).toContain("status.in.(pending,drafting,drafted)");
    expect(filter).toContain("and(status.eq.snoozed,snoozed_until.lte.");
    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
  });

  it("bounds the inbox load so a long-running workspace can't pull an unbounded list", async () => {
    const supabase = createSupabaseQueryMock({ opportunities: { data: [], error: null } });

    await listOpenOpportunities(supabase, "org-1");

    expect(supabase.calls.some(([method]) => method === "limit")).toBe(true);
  });

  it("counts woken snoozes too, so the /arc chip agrees with the inbox it links to", async () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const supabase = createSupabaseQueryMock({ opportunities: { data: rows, error: null, count: 4 } });

    await expect(countPendingOpportunities(supabase)).resolves.toBe(4);
    expect(snoozeFilter(supabase)).toContain("and(status.eq.snoozed,snoozed_until.lte.");
  });
});

/**
 * BSR-727. Expiry was enforced when opportunities were WRITTEN and never when
 * they were READ, so a weather card created while its advisory was live stayed
 * in the inbox after the advisory ended. The live workspace was showing a Flood
 * Advisory that ended three days earlier, at 55% confidence, under a headline
 * reading "while advisories are live", with a working "Draft with Arc" button.
 */
describe("listOpenOpportunities (closed signal windows)", () => {
  const HOUR = 3600_000;
  const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

  const row = (id: string, endsAt?: string) => ({
    id,
    subject_type: "weather_event",
    subject_id: `subj-${id}`,
    title: `Flood Advisory ${id}`,
    summary: "",
    confidence: 55,
    urgency: "low",
    status: "pending",
    recommended_action: "",
    campaign_id: null,
    evidence: endsAt ? { endsAt } : {},
  });

  it("drops an opportunity whose window closed before now", async () => {
    const supabase = createSupabaseQueryMock({
      opportunities: { data: [row("expired", iso(-72 * HOUR)), row("live", iso(+12 * HOUR))], error: null },
    });

    const records = await listOpenOpportunities(supabase, "org-1");

    expect(records.map((r) => r.id)).toEqual(["live"]);
  });

  it("keeps an opportunity with no window at all", async () => {
    // A cold lead or competitor move has no endsAt. This must never hide those.
    const supabase = createSupabaseQueryMock({
      opportunities: { data: [row("no-window")], error: null },
    });

    await expect(listOpenOpportunities(supabase, "org-1")).resolves.toHaveLength(1);
  });

  it("keeps an opportunity whose endsAt is unparseable rather than hiding work", async () => {
    const supabase = createSupabaseQueryMock({
      opportunities: { data: [row("garbled", "not-a-date")], error: null },
    });

    await expect(listOpenOpportunities(supabase, "org-1")).resolves.toHaveLength(1);
  });

  it("compares instants, not strings — an offset timestamp is not lexicographic", async () => {
    // 2026-08-04T11:15:00-05:00 and 2026-08-04T16:15:00Z are the same instant and
    // sort apart as text. A string comparison would get exactly one of these two
    // rows wrong.
    const future = new Date(Date.now() + 6 * HOUR);
    const offsetIso = future.toISOString().replace("Z", "+00:00");
    const supabase = createSupabaseQueryMock({
      opportunities: { data: [row("offset-future", offsetIso)], error: null },
    });

    await expect(listOpenOpportunities(supabase, "org-1")).resolves.toHaveLength(1);
  });

  it("does not count a closed window on the chip either", async () => {
    const supabase = createSupabaseQueryMock({
      opportunities: {
        data: [row("expired", iso(-HOUR)), row("live", iso(+HOUR))],
        error: null,
        count: 2,
      },
    });

    // The chip must not read 2 above an inbox showing 1.
    await expect(countPendingOpportunities(supabase)).resolves.toBe(1);
  });
});

describe("getOpportunityForCampaign (authoritative, org-scoped read)", () => {
  const ROW = {
    id: "opp-1",
    subject_type: "lead",
    subject_id: "11111111-2222-3333-4444-555555555555",
    title: "Oak Park homeowner comparing water-damage estimates",
    summary: "Visited the water-damage page three times.",
    confidence: 88,
    urgency: "high" as const,
    recommended_action: "Fast-track a same-day estimate with proof-of-work photos",
    recommended_campaign_type: "rapid_response",
    evidence: { persona: "persona_homeowner_emergency", leadScore: 91 },
    status: "pending",
    campaign_id: null,
  };

  it("scopes the read by org_id AND id and maps the row to the conversion shape", async () => {
    const supabase = createSupabaseQueryMock({ opportunities: { data: ROW, error: null } });

    const opp = await getOpportunityForCampaign("opp-1", "org-1", supabase);

    // The org filter is what denies cross-tenant reads — assert it's applied.
    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
    expect(supabase.calls).toContainEqual(["eq", "id", "opp-1"]);

    expect(opp).toMatchObject({
      id: "opp-1",
      subjectType: "lead",
      subjectId: ROW.subject_id,
      urgency: "high",
      recommendedAction: ROW.recommended_action,
      recommendedCampaignType: "rapid_response",
      persona: "persona_homeowner_emergency",
      status: "pending",
      campaignId: null,
    });
    expect(opp?.evidence).toMatchObject({ leadScore: 91 });
  });

  it("surfaces an existing campaign link so the action can stay idempotent", async () => {
    const supabase = createSupabaseQueryMock({
      opportunities: { data: { ...ROW, status: "drafted", campaign_id: "camp-existing" }, error: null },
    });

    const opp = await getOpportunityForCampaign("opp-1", "org-1", supabase);

    expect(opp?.status).toBe("drafted");
    expect(opp?.campaignId).toBe("camp-existing");
  });

  it("returns null when the opportunity is missing or the read errors", async () => {
    const missing = createSupabaseQueryMock({ opportunities: { data: null, error: null } });
    await expect(getOpportunityForCampaign("nope", "org-1", missing)).resolves.toBeNull();

    const errored = createSupabaseQueryMock({ opportunities: { data: null, error: { message: "boom" } } });
    await expect(getOpportunityForCampaign("opp-1", "org-1", errored)).resolves.toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/observability/report-degraded", () => ({ reportDegraded: vi.fn() }));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, getSupabaseAdminClient: vi.fn() };
});

import { reportDegraded } from "@/lib/observability/report-degraded";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

import { recordUsageEvent } from "./persistence";

const degraded = vi.mocked(reportDegraded);
const getAdmin = vi.mocked(getSupabaseAdminClient);

/** Supabase stub whose insert().select().single() resolves to a row. */
function dbInserting(result: { data?: unknown; error?: { message: string } | null }) {
  const chain = {
    insert: () => chain,
    select: () => chain,
    single: () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }),
  } as Record<string, unknown>;
  return { from: () => chain };
}

/** The env recordUsageEvent needs to reach the insert path. */
function configureSupabase() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
}

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("recordUsageEvent", () => {
  it("no-ops and returns recorded:false when Supabase is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_MARKETING_SUPABASE_URL;
    delete process.env.MARKETING_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.MARKETING_SUPABASE_SERVICE_ROLE_KEY;

    const result = await recordUsageEvent({
      orgId: "org-1",
      workspaceId: "ws-1",
      service: "gemini_image",
      model: "gemini-2.5-flash-image",
      units: 1,
    });

    expect(result).toEqual({ recorded: false, reason: "not_configured" });
  });
});

describe("surfacing what the meter cannot price (BSR-502)", () => {
  // Locks down the two silent paths found auditing prod: 36 claude-sonnet-5
  // events recorded at ZERO cost carrying `priced_model: false` that nothing ever
  // surfaced, and a metering failure that only reached console.warn.
  // NOTE: this deliberately uses a model that will never be priced. It used to
  // use claude-sonnet-5 — which was genuinely unpriced when this was written and
  // is now priced (300/1500), so the test correctly failed the moment the table
  // changed. A fixture that names a real model rots the day someone fixes it.
  it("reports an unpriced model instead of quietly recording it at zero cost", async () => {
    configureSupabase();
    getAdmin.mockReturnValue(dbInserting({ data: { id: "evt-1" } }) as never);
    degraded.mockClear();

    const result = await recordUsageEvent({
      orgId: "org-1",
      workspaceId: "ws-1",
      service: "arc_claude",
      model: "claude-not-a-real-model-9",
      inputTokens: 10,
      outputTokens: 1200,
    });

    // Still recorded — the point is that it is no longer recorded SILENTLY.
    if (!result.recorded) throw new Error(`expected the event to record, got ${result.reason}`);
    expect(result.costCents).toBe(0);
    expect(degraded.mock.calls.map((c) => (c[1] as { scope?: string }).scope)).toContain(
      "ai-usage.unpriced-model",
    );
  });

  it("stays quiet for a model it can price", async () => {
    configureSupabase();
    getAdmin.mockReturnValue(dbInserting({ data: { id: "evt-2" } }) as never);
    degraded.mockClear();

    await recordUsageEvent({
      orgId: "org-1",
      workspaceId: "ws-1",
      service: "arc_claude",
      model: "claude-opus-4-8",
      inputTokens: 1000,
      outputTokens: 1000,
    });

    expect(degraded.mock.calls.map((c) => (c[1] as { scope?: string }).scope)).not.toContain(
      "ai-usage.unpriced-model",
    );
  });

  it("reports a metering failure — unbilled consumption, not a log line", async () => {
    configureSupabase();
    getAdmin.mockReturnValue(dbInserting({ error: { message: "connection reset" } }) as never);
    degraded.mockClear();

    const result = await recordUsageEvent({
      orgId: "org-1",
      workspaceId: "ws-1",
      service: "arc_claude",
      model: "claude-opus-4-8",
      outputTokens: 500,
    });

    expect(result).toMatchObject({ recorded: false, reason: "error" });
    expect(degraded.mock.calls.map((c) => (c[1] as { scope?: string }).scope)).toContain(
      "ai-usage.record",
    );
  });
});

describe("every service reaches a real cost, not NaN (BSR-502)", () => {
  // REGRESSION GUARD. `gemini_text` was added to the service enum with its own
  // pricing function — which `costForInput` never called, because media was the
  // fallthrough for "everything else". MEDIA_PRICING["gemini_text"] is undefined
  // and `undefined * units` is NaN, so every gemini_text row would have written
  // NaN into an integer cost column.
  //
  // The unit tests were green: the pure pricing function was tested, and the
  // meter helper was tested with recordUsageEvent mocked. Neither crossed the
  // integration point where the bug lived. This test crosses it.
  const SERVICES = ["arc_claude", "gemini_image", "gemini_video", "gemini_embedding", "gemini_text"] as const;

  for (const service of SERVICES) {
    it(`computes a finite cost for ${service}`, async () => {
      configureSupabase();
      let inserted: Record<string, unknown> | null = null;
      const chain = {
        insert: (row: Record<string, unknown>) => {
          inserted = row;
          return chain;
        },
        select: () => chain,
        single: () => Promise.resolve({ data: { id: "evt-1" }, error: null }),
      } as Record<string, unknown>;
      getAdmin.mockReturnValue({ from: () => chain } as never);

      const result = await recordUsageEvent({
        orgId: "org-1",
        workspaceId: "ws-1",
        service,
        model: "some-model",
        inputTokens: 1200,
        outputTokens: 800,
        units: 2,
      });

      if (!result.recorded) throw new Error(`expected a record, got ${result.reason}`);
      expect(Number.isFinite(result.costCents)).toBe(true);
      expect(Number.isFinite(inserted!.cost_estimate_cents as number)).toBe(true);
      expect(Number.isFinite(inserted!.cost_microcents as number)).toBe(true);
    });
  }

  it("writes cost_microcents as the precise value behind the rounded cents", async () => {
    configureSupabase();
    let inserted: Record<string, unknown> | null = null;
    const chain = {
      insert: (row: Record<string, unknown>) => {
        inserted = row;
        return chain;
      },
      select: () => chain,
      single: () => Promise.resolve({ data: { id: "evt-1" }, error: null }),
    } as Record<string, unknown>;
    getAdmin.mockReturnValue({ from: () => chain } as never);

    // 100 output tokens of opus at 7500 cents/Mtok = 0.75 cents. The cents column
    // rounds to 1; the microcents column keeps the 750 that makes summation honest.
    await recordUsageEvent({
      orgId: "org-1",
      workspaceId: "ws-1",
      service: "arc_claude",
      model: "claude-opus-4-8",
      inputTokens: 0,
      outputTokens: 100,
    });

    expect(inserted!.cost_microcents).toBe(750);
    expect(inserted!.cost_estimate_cents).toBe(1);
  });
});

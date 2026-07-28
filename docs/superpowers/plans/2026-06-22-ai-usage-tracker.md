# AI Usage Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture real AI usage (Arc/Claude token counts + Gemini image/video generations) into one workspace-scoped ledger and surface estimated cost, volume, and per-user activity on a `/usage` dashboard.

**Architecture:** A single `ai_usage_events` ledger table is written by two paths — a new `POST /api/v1/arc/usage` endpoint (Claude, called by the arc-runner after each turn) and the existing Gemini media routes. Cost is computed at write time from a pure per-model pricing module in `src/domain/ai-usage.ts`. A read-model rolls events up by workspace + time range for a server-rendered dashboard page.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, Supabase (service-role admin client), Vitest, TypeScript, the arc-runner package (`apps/arc-runner`, Node + Claude Agent SDK), lucide-react icons.

**Key conventions learned from the codebase (do not violate):**
- Layering: `src/domain/` (pure, no I/O, unit-tested) → `src/lib/<feature>/` (I/O) → `src/app/<route>/`.
- Everything in `src/domain/` is re-exported through `src/domain/index.ts`; import from `@/domain`.
- New tables that aren't in `src/lib/supabase/database.types.ts` are accessed via the established cast `getSupabaseAdminClient() as unknown as SupabaseClient` (see `src/lib/personas/persistence.ts:28`). Do NOT attempt to regenerate `database.types.ts`.
- Guard every persistence call with `isSupabaseAdminConfigured()`; degrade gracefully (no throw) when unset.
- Usage recording is **best-effort**: a ledger failure must never break an Arc reply or a media generation.
- Migrations are append-only timestamped files in `supabase/migrations/`; never edit shipped ones.
- Rendered nav is the hardcoded array in `src/app/_components/console-frame.tsx` (the known silent-drop hotspot) AND `src/app/_data/growth-engine.ts`. Add to both.
- No recharts (it crashes SSR here) — charts are deterministic inline SVG.
- `pnpm lint` scans vendored files; scope eslint to changed files. `pnpm lint` does NOT typecheck — run `pnpm build` / `tsc` to catch type errors.
- DESIGN.md: Command Charcoal / Canvas White / Restoration Red; no emojis; no purple/neon AI aesthetic; no equal 3-column dashboard rows; hairlines over card-soup; one editorial (Fraunces) type moment; accent used sparingly.

**Deviation from spec (intentional, discovered during planning):** The spec said Claude tokens would ride on the existing `POST /api/v1/arc/tasks/:id/log` endpoint. In practice the runner posts replies via `/api/v1/arc/messages` and never calls the log endpoint, and the log endpoint requires a non-empty message and writes `agent_run_logs` keyed to `agent_id`. A dedicated `POST /api/v1/arc/usage` endpoint is cleaner, works uniformly for chat/draft/scan turns, and gets its workspace/org from the trustworthy `arcGuard` token scope. Org/workspace are token-derived (trustworthy); `actor_user` is advisory attribution threaded from `payload.operator`.

---

## File Structure

**Create:**
- `supabase/migrations/20260622090000_ai_usage_events.sql` — ledger table, enum, grants.
- `src/domain/ai-usage.ts` — pricing table + cost functions + rollup/bucketing (pure).
- `src/domain/__tests__/ai-usage.test.ts` — unit tests for the above.
- `src/lib/ai-usage/persistence.ts` — `recordUsageEvent(...)` (guarded, best-effort).
- `src/lib/ai-usage/persistence.test.ts` — no-op-without-Supabase guard test.
- `src/lib/ai-usage/read-model.ts` — `loadWorkspaceUsage(range)` for the dashboard.
- `src/app/api/v1/arc/usage/route.ts` — Claude usage intake endpoint.
- `src/app/usage/page.tsx` — dashboard (server component).
- `src/app/usage/_components/usage-dashboard.tsx` — presentational composition.
- `src/app/usage/_components/cost-sparkline.tsx` — inline-SVG sparkline.

**Modify:**
- `src/domain/index.ts` — re-export `./ai-usage`.
- `src/app/api/v1/arc/media/generate-image/route.ts` — record a `gemini_image` event after store.
- `src/app/api/v1/arc/media/generate-video/route.ts` — record a `gemini_video` event after store (poll/done branch).
- `apps/arc-runner/src/arc.ts` — extract SDK `usage` from the result message into `ArcTurnResult`.
- `apps/arc-runner/src/arc-client.ts` — add `postUsage(...)`.
- `apps/arc-runner/src/handler.ts` — call `postUsage` after each turn (best-effort).
- `src/app/_components/nav-icons.tsx` — add `"usage"` icon.
- `src/app/_components/console-frame.tsx` — add Usage nav entry (intelligence section).
- `src/app/_data/growth-engine.ts` — add Usage nav entry.

---

## Task 1: Database migration — `ai_usage_events` ledger

**Files:**
- Create: `supabase/migrations/20260622090000_ai_usage_events.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260622090000_ai_usage_events.sql` with exactly:

```sql
-- AI usage ledger: one row per AI action the app runs (Arc/Claude turns + Gemini
-- media generations), scoped by workspace + org. Cost is computed at write time
-- by the app layer and stored, so historical rows stay correct after price changes.
-- Pure observability — no outbound behavior depends on this table.

create type public.ai_usage_service as enum ('arc_claude', 'gemini_image', 'gemini_video');

create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete cascade,
  actor_user text,
  service public.ai_usage_service not null,
  model text not null,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  units integer check (units is null or units >= 0),
  cost_estimate_cents integer not null default 0 check (cost_estimate_cents >= 0),
  task_id uuid references public.agent_tasks(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index ai_usage_events_workspace_occurred_idx
  on public.ai_usage_events (workspace_id, occurred_at desc);
create index ai_usage_events_org_occurred_idx
  on public.ai_usage_events (org_id, occurred_at desc);
create index ai_usage_events_service_idx
  on public.ai_usage_events (service);

-- Mirror the data-API role grants used by the rest of the public schema
-- (RLS stays enabled; server code uses service_role).
grant select, insert, update, delete on public.ai_usage_events to service_role;
grant select on public.ai_usage_events to anon, authenticated;
```

- [ ] **Step 2: Sanity-check the SQL parses locally (no DB needed)**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('supabase/migrations/20260622090000_ai_usage_events.sql','utf8');if(!/create table public\.ai_usage_events/.test(s)||!/ai_usage_service/.test(s))process.exit(1);console.log('migration OK')"`
Expected: prints `migration OK`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260622090000_ai_usage_events.sql
git commit -m "feat(usage): add ai_usage_events ledger migration"
```

> **Rollout note (not a code step):** this migration must be applied to the prod DB **manually** — Vercel deploys code, not migrations.

---

## Task 2: Domain — pricing table + cost functions

**Files:**
- Create: `src/domain/ai-usage.ts`
- Test: `src/domain/__tests__/ai-usage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/__tests__/ai-usage.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  PRICING_VERSION,
  estimateClaudeCostCents,
  estimateMediaCostCents,
  isPricedModel,
} from "../ai-usage";

describe("estimateClaudeCostCents", () => {
  it("prices opus from input+output tokens (cents per million)", () => {
    // opus: 1500 c/Mtok in, 7500 c/Mtok out.
    // 1,000,000 in -> 1500c; 200,000 out -> 1500c; total 3000c
    expect(estimateClaudeCostCents("claude-opus-4-8", 1_000_000, 200_000)).toBe(3000);
  });

  it("prices haiku cheaper than opus for the same tokens", () => {
    const haiku = estimateClaudeCostCents("claude-haiku-4-5", 1_000_000, 1_000_000);
    const opus = estimateClaudeCostCents("claude-opus-4-8", 1_000_000, 1_000_000);
    expect(haiku).toBeLessThan(opus);
    expect(haiku).toBeGreaterThan(0);
  });

  it("matches a known model by prefix when an exact id is missing", () => {
    expect(estimateClaudeCostCents("claude-opus-4-8-20260101", 1_000_000, 0)).toBe(1500);
  });

  it("returns 0 for an unknown model", () => {
    expect(estimateClaudeCostCents("some-unknown-model", 1_000_000, 1_000_000)).toBe(0);
  });

  it("rounds to the nearest cent and treats null tokens as zero", () => {
    expect(estimateClaudeCostCents("claude-haiku-4-5", null, null)).toBe(0);
  });
});

describe("estimateMediaCostCents", () => {
  it("prices image generations per unit", () => {
    expect(estimateMediaCostCents("gemini_image", 3)).toBe(12); // 4c each
  });

  it("prices video generations per unit higher than images", () => {
    expect(estimateMediaCostCents("gemini_video", 1)).toBeGreaterThan(
      estimateMediaCostCents("gemini_image", 1),
    );
  });

  it("defaults missing units to 1", () => {
    expect(estimateMediaCostCents("gemini_image", null)).toBe(4);
  });
});

describe("isPricedModel / PRICING_VERSION", () => {
  it("flags known vs unknown models", () => {
    expect(isPricedModel("claude-opus-4-8")).toBe(true);
    expect(isPricedModel("mystery")).toBe(false);
  });

  it("exposes a pricing version string", () => {
    expect(typeof PRICING_VERSION).toBe("string");
    expect(PRICING_VERSION.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/domain/__tests__/ai-usage.test.ts`
Expected: FAIL — cannot find module `../ai-usage`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/domain/ai-usage.ts`:

```ts
/**
 * AI usage cost model — pure, deterministic, no I/O.
 *
 * Prices are ESTIMATES, maintained here as the single source of truth and stamped
 * with PRICING_VERSION onto each ledger row's metadata so historical rows stay
 * correct after a price change. All figures are cents.
 */

export const PRICING_VERSION = "2026-06-22";

export type AiUsageService = "arc_claude" | "gemini_image" | "gemini_video";

type ModelRate = { inputCentsPerMTok: number; outputCentsPerMTok: number };

/** Per-model token pricing, in cents per 1,000,000 tokens. */
const MODEL_PRICING: Record<string, ModelRate> = {
  "claude-opus-4-8": { inputCentsPerMTok: 1500, outputCentsPerMTok: 7500 },
  "claude-haiku-4-5": { inputCentsPerMTok: 100, outputCentsPerMTok: 500 },
};

/** Per-generation media pricing, in cents per unit. */
const MEDIA_PRICING: Record<Exclude<AiUsageService, "arc_claude">, number> = {
  gemini_image: 4,
  gemini_video: 200,
};

/** Resolve a model's token rate: exact id first, then a known-prefix match. */
export function resolveModelRate(model: string): ModelRate | null {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  for (const [id, rate] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(id)) return rate;
  }
  return null;
}

export function isPricedModel(model: string): boolean {
  return resolveModelRate(model) !== null;
}

/** Estimated cost (cents) of a Claude turn. Unknown model -> 0. */
export function estimateClaudeCostCents(
  model: string,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number {
  const rate = resolveModelRate(model);
  if (!rate) return 0;
  const inTok = inputTokens ?? 0;
  const outTok = outputTokens ?? 0;
  const cents = (inTok * rate.inputCentsPerMTok + outTok * rate.outputCentsPerMTok) / 1_000_000;
  return Math.round(cents);
}

/** Estimated cost (cents) of N media generations. Missing units -> 1. */
export function estimateMediaCostCents(
  service: Exclude<AiUsageService, "arc_claude">,
  units: number | null | undefined,
): number {
  const count = units ?? 1;
  return MEDIA_PRICING[service] * count;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/domain/__tests__/ai-usage.test.ts`
Expected: PASS (all cases in the two describe blocks above).

- [ ] **Step 5: Commit**

```bash
git add src/domain/ai-usage.ts src/domain/__tests__/ai-usage.test.ts
git commit -m "feat(usage): add AI usage pricing/cost domain logic"
```

---

## Task 3: Domain — usage rollup + day bucketing

**Files:**
- Modify: `src/domain/ai-usage.ts`
- Test: `src/domain/__tests__/ai-usage.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/domain/__tests__/ai-usage.test.ts` (add these imports to the existing import block: `summarizeUsage`, `bucketCostByDay`, and the type `UsageRollupEvent`):

```ts
import type { UsageRollupEvent } from "../ai-usage";
import { summarizeUsage, bucketCostByDay } from "../ai-usage";

const EVENTS: UsageRollupEvent[] = [
  { service: "arc_claude", model: "claude-opus-4-8", actorUser: "evan", inputTokens: 1000, outputTokens: 500, units: null, costCents: 30, occurredAt: "2026-06-20T10:00:00Z" },
  { service: "arc_claude", model: "claude-haiku-4-5", actorUser: null, inputTokens: 2000, outputTokens: 1000, units: null, costCents: 5, occurredAt: "2026-06-21T10:00:00Z" },
  { service: "gemini_image", model: "gemini-2.5-flash-image", actorUser: "evan", inputTokens: null, outputTokens: null, units: 2, costCents: 8, occurredAt: "2026-06-21T11:00:00Z" },
];

describe("summarizeUsage", () => {
  it("totals cost, tokens, units, and event count", () => {
    const s = summarizeUsage(EVENTS);
    expect(s.totalCostCents).toBe(43);
    expect(s.totalInputTokens).toBe(3000);
    expect(s.totalOutputTokens).toBe(1500);
    expect(s.totalUnits).toBe(2);
    expect(s.eventCount).toBe(3);
  });

  it("groups by service sorted by cost desc", () => {
    const s = summarizeUsage(EVENTS);
    expect(s.byService.map((r) => r.service)).toEqual(["arc_claude", "gemini_image"]);
    expect(s.byService[0].costCents).toBe(35);
    expect(s.byService[0].count).toBe(2);
  });

  it("groups by model sorted by cost desc", () => {
    const s = summarizeUsage(EVENTS);
    expect(s.byModel[0]).toMatchObject({ model: "claude-opus-4-8", costCents: 30 });
  });

  it("groups by user with null folded into the autonomous bucket", () => {
    const s = summarizeUsage(EVENTS);
    const auto = s.byUser.find((r) => r.actorUser === null);
    const evan = s.byUser.find((r) => r.actorUser === "evan");
    expect(auto?.costCents).toBe(5);
    expect(evan?.costCents).toBe(38);
    expect(evan?.count).toBe(2);
  });

  it("returns zeros for an empty event list", () => {
    const s = summarizeUsage([]);
    expect(s).toMatchObject({ totalCostCents: 0, eventCount: 0 });
    expect(s.byService).toEqual([]);
    expect(s.byUser).toEqual([]);
  });
});

describe("bucketCostByDay", () => {
  it("sums cost into the supplied ordered day keys, zero-filling gaps", () => {
    const days = ["2026-06-19", "2026-06-20", "2026-06-21"];
    expect(bucketCostByDay(EVENTS, days)).toEqual([
      { date: "2026-06-19", costCents: 0 },
      { date: "2026-06-20", costCents: 30 },
      { date: "2026-06-21", costCents: 13 },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/domain/__tests__/ai-usage.test.ts`
Expected: FAIL — `summarizeUsage`/`bucketCostByDay`/`UsageRollupEvent` not exported.

- [ ] **Step 3: Add the implementation**

Append to `src/domain/ai-usage.ts`:

```ts
export type UsageRollupEvent = {
  service: AiUsageService;
  model: string;
  actorUser: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  units: number | null;
  costCents: number;
  occurredAt: string; // ISO timestamp
};

export type ServiceRollup = {
  service: AiUsageService;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  units: number;
  count: number;
};

export type ModelRollup = { model: string; costCents: number; count: number };
export type UserRollup = {
  actorUser: string | null;
  costCents: number;
  count: number;
  inputTokens: number;
  outputTokens: number;
  units: number;
};

export type UsageSummary = {
  totalCostCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalUnits: number;
  eventCount: number;
  byService: ServiceRollup[];
  byModel: ModelRollup[];
  byUser: UserRollup[];
};

export function summarizeUsage(events: UsageRollupEvent[]): UsageSummary {
  const summary: UsageSummary = {
    totalCostCents: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalUnits: 0,
    eventCount: events.length,
    byService: [],
    byModel: [],
    byUser: [],
  };

  const services = new Map<AiUsageService, ServiceRollup>();
  const models = new Map<string, ModelRollup>();
  const users = new Map<string, UserRollup>();

  for (const e of events) {
    const inTok = e.inputTokens ?? 0;
    const outTok = e.outputTokens ?? 0;
    const units = e.units ?? 0;

    summary.totalCostCents += e.costCents;
    summary.totalInputTokens += inTok;
    summary.totalOutputTokens += outTok;
    summary.totalUnits += units;

    const svc = services.get(e.service) ?? {
      service: e.service,
      costCents: 0,
      inputTokens: 0,
      outputTokens: 0,
      units: 0,
      count: 0,
    };
    svc.costCents += e.costCents;
    svc.inputTokens += inTok;
    svc.outputTokens += outTok;
    svc.units += units;
    svc.count += 1;
    services.set(e.service, svc);

    const mdl = models.get(e.model) ?? { model: e.model, costCents: 0, count: 0 };
    mdl.costCents += e.costCents;
    mdl.count += 1;
    models.set(e.model, mdl);

    const userKey = e.actorUser ?? "autonomous";
    const usr = users.get(userKey) ?? {
      actorUser: e.actorUser,
      costCents: 0,
      count: 0,
      inputTokens: 0,
      outputTokens: 0,
      units: 0,
    };
    usr.costCents += e.costCents;
    usr.count += 1;
    usr.inputTokens += inTok;
    usr.outputTokens += outTok;
    usr.units += units;
    users.set(userKey, usr);
  }

  const byCostDesc = (a: { costCents: number }, b: { costCents: number }) => b.costCents - a.costCents;
  summary.byService = [...services.values()].sort(byCostDesc);
  summary.byModel = [...models.values()].sort(byCostDesc);
  summary.byUser = [...users.values()].sort(byCostDesc);
  return summary;
}

/** Bucket event cost into the supplied ordered ISO date keys (YYYY-MM-DD, UTC). */
export function bucketCostByDay(
  events: UsageRollupEvent[],
  dayKeys: string[],
): Array<{ date: string; costCents: number }> {
  const totals = new Map<string, number>(dayKeys.map((d) => [d, 0]));
  for (const e of events) {
    const day = e.occurredAt.slice(0, 10);
    if (totals.has(day)) totals.set(day, (totals.get(day) ?? 0) + e.costCents);
  }
  return dayKeys.map((date) => ({ date, costCents: totals.get(date) ?? 0 }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/domain/__tests__/ai-usage.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/domain/ai-usage.ts src/domain/__tests__/ai-usage.test.ts
git commit -m "feat(usage): add usage rollup + day-bucket domain logic"
```

---

## Task 4: Re-export the domain module

**Files:**
- Modify: `src/domain/index.ts`

- [ ] **Step 1: Add the export**

Add this line to `src/domain/index.ts` (with the other `export * from` lines, alphabetically near the others is fine — append at the end of the list):

```ts
export * from "./ai-usage";
```

- [ ] **Step 2: Verify it resolves**

Run: `node -e "require('fs').readFileSync('src/domain/index.ts','utf8').includes('./ai-usage')||process.exit(1);console.log('export OK')"`
Expected: prints `export OK`

- [ ] **Step 3: Commit**

```bash
git add src/domain/index.ts
git commit -m "feat(usage): re-export ai-usage from @/domain"
```

---

## Task 5: Persistence — `recordUsageEvent`

**Files:**
- Create: `src/lib/ai-usage/persistence.ts`
- Test: `src/lib/ai-usage/persistence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/ai-usage/persistence.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { recordUsageEvent } from "./persistence";

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/ai-usage/persistence.test.ts`
Expected: FAIL — cannot find module `./persistence`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/ai-usage/persistence.ts`:

```ts
import { type SupabaseClient } from "@supabase/supabase-js";

import {
  PRICING_VERSION,
  estimateClaudeCostCents,
  estimateMediaCostCents,
  isPricedModel,
  type AiUsageService,
} from "@/domain";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

export type RecordUsageInput = {
  orgId: string;
  workspaceId: string;
  service: AiUsageService;
  model: string;
  actorUser?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  units?: number | null;
  taskId?: string | null;
  campaignId?: string | null;
  metadata?: Record<string, unknown>;
};

export type RecordUsageResult =
  | { recorded: true; id: string; costCents: number }
  | { recorded: false; reason: "not_configured" | "error" };

/** Compute the estimated cost (cents) for a usage event from the pricing module. */
function costForInput(input: RecordUsageInput): number {
  if (input.service === "arc_claude") {
    return estimateClaudeCostCents(input.model, input.inputTokens, input.outputTokens);
  }
  return estimateMediaCostCents(input.service, input.units);
}

/**
 * Record one AI usage event into the `ai_usage_events` ledger. Best-effort:
 * returns a result object and never throws, so a ledger failure can't break an
 * Arc reply or a media generation. No-ops cleanly when Supabase is unconfigured.
 */
export async function recordUsageEvent(input: RecordUsageInput): Promise<RecordUsageResult> {
  if (!isSupabaseAdminConfigured()) {
    return { recorded: false, reason: "not_configured" };
  }

  const costCents = costForInput(input);
  // `ai_usage_events` isn't in the generated Database types yet, so use the
  // established untyped-client cast (see src/lib/personas/persistence.ts).
  const db = getSupabaseAdminClient() as unknown as SupabaseClient;

  try {
    const { data, error } = await db
      .from("ai_usage_events")
      .insert({
        org_id: input.orgId,
        workspace_id: input.workspaceId,
        actor_user: input.actorUser ?? null,
        service: input.service,
        model: input.model,
        input_tokens: input.inputTokens ?? null,
        output_tokens: input.outputTokens ?? null,
        units: input.units ?? null,
        cost_estimate_cents: costCents,
        task_id: input.taskId ?? null,
        campaign_id: input.campaignId ?? null,
        metadata: {
          ...(input.metadata ?? {}),
          pricing_version: PRICING_VERSION,
          priced_model: isPricedModel(input.model),
        },
      })
      .select("id")
      .single();

    if (error || !data) {
      console.warn(`[ai-usage] recordUsageEvent insert failed: ${error?.message ?? "no row returned"}`);
      return { recorded: false, reason: "error" };
    }
    return { recorded: true, id: (data as { id: string }).id, costCents };
  } catch (err) {
    console.warn(`[ai-usage] recordUsageEvent threw: ${err instanceof Error ? err.message : String(err)}`);
    return { recorded: false, reason: "error" };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/ai-usage/persistence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai-usage/persistence.ts src/lib/ai-usage/persistence.test.ts
git commit -m "feat(usage): add recordUsageEvent persistence (best-effort, guarded)"
```

---

## Task 6: Read-model — workspace-scoped usage load

**Files:**
- Create: `src/lib/ai-usage/read-model.ts`

> No unit test: this is thin Supabase I/O over the untyped client, consistent with how other read-models in this repo are left untested (they need a live DB). Correctness of the math it depends on is covered by the Task 2/3 domain tests.

- [ ] **Step 1: Write the read-model**

Create `src/lib/ai-usage/read-model.ts`:

```ts
import { type SupabaseClient } from "@supabase/supabase-js";

import {
  bucketCostByDay,
  summarizeUsage,
  type UsageRollupEvent,
  type UsageSummary,
} from "@/domain";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

export type UsageRange = "7d" | "30d" | "90d";

export const USAGE_RANGES: UsageRange[] = ["7d", "30d", "90d"];
const RANGE_DAYS: Record<UsageRange, number> = { "7d": 7, "30d": 30, "90d": 90 };

export type RecentUsageRow = {
  occurredAt: string;
  actorUser: string | null;
  service: UsageRollupEvent["service"];
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  units: number | null;
  costCents: number;
};

export type WorkspaceUsage = {
  configured: boolean;
  workspaceName: string;
  range: UsageRange;
  summary: UsageSummary;
  previousTotalCostCents: number;
  daily: Array<{ date: string; costCents: number }>;
  recent: RecentUsageRow[];
};

type UsageEventRow = {
  occurred_at: string;
  actor_user: string | null;
  service: UsageRollupEvent["service"];
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  units: number | null;
  cost_estimate_cents: number;
};

function emptyUsage(range: UsageRange, workspaceName: string): WorkspaceUsage {
  return {
    configured: false,
    workspaceName,
    range,
    summary: summarizeUsage([]),
    previousTotalCostCents: 0,
    daily: [],
    recent: [],
  };
}

function toRollup(row: UsageEventRow): UsageRollupEvent {
  return {
    service: row.service,
    model: row.model,
    actorUser: row.actor_user,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    units: row.units,
    costCents: row.cost_estimate_cents,
    occurredAt: row.occurred_at,
  };
}

/** UTC YYYY-MM-DD keys for the last `days` days, oldest first, ending today. */
function lastNDayKeys(days: number, now: Date): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

/**
 * Load the active workspace's AI usage for a time range: rolled-up summary,
 * a per-day cost series, the previous period's total (for the delta), and a
 * short recent-activity tail. Degrades to an empty, `configured:false` shape
 * when Supabase or a workspace isn't available.
 */
export async function loadWorkspaceUsage(range: UsageRange): Promise<WorkspaceUsage> {
  if (!isSupabaseAdminConfigured()) return emptyUsage(range, "This workspace");

  let workspaceId: string | null = null;
  let workspaceName = "This workspace";
  try {
    const ctx = await getCurrentWorkspaceContext();
    workspaceId = ctx.workspaceId;
    workspaceName = ctx.workspaceName;
  } catch {
    return emptyUsage(range, workspaceName);
  }
  if (!workspaceId) return emptyUsage(range, workspaceName);

  const days = RANGE_DAYS[range];
  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setUTCDate(rangeStart.getUTCDate() - (days - 1));
  rangeStart.setUTCHours(0, 0, 0, 0);
  const prevStart = new Date(rangeStart);
  prevStart.setUTCDate(prevStart.getUTCDate() - days);

  const db = getSupabaseAdminClient() as unknown as SupabaseClient;

  try {
    const [{ data: currentRows }, { data: prevRows }] = await Promise.all([
      db
        .from("ai_usage_events")
        .select("occurred_at,actor_user,service,model,input_tokens,output_tokens,units,cost_estimate_cents")
        .eq("workspace_id", workspaceId)
        .gte("occurred_at", rangeStart.toISOString())
        .order("occurred_at", { ascending: false }),
      db
        .from("ai_usage_events")
        .select("cost_estimate_cents")
        .eq("workspace_id", workspaceId)
        .gte("occurred_at", prevStart.toISOString())
        .lt("occurred_at", rangeStart.toISOString()),
    ]);

    const rows = (currentRows ?? []) as UsageEventRow[];
    const events = rows.map(toRollup);
    const summary = summarizeUsage(events);
    const daily = bucketCostByDay(events, lastNDayKeys(days, now));
    const previousTotalCostCents = ((prevRows ?? []) as Array<{ cost_estimate_cents: number }>).reduce(
      (sum, r) => sum + (r.cost_estimate_cents ?? 0),
      0,
    );
    const recent: RecentUsageRow[] = rows.slice(0, 12).map((r) => ({
      occurredAt: r.occurred_at,
      actorUser: r.actor_user,
      service: r.service,
      model: r.model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      units: r.units,
      costCents: r.cost_estimate_cents,
    }));

    return { configured: true, workspaceName, range, summary, previousTotalCostCents, daily, recent };
  } catch {
    // Supabase unreachable (breaker/abort) — degrade rather than crash the page.
    return emptyUsage(range, workspaceName);
  }
}
```

- [ ] **Step 2: Typecheck the new lib compiles**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `src/lib/ai-usage/read-model.ts` (whole-project check; see Task 12 for the full gate).

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai-usage/read-model.ts
git commit -m "feat(usage): add workspace-scoped usage read-model"
```

---

## Task 7: Record Gemini media usage from the generate routes

**Files:**
- Modify: `src/app/api/v1/arc/media/generate-image/route.ts`
- Modify: `src/app/api/v1/arc/media/generate-video/route.ts`

- [ ] **Step 1: Wire the image route**

In `src/app/api/v1/arc/media/generate-image/route.ts`, add the import alongside the other `@/lib` imports:

```ts
import { recordUsageEvent } from "@/lib/ai-usage/persistence";
```

Then, inside the `try` block, immediately AFTER `const url = await storeGeneratedImage(...)` and BEFORE building the `media` object, add:

```ts
    // Best-effort usage metering — never blocks or fails the generation.
    await recordUsageEvent({
      orgId: allowed.scope.orgId,
      workspaceId: allowed.scope.workspaceId,
      service: "gemini_image",
      model: gen.model,
      units: 1,
      metadata: { route: "generate-image", aspect_ratio: aspectRatio, job_id: gen.jobId },
    });
```

- [ ] **Step 2: Wire the video route**

In `src/app/api/v1/arc/media/generate-video/route.ts`, add the same import:

```ts
import { recordUsageEvent } from "@/lib/ai-usage/persistence";
```

Then, in the poll branch where a finished video is stored, immediately AFTER `const url = await storeGeneratedMedia(...)` and BEFORE building the `media` object, add:

```ts
      // Best-effort usage metering — count one generation when the video lands.
      await recordUsageEvent({
        orgId: allowed.scope.orgId,
        workspaceId: allowed.scope.workspaceId,
        service: "gemini_video",
        model: typeof body.model === "string" ? body.model : "veo",
        units: 1,
        metadata: { route: "generate-video", job_id: typeof body.job_id === "string" ? body.job_id : null },
      });
```

> Record on the `done`/poll branch only — that's the single point a video actually completes, so a clip is counted exactly once (the `start` branch hasn't produced output yet).

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors in the two route files.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/arc/media/generate-image/route.ts src/app/api/v1/arc/media/generate-video/route.ts
git commit -m "feat(usage): record Gemini image/video generations to the usage ledger"
```

---

## Task 8: Claude usage intake endpoint

**Files:**
- Create: `src/app/api/v1/arc/usage/route.ts`

- [ ] **Step 1: Write the endpoint**

Create `src/app/api/v1/arc/usage/route.ts`:

```ts
import { NextResponse } from "next/server";

import { INVALID_JSON, arcGuard, fail, readJson } from "@/app/api/v1/arc/_lib/http";
import { recordUsageEvent } from "@/lib/ai-usage/persistence";

/**
 * Arc reports token usage for a completed turn. Org/workspace come from the
 * bearer token scope (trustworthy); actor_user is advisory attribution threaded
 * from the operator. Best-effort on the runner side — a failure here never
 * affects the chat reply. No outbound.
 *
 *   POST /api/v1/arc/usage
 *   body: { model: string, input_tokens?: number, output_tokens?: number,
 *           actor_user?: string, task_id?: string, campaign_id?: string,
 *           metadata?: object }
 */
export async function POST(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;

  const payload = await readJson(request);
  if (payload === INVALID_JSON || typeof payload !== "object" || payload === null) {
    return fail("rejected", "Request body must be valid JSON.", 400);
  }
  const body = payload as Record<string, unknown>;

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) return fail("rejected", "model is required.", 400);

  const asCount = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

  const result = await recordUsageEvent({
    orgId: allowed.scope.orgId,
    workspaceId: allowed.scope.workspaceId,
    service: "arc_claude",
    model,
    actorUser: typeof body.actor_user === "string" ? body.actor_user : null,
    inputTokens: asCount(body.input_tokens),
    outputTokens: asCount(body.output_tokens),
    taskId: typeof body.task_id === "string" ? body.task_id : null,
    campaignId: typeof body.campaign_id === "string" ? body.campaign_id : null,
    metadata: body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : undefined,
  });

  if (!result.recorded) {
    // not_configured / error are both non-fatal: ack so the runner doesn't retry-storm.
    return NextResponse.json({ ok: true, status: "skipped", reason: result.reason }, { status: 202 });
  }
  return NextResponse.json({ ok: true, status: "recorded", id: result.id, costCents: result.costCents }, { status: 201 });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors in the new route.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/arc/usage/route.ts
git commit -m "feat(usage): add POST /api/v1/arc/usage Claude intake endpoint"
```

---

## Task 9: arc-runner reports Claude token usage

**Files:**
- Modify: `apps/arc-runner/src/arc.ts`
- Modify: `apps/arc-runner/src/arc-client.ts`
- Modify: `apps/arc-runner/src/handler.ts`

- [ ] **Step 1: Capture SDK usage into `ArcTurnResult`**

In `apps/arc-runner/src/arc.ts`, extend the `ArcTurnResult` type (add the `usage` field):

```ts
export type ArcTurnResult = {
  body: string;
  actions: ArcActionCard[];
  suggestions: string[];
  sources: ArcMention[];
  questions: ArcQuestion[];
  usage: { model: string; inputTokens: number | null; outputTokens: number | null };
};
```

In `runArcQuery`, add a usage accumulator before the `for await` loop:

```ts
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
```

Inside the loop, extend the success-result branch to also read `usage` (the Agent SDK attaches token usage to the final result message):

```ts
    } else if (message.type === "result" && message.subtype === "success") {
      resultText = message.result;
      const usage = (message as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
      if (usage) {
        inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : inputTokens;
        outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : outputTokens;
      }
    }
```

Update the `return` of `runArcQuery` to include usage:

```ts
  return {
    body: (resultText || assistantText).trim(),
    actions,
    suggestions: suggestions.slice(0, 4),
    sources,
    questions: questions.slice(0, 4),
    usage: { model: opts.model, inputTokens, outputTokens },
  };
```

> `runArcOpportunityDraft` and `runArcOpportunityScan` already return whatever `runArcQuery` returns, so they pick up `usage` automatically — no change needed there.

- [ ] **Step 2: Add `postUsage` to the ArcClient**

In `apps/arc-runner/src/arc-client.ts`, add this function inside `createArcClient` (next to `postStep`):

```ts
  /**
   * Report token usage for a completed turn to the app's usage ledger.
   * Best-effort — metering must never break or delay the chat reply.
   */
  async function postUsage(input: {
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
    actorUser?: string | null;
    taskId?: string | null;
  }): Promise<void> {
    try {
      await fetch(`${config.appApiBaseUrl}/api/v1/arc/usage`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: input.model,
          input_tokens: input.inputTokens ?? undefined,
          output_tokens: input.outputTokens ?? undefined,
          actor_user: input.actorUser ?? undefined,
          task_id: input.taskId ?? undefined,
        }),
      });
    } catch {
      /* metering is non-essential; never surface to the run */
    }
  }
```

Add `postUsage` to the returned object:

```ts
  return { apiGet, apiPost, apiPut, postChatReply, postStep, postChatChunk, postUsage };
```

- [ ] **Step 3: Report usage from the chat handler**

In `apps/arc-runner/src/handler.ts`, inside `handleChatMessage`, AFTER the `await client.postChatReply({...})` call and BEFORE the closing `console.log`, add:

```ts
    await client.postUsage({
      model: result.usage.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      actorUser: payload.operator ?? null,
      taskId: payload.agentTaskId,
    });
```

In `handleOpportunityDraft`, AFTER the existing success `console.log` (inside the `try`), add:

```ts
    await client.postUsage({
      model: result.usage.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      actorUser: payload.operator ?? null,
      taskId: payload.agentTaskId,
    });
```

In `handleOpportunityScan`, AFTER its success `console.log` (inside the `try`), add the same block:

```ts
    await client.postUsage({
      model: result.usage.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      actorUser: payload.operator ?? null,
      taskId: payload.agentTaskId,
    });
```

> `payload.operator` exists on all three payload types (it's threaded into `ctx.scope.operator` today). If a payload's `operator` is absent, `actor_user` is null and the event rolls up under "Arc (autonomous)".

- [ ] **Step 4: Typecheck the runner package**

Run: `pnpm --filter ./apps/arc-runner exec tsc --noEmit`
Expected: no errors. (If the runner has its own build script, `pnpm --filter ./apps/arc-runner run build` also works — use whichever the package defines; check `apps/arc-runner/package.json` scripts.)

- [ ] **Step 5: Commit**

```bash
git add apps/arc-runner/src/arc.ts apps/arc-runner/src/arc-client.ts apps/arc-runner/src/handler.ts
git commit -m "feat(usage): arc-runner reports Claude token usage per turn"
```

> **Rollout note (not a code step):** the runner change only takes effect after a **Cloud Run redeploy** of `apps/arc-runner`. Gemini media metering (Task 7) starts as soon as the Next app deploys.

---

## Task 10: Navigation — add the Usage entry

**Files:**
- Modify: `src/app/_components/nav-icons.tsx`
- Modify: `src/app/_components/console-frame.tsx`
- Modify: `src/app/_data/growth-engine.ts`

- [ ] **Step 1: Add the `usage` icon**

In `src/app/_components/nav-icons.tsx`:

Add `Gauge` to the lucide import list (keep alphabetical-ish with the others):

```ts
  GalleryHorizontalEnd,
  Gauge,
  Home,
```

Add `"usage"` to the `NavIconName` union:

```ts
  | "personas"
  | "usage";
```

Add the mapping in the `icons` record:

```ts
  settings: Settings2,
  usage: Gauge,
```

- [ ] **Step 2: Add the nav entry in console-frame (the rendered array)**

In `src/app/_components/console-frame.tsx`, add Usage to `intelligenceNavItems` (after Analytics):

```ts
  const intelligenceNavItems: ShellNavItem[] = [
    { label: "Activity", href: "/activity", icon: "activity", matches: ["/activity"] },
    { label: "Analytics", href: "/analytics", icon: "analytics", matches: ["/analytics"] },
    { label: "Usage", href: "/usage", icon: "usage", matches: ["/usage"] },
    { label: "Brain", href: "/brain", icon: "brain", matches: ["/brain"] },
    { label: "Personas", href: "/personas", icon: "personas", matches: ["/personas"] },
  ];
```

- [ ] **Step 3: Add the nav entry in growth-engine.ts**

Open `src/app/_data/growth-engine.ts`. Find the `navItems` array and add an entry consistent with the existing shape (match the surrounding objects' fields exactly — they use `{ label, href }` and possibly an icon/description; mirror whatever the neighbors use):

```ts
  { label: "Usage", href: "/usage" },
```

> If entries in this file carry more fields (e.g. `description`, `icon`), copy the shape of the Analytics entry and fill `label: "Usage"`, `href: "/usage"`. Place it next to Analytics.

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors (the `"usage"` icon name now satisfies `NavIconName`).

- [ ] **Step 5: Commit**

```bash
git add src/app/_components/nav-icons.tsx src/app/_components/console-frame.tsx src/app/_data/growth-engine.ts
git commit -m "feat(usage): add Usage to primary navigation"
```

---

## Task 11: Dashboard page + components

**Files:**
- Create: `src/app/usage/_components/cost-sparkline.tsx`
- Create: `src/app/usage/_components/usage-dashboard.tsx`
- Create: `src/app/usage/page.tsx`

> Reuse the shared primitives from `src/app/_components/page-header.tsx` (`PageHeader`, `Panel`, `StatusPill`, `EmptyState`). Do not introduce new layout components. Verify the exact exported names by opening that file before writing imports; the snippets below assume `PageHeader`, `Panel`, and `EmptyState` are exported (per CLAUDE.md). If a name differs, adjust the import to match.

- [ ] **Step 1: Build the sparkline (inline SVG, deterministic)**

Create `src/app/usage/_components/cost-sparkline.tsx`:

```tsx
/** Deterministic inline-SVG cost sparkline. No recharts (it crashes SSR here). */
export function CostSparkline({
  points,
  width = 520,
  height = 64,
}: {
  points: Array<{ date: string; costCents: number }>;
  width?: number;
  height?: number;
}) {
  if (points.length === 0) {
    return <div className="h-16 w-full" aria-hidden="true" />;
  }

  const pad = 4;
  const max = Math.max(1, ...points.map((p) => p.costCents));
  const stepX = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const y = (cents: number) => height - pad - (cents / max) * (height - pad * 2);
  const x = (i: number) => pad + i * stepX;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.costCents).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-16 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Daily AI cost trend"
    >
      <path d={area} fill="var(--accent)" opacity={0.08} />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 2: Build the dashboard composition**

Create `src/app/usage/_components/usage-dashboard.tsx`:

```tsx
import Link from "next/link";

import { EmptyState, Panel } from "@/app/_components/page-header";
import { type WorkspaceUsage, type UsageRange, USAGE_RANGES } from "@/lib/ai-usage/read-model";

import { CostSparkline } from "./cost-sparkline";

const SERVICE_LABELS: Record<string, string> = {
  arc_claude: "Arc · Claude",
  gemini_image: "Gemini · Image",
  gemini_video: "Gemini · Video",
};

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function compactNumber(n: number): string {
  return n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}

function deltaLabel(current: number, previous: number): { text: string; tone: "up" | "down" | "flat" } {
  if (previous === 0) return { text: current === 0 ? "no prior usage" : "new this period", tone: "flat" };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: "flat vs. prior period", tone: "flat" };
  return { text: `${pct > 0 ? "+" : ""}${pct}% vs. prior period`, tone: pct > 0 ? "up" : "down" };
}

function userLabel(actorUser: string | null): string {
  return actorUser ?? "Arc (autonomous)";
}

function RangeTabs({ range }: { range: UsageRange }) {
  const labels: Record<UsageRange, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days" };
  return (
    <div className="flex items-center gap-1 text-sm">
      {USAGE_RANGES.map((r) => (
        <Link
          key={r}
          href={`/usage?range=${r}`}
          aria-current={r === range ? "page" : undefined}
          className={
            r === range
              ? "rounded-md bg-[var(--surface-inset)] px-3 py-1.5 font-medium text-[var(--text-primary)]"
              : "rounded-md px-3 py-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          }
        >
          {labels[r]}
        </Link>
      ))}
    </div>
  );
}

export function UsageDashboard({ usage }: { usage: WorkspaceUsage }) {
  const { summary } = usage;
  const delta = deltaLabel(summary.totalCostCents, usage.previousTotalCostCents);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-muted)]">
          Estimated AI spend for <span className="text-[var(--text-primary)]">{usage.workspaceName}</span>. All figures
          are estimates from per-model pricing — not billed amounts.
        </p>
        <RangeTabs range={usage.range} />
      </div>

      {!usage.configured || summary.eventCount === 0 ? (
        <EmptyState
          title="No AI usage recorded yet"
          description={
            usage.configured
              ? "Once Arc runs a turn or generates media in this workspace, estimated cost and volume will appear here."
              : "Connect Supabase to start capturing AI usage for this workspace."
          }
        />
      ) : (
        <>
          {/* Hero cost + trend */}
          <Panel>
            <div className="flex flex-col gap-4 p-5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Estimated AI cost</p>
                  <p className="font-[var(--font-display,Fraunces)] text-5xl leading-none text-[var(--text-primary)]">
                    {dollars(summary.totalCostCents)}
                  </p>
                  <p
                    className={
                      delta.tone === "up"
                        ? "mt-1 text-sm text-[var(--accent)]"
                        : "mt-1 text-sm text-[var(--text-muted)]"
                    }
                  >
                    {delta.text}
                  </p>
                </div>
                <div className="text-right text-sm text-[var(--text-muted)]">
                  <div>{summary.eventCount.toLocaleString("en-US")} AI actions</div>
                  <div>
                    {compactNumber(summary.totalInputTokens + summary.totalOutputTokens)} tokens ·{" "}
                    {summary.totalUnits.toLocaleString("en-US")} media
                  </div>
                </div>
              </div>
              <CostSparkline points={usage.daily} />
            </div>
          </Panel>

          {/* By service/model */}
          <Panel>
            <div className="p-5">
              <h2 className="mb-3 text-sm font-medium text-[var(--text-primary)]">Where it goes</h2>
              <ul className="divide-y divide-[var(--border-subtle,rgba(0,0,0,0.08))]">
                {summary.byService.map((row) => {
                  const share = summary.totalCostCents > 0 ? Math.round((row.costCents / summary.totalCostCents) * 100) : 0;
                  const volume =
                    row.service === "arc_claude"
                      ? `${compactNumber(row.inputTokens + row.outputTokens)} tokens`
                      : `${row.units.toLocaleString("en-US")} generations`;
                  return (
                    <li key={row.service} className="flex items-center justify-between gap-4 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-[var(--text-primary)]">
                          {SERVICE_LABELS[row.service] ?? row.service}
                        </div>
                        <div className="text-xs text-[var(--text-muted)]">
                          {volume} · {row.count.toLocaleString("en-US")} runs
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-[var(--text-primary)]">{dollars(row.costCents)}</div>
                        <div className="text-xs text-[var(--text-muted)]">{share}%</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Panel>

          {/* By user */}
          <Panel>
            <div className="p-5">
              <h2 className="mb-3 text-sm font-medium text-[var(--text-primary)]">By user</h2>
              <ul className="divide-y divide-[var(--border-subtle,rgba(0,0,0,0.08))]">
                {summary.byUser.map((row) => (
                  <li key={row.actorUser ?? "autonomous"} className="flex items-center justify-between gap-4 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-[var(--text-primary)]">{userLabel(row.actorUser)}</div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {row.count.toLocaleString("en-US")} runs · {compactNumber(row.inputTokens + row.outputTokens)}{" "}
                        tokens
                      </div>
                    </div>
                    <div className="text-sm text-[var(--text-primary)]">{dollars(row.costCents)}</div>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>

          {/* Recent activity */}
          <Panel>
            <div className="p-5">
              <h2 className="mb-3 text-sm font-medium text-[var(--text-primary)]">Recent activity</h2>
              <ul className="divide-y divide-[var(--border-subtle,rgba(0,0,0,0.08))]">
                {usage.recent.map((row, i) => (
                  <li key={i} className="flex items-center justify-between gap-4 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="text-[var(--text-primary)]">{SERVICE_LABELS[row.service] ?? row.service}</span>{" "}
                      <span className="text-[var(--text-muted)]">· {row.model}</span>
                      <div className="text-xs text-[var(--text-muted)]">
                        {userLabel(row.actorUser)} · {new Date(row.occurredAt).toLocaleString("en-US")}
                      </div>
                    </div>
                    <div className="text-right text-[var(--text-primary)]">{dollars(row.costCents)}</div>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build the page (server component)**

Create `src/app/usage/page.tsx`:

```tsx
import { PageHeader } from "@/app/_components/page-header";
import { loadWorkspaceUsage, type UsageRange, USAGE_RANGES } from "@/lib/ai-usage/read-model";

import { UsageDashboard } from "./_components/usage-dashboard";

export const dynamic = "force-dynamic";

function parseRange(value: string | string[] | undefined): UsageRange {
  const raw = Array.isArray(value) ? value[0] : value;
  return (USAGE_RANGES as string[]).includes(raw ?? "") ? (raw as UsageRange) : "30d";
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const { range } = await searchParams;
  const usage = await loadWorkspaceUsage(parseRange(range));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <PageHeader title="AI Usage" description="Estimated cost and volume across the AI this workspace runs." />
      <UsageDashboard usage={usage} />
    </div>
  );
}
```

> Next.js 16: `searchParams` is a Promise and must be awaited (as above). Confirm the `PageHeader` prop names (`title` / `description`) against `src/app/_components/page-header.tsx` and adjust if the shared component uses different prop names; mirror how an existing page (e.g. `src/app/activity/page.tsx`) calls `PageHeader`.

- [ ] **Step 4: Typecheck + build**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds and the route list includes `/usage`.

- [ ] **Step 5: Commit**

```bash
git add src/app/usage/page.tsx src/app/usage/_components/usage-dashboard.tsx src/app/usage/_components/cost-sparkline.tsx
git commit -m "feat(usage): add /usage dashboard page"
```

---

## Task 12: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full usage test set**

Run: `pnpm test src/domain/__tests__/ai-usage.test.ts src/lib/ai-usage/persistence.test.ts`
Expected: PASS, no failures.

- [ ] **Step 2: Typecheck the whole app + the runner**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

Run: `pnpm --filter ./apps/arc-runner exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint only the changed files** (pnpm lint scans vendored files; scope it)

Run: `pnpm exec eslint src/domain/ai-usage.ts src/lib/ai-usage/persistence.ts src/lib/ai-usage/read-model.ts "src/app/usage/**/*.tsx" src/app/api/v1/arc/usage/route.ts`
Expected: no errors (warnings acceptable if consistent with the rest of the repo).

- [ ] **Step 4: Production build**

Run: `pnpm build`
Expected: succeeds; `/usage` appears in the route output.

- [ ] **Step 5: Confirm the branch is clean**

Run: `git status`
Expected: nothing uncommitted (all work committed across the prior tasks).

---

## Rollout checklist (post-merge, manual — not code steps)

1. Apply `supabase/migrations/20260622090000_ai_usage_events.sql` to the prod DB manually (Vercel does not run migrations). Verify the prod project (`qqbecyrhnowmooyjiztz`) gains the `ai_usage_events` table and `ai_usage_service` enum.
2. After the Next app deploys, Gemini media metering (Task 7) is live immediately.
3. Redeploy `apps/arc-runner` to Cloud Run so Claude token reporting (Task 9) goes live. Until then, `arc_claude` rows won't appear, but the dashboard renders correctly (it just shows media usage).
4. Spot-check `/usage`: run an Arc chat and generate an image, then confirm rows appear with non-zero estimated cost.

---

## Self-Review (completed during planning)

- **Spec coverage:** ledger table (Task 1) ✓; pricing/cost domain (Task 2) ✓; rollup/aggregation (Task 3) ✓; persistence guarded + best-effort (Task 5) ✓; workspace-scoped read-model (Task 6) ✓; Gemini capture (Task 7) ✓; Claude capture via endpoint + runner (Tasks 8–9) ✓; cost-first dashboard with hero/by-service/by-user/recent + sparkline (Task 11) ✓; top-level nav in both sources (Task 10) ✓; estimated-cost labeling + empty states (Task 11) ✓; tests + tsc + scoped lint + build (Task 12) ✓; manual migration + runner-redeploy rollout notes ✓.
- **Spec deviation (documented):** Claude tokens flow through a new `POST /api/v1/arc/usage` endpoint rather than the existing task-log endpoint — rationale in the header.
- **Type consistency:** `recordUsageEvent` input/result, `UsageRollupEvent`, `UsageSummary`, `WorkspaceUsage`, `UsageRange`, and `AiUsageService` names are used identically across domain, lib, route, runner, and page. `ArcTurnResult.usage` shape matches what `postUsage` consumes.
- **Placeholders:** none — all code is complete; the two "confirm the exact prop/field name against the shared component" notes (PageHeader props, growth-engine entry shape) are verification instructions, not missing code.
